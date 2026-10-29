const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { timingSafeEqual, randomBytes } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');

function loadEnvFile() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const AUTH_ENABLED = AUTH_PASSWORD.length > 0;
const AUTH_SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TEAM_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_TEAM_AVATAR_CACHE_BYTES = 32 * 1024 * 1024;
const TEAM_AVATAR_CACHE_TTL = 10 * 60 * 1000;
const MAX_TEAM_AVATAR_CACHE_ENTRIES = 256;
const TEAM_AVATAR_REQUEST_TIMEOUT = 3000;
const MAX_WS_CLIENTS = 16;
const MAX_WS_MESSAGES_PER_SECOND = 20;
const TEAM_AVATAR_SOURCES = ['10.0.100.5', 'localhost'];
const teamAvatarCache = new Map();
const teamAvatarRequests = new Map();
const authSessions = new Map();
const loginAttempts = new Map();
let teamAvatarCacheBytes = 0;
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
    const ceremonies = Array.isArray(data.ceremonies)
      ? data.ceremonies
      : data.ceremony && (data.ceremony.title || data.ceremony.subtitle)
        ? [{ id: 'ceremony_legacy', title: data.ceremony.title || '', subtitle: data.ceremony.subtitle || '' }]
        : [];
    const normalizedData = {
      ...data,
      guests: Array.isArray(data.guests) ? data.guests : [],
      awards: Array.isArray(data.awards) ? data.awards : [],
      tickerLines: Array.isArray(data.tickerLines) ? data.tickerLines : [],
      ceremonies: ceremonies.filter((item) => item && typeof item === 'object').map((item, index) => ({
        id: typeof item.id === 'string' && item.id ? item.id : `ceremony_${index + 1}`,
        title: typeof item.title === 'string' ? item.title : '',
        subtitle: typeof item.subtitle === 'string' ? item.subtitle : ''
      }))
    };
    delete normalizedData.ceremony;
    return normalizedData;
  } catch (error) {
    return { guests: [], awards: [], tickerLines: [], ceremonies: [] };
  }
}

let data = loadData();
let currentState = { t: 'n', i: '', s: 'idle' };
let tickerVisible = false;
let watermarkVisible = true;
let ceremonyVisible = false;
let activeCeremonyId = '';
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
  if (ceremonyVisible) {
    ceremonyVisible = false;
    activeCeremonyId = '';
    broadcast({ e: 'c', v: 0, i: '' });
  }
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

function getCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return '';
}

function isAuthenticated(request) {
  const sessionId = getCookie(request, 'nks_session');
  const expiresAt = authSessions.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    authSessions.delete(sessionId);
    return false;
  }
  return true;
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, expiresAt] of authSessions) {
    if (expiresAt <= now) authSessions.delete(sessionId);
  }
}

function getClientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function isLoginRateLimited(request) {
  const attempt = loginAttempts.get(getClientAddress(request));
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginAttempts.delete(getClientAddress(request));
    return false;
  }
  return attempt.count >= 10;
}

function recordLoginFailure(request) {
  const address = getClientAddress(request);
  const attempt = loginAttempts.get(address);
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginAttempts.set(address, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
  } else {
    attempt.count += 1;
  }
}

function validateLoginPassword(password) {
  const supplied = Buffer.from(typeof password === 'string' ? password : '');
  const expected = Buffer.from(AUTH_PASSWORD);
  return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function setSessionCookie(response, request, sessionId) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  response.setHeader('Set-Cookie', `nks_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${AUTH_SESSION_TTL / 1000}${secure}`);
}

function sendLoginPage(response, nextPath) {
  response.writeHead(302, {
    Location: `/login?next=${encodeURIComponent(nextPath)}`,
    'Cache-Control': 'no-store'
  });
  response.end();
}

function fetchTeamAvatarFromHost(host, teamId) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: host,
      port: 8080,
      path: `/api/teams/${encodeURIComponent(teamId)}/avatar`,
      timeout: TEAM_AVATAR_REQUEST_TIMEOUT
    }, (upstream) => {
      const contentType = String(upstream.headers['content-type'] || '').split(';', 1)[0].toLowerCase();
      if (upstream.statusCode !== 200 || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(contentType)) {
        upstream.resume();
        reject(new Error(`Avatar source ${host} returned an invalid response`));
        return;
      }

      const chunks = [];
      let size = 0;
      upstream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_TEAM_AVATAR_BYTES) {
          request.destroy(new Error('Team avatar exceeds the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      upstream.on('end', () => {
        if (size === 0) {
          reject(new Error(`Avatar source ${host} returned an empty image`));
          return;
        }
        resolve({ body: Buffer.concat(chunks), contentType });
      });
      upstream.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error(`Avatar source ${host} timed out`)));
    request.on('error', reject);
  });
}

async function loadTeamAvatar(teamId) {
  const cached = teamAvatarCache.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (cached) {
    teamAvatarCache.delete(teamId);
    teamAvatarCacheBytes -= cached.body.length;
  }

  const pending = teamAvatarRequests.get(teamId);
  if (pending) return pending;

  const request = (async () => {
    let lastError;
    for (const host of TEAM_AVATAR_SOURCES) {
      try {
        const avatar = await fetchTeamAvatarFromHost(host, teamId);
        const cacheEntry = { ...avatar, expiresAt: Date.now() + TEAM_AVATAR_CACHE_TTL };
        const previousEntry = teamAvatarCache.get(teamId);
        if (previousEntry) teamAvatarCacheBytes -= previousEntry.body.length;
        teamAvatarCache.set(teamId, cacheEntry);
        teamAvatarCacheBytes += cacheEntry.body.length;
        while (teamAvatarCache.size > MAX_TEAM_AVATAR_CACHE_ENTRIES || teamAvatarCacheBytes > MAX_TEAM_AVATAR_CACHE_BYTES) {
          const oldestKey = teamAvatarCache.keys().next().value;
          const oldestEntry = teamAvatarCache.get(oldestKey);
          teamAvatarCache.delete(oldestKey);
          teamAvatarCacheBytes -= oldestEntry.body.length;
        }
        return cacheEntry;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('No team avatar source is available');
  })();

  teamAvatarRequests.set(teamId, request);
  try {
    return await request;
  } finally {
    teamAvatarRequests.delete(teamId);
  }
}

function warmTeamAvatarCache(awards) {
  const teamIds = new Set();
  for (const award of awards) {
    for (const teamId of String(award.winnerTeams || '').trim().split(/\s+/)) {
      if (/^[A-Za-z0-9_-]+$/.test(teamId)) teamIds.add(teamId);
    }
  }
  for (const teamId of teamIds) {
    loadTeamAvatar(teamId).catch((error) => {
      console.warn(`Failed to prefetch avatar for team ${teamId}: ${error.message}`);
    });
  }
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

  if (request.method === 'POST' && pathname === '/api/auth/login') {
    if (!hasAllowedOrigin(request)) {
      jsonResponse(response, 403, { error: 'Cross-origin request rejected' });
      return;
    }
    if (!AUTH_ENABLED) {
      jsonResponse(response, 503, { error: 'Server password is not configured' });
      return;
    }
    if (isLoginRateLimited(request)) {
      jsonResponse(response, 429, { error: 'Too many login attempts. Try again later.' });
      return;
    }
    let body;
    try {
      body = await readRequestJson(request);
    } catch (error) {
      jsonResponse(response, error.status || 400, { error: error.message });
      return;
    }
    if (!validateLoginPassword(body.password)) {
      recordLoginFailure(request);
      jsonResponse(response, 401, { error: '密碼錯誤，請再試一次。' });
      return;
    }
    loginAttempts.delete(getClientAddress(request));
    clearExpiredSessions();
    const sessionId = randomBytes(32).toString('base64url');
    authSessions.set(sessionId, Date.now() + AUTH_SESSION_TTL);
    setSessionCookie(response, request, sessionId);
    jsonResponse(response, 200, { success: true });
    return;
  }

  const protectedPagePaths = new Map([
    ['/', '/ctrl'],
    ['/ctrl', '/ctrl'],
    ['/ctrl.html', '/ctrl'],
    ['/mc', '/mc'],
    ['/mc.html', '/mc']
  ]);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const protectedPath = protectedPagePaths.get(pathname);
    if (protectedPath && AUTH_ENABLED && !isAuthenticated(request)) {
      sendLoginPage(response, protectedPath);
      return;
    }
  }

  if (request.method === 'POST' && ['/api/data', '/api/save', '/api/backup'].includes(pathname) && !hasAllowedOrigin(request)) {
    jsonResponse(response, 403, { error: 'Cross-origin request rejected' });
    return;
  }
  if (request.method === 'POST' && ['/api/data', '/api/save', '/api/backup'].includes(pathname) && AUTH_ENABLED && !isAuthenticated(request)) {
    jsonResponse(response, 401, { error: 'Authentication required' });
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
        tickerLines: Array.isArray(nextData.tickerLines) ? nextData.tickerLines : [],
        ceremonies: Array.isArray(nextData.ceremonies) ? nextData.ceremonies
          .filter((item) => item && typeof item === 'object')
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id ? item.id : `ceremony_${index + 1}`,
            title: typeof item.title === 'string' ? item.title : '',
            subtitle: typeof item.subtitle === 'string' ? item.subtitle : ''
          }))
          : nextData.ceremony && (nextData.ceremony.title || nextData.ceremony.subtitle)
            ? [{ id: 'ceremony_legacy', title: String(nextData.ceremony.title || ''), subtitle: String(nextData.ceremony.subtitle || '') }]
            : []
      };
      delete data.ceremony;
      if (ceremonyVisible && !data.ceremonies.some((item) => item.id === activeCeremonyId)) {
        ceremonyVisible = false;
        activeCeremonyId = '';
        broadcast({ e: 'c', v: 0, i: '' });
      }
      warmTeamAvatarCache(data.awards);
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
  const teamAvatarRoute = pathname.match(/^\/api\/teams\/([A-Za-z0-9_-]+)\/avatar$/);
  if (request.method === 'GET' && teamAvatarRoute) {
    try {
      const avatar = await loadTeamAvatar(teamAvatarRoute[1]);
      response.writeHead(200, {
        'Content-Type': avatar.contentType,
        'Content-Length': avatar.body.length,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(avatar.body);
    } catch (error) {
      console.warn(`Failed to load avatar for team ${teamAvatarRoute[1]}: ${error.message}`);
      jsonResponse(response, 502, { error: 'Team avatar is unavailable' });
    }
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
    '/login': 'login.html',
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

webSockets.on('connection', (client, request) => {
  clients.add(client);
  let messageWindowStart = Date.now();
  let messageCount = 0;
  send(client, { e: 's', ...currentState });
  send(client, { e: 'k', v: tickerVisible ? 1 : 0 });
  send(client, { e: 'w', v: watermarkVisible ? 1 : 0 });
  send(client, { e: 'c', v: ceremonyVisible ? 1 : 0, i: activeCeremonyId });
  client.on('message', (rawMessage) => {
    if (AUTH_ENABLED && !isAuthenticated(request)) return;
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
        if (message.clearTicker === true) {
          tickerVisible = false;
          broadcast({ e: 'k', v: 0 });
        }
      } else if (message.t === 'g' && getItem('g', message.i)) {
        setState('g', String(message.i), 'showing');
      } else if (message.t === 'a' && getItem('a', message.i) && ['oe', 'sl', 'pv'].includes(message.s)) {
        setState('a', String(message.i), message.s);
      }
      return;
    }
    if (message.e === 'k') {
      tickerVisible = message.v === 1;
      broadcast({ e: 'k', v: tickerVisible ? 1 : 0 });
      return;
    }
    if (message.e === 'w') {
      watermarkVisible = message.v === 1;
      broadcast({ e: 'w', v: watermarkVisible ? 1 : 0 });
      return;
    }
    if (message.e === 'c' && message.v === 0) {
      ceremonyVisible = false;
      activeCeremonyId = '';
      broadcast({ e: 'c', v: 0, i: '' });
      return;
    }
    if (message.e === 'c' && message.v === 1) {
      const ceremony = data.ceremonies.find((item) => item.id === String(message.i));
      if (!ceremony) return;
      if (currentState.t !== 'n' || currentState.s !== 'idle') setState('n');
      ceremonyVisible = true;
      activeCeremonyId = ceremony.id;
      broadcast({ e: 'c', v: 1, i: activeCeremonyId });
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
  if (AUTH_ENABLED) {
    console.log('Password protection is enabled for /ctrl and /mc.');
  } else {
    console.log('AUTH_PASSWORD is empty; /ctrl and /mc are open without login.');
  }
  warmTeamAvatarCache(data.awards);
  console.log(`FRC award relay ready at http://${localIP}:${PORT}`);
  console.log(`Control: http://${localIP}:${PORT}/ctrl`);
  console.log(`Overlay: http://${localIP}:${PORT}/overlay`);
  console.log(`MC: http://${localIP}:${PORT}/mc`);
});