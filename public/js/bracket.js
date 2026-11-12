const bracketImage = document.getElementById('bracketImage');
const bracketStatus = document.getElementById('bracketStatus');
const refreshIntervalMs = 10000;
let latestRequestId = 0;
let bracketSocket;
let reconnectDelay = 1000;

function refreshBracket() {
  const requestId = ++latestRequestId;
  bracketImage.onload = () => {
    if (requestId !== latestRequestId) return;
    bracketImage.hidden = false;
    bracketStatus.hidden = true;
  };
  bracketImage.onerror = () => {
    if (requestId !== latestRequestId) return;
    bracketStatus.textContent = '無法取得賽程表，將自動重試';
    bracketStatus.hidden = false;
    if (!bracketImage.naturalWidth) bracketImage.hidden = true;
  };
  bracketImage.src = `/api/bracket/svg?activeMatch=current&refresh=${Date.now()}`;
}

function connectBracketWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  bracketSocket = socket;
  socket.addEventListener('open', () => {
    reconnectDelay = 1000;
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn('Ignoring invalid bracket relay message:', error);
      return;
    }
    if (message.e === 'bracket-refresh') refreshBracket();
  });
  socket.addEventListener('close', () => {
    if (bracketSocket === socket) bracketSocket = null;
    window.setTimeout(connectBracketWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
}

refreshBracket();
window.setInterval(refreshBracket, refreshIntervalMs);
connectBracketWebSocket();
