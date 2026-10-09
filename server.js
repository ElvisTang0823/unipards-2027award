const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const PORT = Number(process.env.PORT || 3000);
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_WS_CLIENTS = 16;
const MAX_WS_MESSAGES_PER_SECOND = 20;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ...data,
      guests: Array.isArray(data.guests) ? data.guests : [],
      awards: Array.isArray(data.awards) ? data.awards : [],
      tickerLines: Array.isArray(data.tickerLines) ? data.tickerLines : []
    };
  } catch (error) {
    return { guests: [], awards: [], tickerLines: [] };
  }
}

let data = loadData();
let currentState = { t: 'n', i: '', s: 'idle' };
let tickerVisible = false;
let envelopeTimer = null;
const clients = new Set();

const webSockets = new WebSocketServer({
  noServer: true,
  maxPayload: 512,
  perMessageDeflate: false
});

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function getItem(type, id) {
  const list = type === 'g' ? data.guests : type === 'a' ? data.awards : [];
  return list.find((item) => String(item.id) === String(id));
}

function setState(type, id = '', stage = 'idle') {
  if (envelopeTimer) {
    clearTimeout(envelopeTimer);
    envelopeTimer = null;
  }
  currentState = { t: type, i: id, s: stage };
  broadcast({ e: 's', ...currentState });
  if (type === 'a' && stage === 'oe') {
    envelopeTimer = setTimeout(() => {
      if (currentState.t !== 'a' || currentState.i !== id || currentState.s !== 'oe') return;
      currentState = { t: 'a', i: id, s: 'sl' };
      broadcast({ e: 's', ...currentState });
    }, 1500);
  }
}

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function hasAllowedOrigin(request) {
  const origin = request.headers.origin;
  return Boolean(origin && (origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`));
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function requireExternalToken(request) {
  const expected = process.env.EXT_API_TOKEN;
  const supplied = request.headers['x-api-key'] || request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..+/, '');
  let filename = `data-${timestamp}.json`;
  let suffix = 1;
  while (fs.existsSync(path.join(BACKUP_DIR, filename))) {
    filename = `data-${timestamp}-${String(suffix).padStart(3, '0')}.json`;
    suffix += 1;
  }
  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(data, null, 2));
  return filename;
}

function handleExternalTrigger(request, response, pathname) {
  if (!requireExternalToken(request)) {
    jsonResponse(response, 401, { error: 'External trigger API is disabled or unauthorized' });
    return;
  }
  readRequestJson(request).then((body) => {
    if (pathname === '/api/v1/trigger/clear') {
      setState('n');
      jsonResponse(response, 200, { success: true });
      return;
    }
    if (pathname === '/api/v1/trigger/guest') {
      if (!getItem('g', body.id)) return jsonResponse(response, 404, { error: 'Guest ID not found' });
      setState('g', String(body.id), 'showing');
      jsonResponse(response, 200, { success: true });
      return;
    }
    const awardRoute = pathname.match(/^\/api\/v1\/trigger\/award\/(envelope|lower-third)$/);
    if (awardRoute) {
      if (!getItem('a', body.id)) return jsonResponse(response, 404, { error: 'Award ID not found' });
      setState('a', String(body.id), awardRoute[1] === 'envelope' ? 'oe' : 'sl');
      jsonResponse(response, 200, { success: true });
      return;
    }
    jsonResponse(response, 404, { error: 'Unknown trigger endpoint' });
  }).catch((error) => {
    jsonResponse(response, error.status || 400, { error: error.message });
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === 'POST' && ['/api/data', '/api/save', '/api/backup'].includes(pathname) && !hasAllowedOrigin(request)) {
    jsonResponse(response, 403, { error: 'Cross-origin request rejected' });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/data') {
    jsonResponse(response, 200, data);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/data') {
    try {
      const nextData = await readRequestJson(request);
      if (!nextData || typeof nextData !== 'object' || Array.isArray(nextData)) {
        jsonResponse(response, 400, { error: 'Data must be an object' });
        return;
      }
      data = {
        ...nextData,
        guests: Array.isArray(nextData.guests) ? nextData.guests : [],
        awards: Array.isArray(nextData.awards) ? nextData.awards : [],
        tickerLines: Array.isArray(nextData.tickerLines) ? nextData.tickerLines : []
      };
      broadcast({ e: 'd', d: data });
      jsonResponse(response, 200, { success: true, saved: false });
    } catch (error) {
      jsonResponse(response, error.status || 400, { error: error.message });
    }
    return;
  }
  if (request.method === 'POST' && pathname === '/api/save') {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      jsonResponse(response, 200, { success: true });
    } catch (error) {
      jsonResponse(response, 500, { error: 'Failed to save data' });
    }
    return;
  }
  if (request.method === 'POST' && pathname === '/api/backup') {
    try {
      jsonResponse(response, 200, { success: true, filename: createBackup() });
    } catch (error) {
      jsonResponse(response, 500, { error: 'Failed to create backup' });
    }
    return;
  }
  if (request.method === 'GET' && pathname === '/api/state') {
    jsonResponse(response, 200, currentState);
    return;
  }
  if (request.method === 'POST' && pathname.startsWith('/api/v1/trigger/')) {
    handleExternalTrigger(request, response, pathname);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    jsonResponse(response, 405, { error: 'Method not allowed' });
    return;
  }

  const routeFiles = {
    '/': 'ctrl.html',
    '/ctrl': 'ctrl.html',
    '/overlay': 'overlay.html',
    '/mc': 'mc.html'
  };
  const relativePath = routeFiles[pathname] || pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'ctrl.html')) {
    response.writeHead(403);
    response.end();
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end('Not found');
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const isAsset = pathname.startsWith('/assets/');
    const isVersionStableAsset = /^\/assets\/(Bold|Light)\.ttf$/.test(pathname);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': isVersionStableAsset ? 'public, max-age=31536000, immutable' : isAsset ? 'public, max-age=300' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (!response.headersSent) jsonResponse(response, 500, { error: 'Internal server error' });
  });
});
server.maxConnections = 64;
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.keepAliveTimeout = 5000;

server.on('upgrade', (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch (error) {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws' || !request.headers.origin || !hasAllowedOrigin(request) || clients.size >= MAX_WS_CLIENTS) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit('connection', client, request));
});

webSockets.on('connection', (client) => {
  clients.add(client);
  let messageWindowStart = Date.now();
  let messageCount = 0;
  send(client, { e: 's', ...currentState });
  send(client, { e: 'k', v: tickerVisible ? 1 : 0 });
  client.on('message', (rawMessage) => {
    const now = Date.now();
    if (now - messageWindowStart >= 1000) {
      messageWindowStart = now;
      messageCount = 0;
    }
    messageCount += 1;
    if (messageCount > MAX_WS_MESSAGES_PER_SECOND) {
      client.close(1008, 'Rate limit exceeded');
      return;
    }
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      return;
    }
    if (message.e === 't') {
      if (message.t === 'n') {
        setState('n');
      } else if (message.t === 'g' && getItem('g', message.i)) {
        setState('g', String(message.i), 'showing');
      } else if (message.t === 'a' && getItem('a', message.i) && ['oe', 'sl'].includes(message.s)) {
        setState('a', String(message.i), message.s);
      }
      return;
    }
    if (message.e === 'k') {
      tickerVisible = message.v === 1;
      broadcast({ e: 'k', v: tickerVisible ? 1 : 0 });
    }
  });
  client.on('close', () => clients.delete(client));
  client.on('error', () => clients.delete(client));
});

function getLocalIP() {
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    const lowerName = name.toLowerCase();
    if (['radmin', 'tailscale', 'zerotier', 'vmware', 'virtual', 'vethernet', 'wsl'].some((adapter) => lowerName.includes(adapter))) continue;
    for (const iface of interfaces || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const octets = iface.address.split('.').map(Number);
      if (octets[0] === 192 && octets[1] === 168) return iface.address;
      if (octets[0] === 10) return iface.address;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return iface.address;
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`FRC award relay ready at http://${localIP}:${PORT}`);
  console.log(`Control: http://${localIP}:${PORT}/ctrl`);
  console.log(`Overlay: http://${localIP}:${PORT}/overlay`);
  console.log(`MC: http://${localIP}:${PORT}/mc`);
});