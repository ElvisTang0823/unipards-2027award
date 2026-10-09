const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
// 1. 必須將 express app 傳入 http.createServer
const server = http.createServer(app);
// 2. 將 Socket.IO 綁定到 http server
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const STATE_FILE = path.join(__dirname, 'state.json');

function loadSavedState() {
  try {
    const savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return savedState && typeof savedState === 'object' ? savedState : {};
  } catch (err) {
    return {};
  }
}

const savedState = loadSavedState();

// 解析 JSON 請求與靜態資源
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 頁面路由設定
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ctrl.html')));
app.get('/ctrl', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ctrl.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// API 讀取與寫入
app.get('/api/data', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    return res.json({ guests: [], awards: [] });
  }
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    res.json({ guests: [], awards: [] });
  }
});

app.post('/api/data', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// 記錄並持久化目前疊圖狀態
let currentState = {
  activeType: savedState.activeType || 'none',
  stage: savedState.stage || 'idle',
  payload: savedState.payload && typeof savedState.payload === 'object' ? savedState.payload : {}
};
let currentTicker = savedState.ticker && typeof savedState.ticker === 'object'
  ? savedState.ticker
  : { visible: false, lines: [] };

function persistDisplayState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...currentState, ticker: currentTicker }, null, 2));
  } catch (err) {
    console.error('Failed to save display state:', err);
  }
}

// Socket.IO 即時通訊
io.on('connection', (socket) => {
  // 連線成功時即時同步現有狀態
  socket.emit('update_state', currentState);
  socket.emit('update_ticker', currentTicker);

  // 接收控制台切換指令並廣播給 overlay
  socket.on('change_stage', (state) => {
    currentState = state;
    persistDisplayState();
    io.emit('update_state', currentState);
  });

  socket.on('set_ticker', (ticker) => {
    currentTicker = {
      visible: true,
      lines: Array.isArray(ticker.lines)
        ? ticker.lines.map((line) => String(line).trim()).filter(Boolean)
        : []
    };
    persistDisplayState();
    io.emit('update_ticker', currentTicker);
  });

  socket.on('hide_ticker', () => {
    currentTicker = { ...currentTicker, visible: false };
    persistDisplayState();
    io.emit('update_ticker', currentTicker);
  });
});

// 取得實體區網 IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('radmin') ||
      lowerName.includes('tailscale') ||
      lowerName.includes('zerotier') ||
      lowerName.includes('vmware') ||
      lowerName.includes('virtual') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('wsl')
    ) {
      continue;
    }

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        if (
          ip.startsWith('192.168.') ||
          ip.startsWith('10.') ||
          (ip.startsWith('172.') && parseInt(ip.split('.')[1], 10) >= 16 && parseInt(ip.split('.')[1], 10) <= 31)
        ) {
          return ip;
        }
      }
    }
  }
  return '127.0.0.1';
}

// 注意：必須使用 server.listen 而非 app.listen
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n==================================================');
  console.log(`🚀 FRC Lower Third 伺服器已成功啟動！`);
  console.log(`🏠 本機存取:    http://localhost:${PORT}`);
  console.log(`🌐 區網存取:    http://${localIP}:${PORT}`);
  console.log(`🎛️  控制台:      http://${localIP}:${PORT}/ctrl`);
  console.log(`📺 OBS 疊圖:     http://${localIP}:${PORT}/overlay`);
  console.log('==================================================\n');
});