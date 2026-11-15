const audienceModes = [
  { value: 'allianceSelection', label: '聯盟選擇' },
  { value: 'blank', label: '清空畫面' },
  { value: 'bracket', label: '賽程表' },
  { value: 'intro', label: '比賽介紹' },
  { value: 'logo', label: 'Logo' },
  { value: 'logoLuma', label: 'Logo 輪播' },
  { value: 'match', label: '比賽進行' },
  { value: 'score', label: '比賽結果' },
  { value: 'sponsor', label: '贊助商' },
  { value: 'timeout', label: '暫停' }
];
const audienceModeControls = document.getElementById('audienceModeControls');
const pageStatus = document.getElementById('pageStatus');
const connectionStatus = document.getElementById('connectionStatus');
const matchPlayStatus = document.getElementById('matchPlayStatus');
let activeMode = null;
let matchPlayConnected = false;
let socket;

function renderAudienceModes() {
  audienceModeControls.replaceChildren(...audienceModes.map((mode) => {
    const active = mode.value === activeMode;
    const card = document.createElement('article');
    card.className = `control-card${active ? ' is-active' : ''}`;

    const heading = document.createElement('h3');
    heading.className = 'card-title';
    heading.textContent = mode.label;

    const actionGroup = document.createElement('div');
    actionGroup.className = 'card-actions';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `control-button btn-primary ${active ? 'btn-preview' : 'btn-show'}`;
    button.dataset.action = 'set-audience-mode';
    button.dataset.mode = mode.value;
    button.disabled = !matchPlayConnected || !socket || socket.readyState !== WebSocket.OPEN;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? '目前顯示' : '切換顯示';

    actionGroup.append(button);
    card.append(heading, actionGroup);
    return card;
  }));
}

function setConnectionStatus(connected) {
  connectionStatus.setAttribute('aria-label', connected ? '控制已連線' : '控制連線中斷，重新連線中');
  connectionStatus.classList.toggle('is-connected', connected);
  connectionStatus.classList.toggle('is-disconnected', !connected);
  renderAudienceModes();
}

function setMatchPlayStatus(status) {
  matchPlayConnected = status === 'connected';
  const labels = {
    connected: 'Cheesy Arena：已連線',
    connecting: 'Cheesy Arena：連線中…',
    reconnecting: 'Cheesy Arena：重新連線中…',
    'not-configured': 'Cheesy Arena：未設定或未連線'
  };
  matchPlayStatus.textContent = labels[status] || `Cheesy Arena：${status}`;
  renderAudienceModes();
}

function setActiveMode(mode) {
  if (!audienceModes.some((item) => item.value === mode)) return;
  activeMode = mode;
  pageStatus.textContent = '';
  renderAudienceModes();
}

function handleMessage(message) {
  if (message.e === 'audience-matchplay-status') {
    setMatchPlayStatus(message.status);
  } else if (message.e === 'arena-snapshot' && message.d) {
    setActiveMode(message.d.audienceDisplayMode);
  } else if (message.e === 'arena-event' && message.t === 'audienceDisplayMode') {
    setActiveMode(message.d);
  } else if (message.e === 'audience-command-accepted') {
    const mode = audienceModes.find((item) => item.value === message.mode);
    pageStatus.textContent = `已送出「${mode ? mode.label : message.mode}」切換指令，等待 Arena 更新。`;
  } else if (message.e === 'audience-command-error') {
    pageStatus.textContent = message.message || '切換 Audience 顯示失敗。';
  }
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  renderAudienceModes();
  socket.addEventListener('open', () => {
    setConnectionStatus(true);
    pageStatus.textContent = '';
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (message && typeof message === 'object' && !Array.isArray(message)) handleMessage(message);
  });
  socket.addEventListener('close', () => {
    setConnectionStatus(false);
    window.setTimeout(connectSocket, 1000);
  });
  socket.addEventListener('error', () => socket.close());
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="set-audience-mode"]');
  if (!button) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pageStatus.textContent = '控制連線尚未建立，請稍後再試。';
    return;
  }
  if (!matchPlayConnected) {
    pageStatus.textContent = 'Cheesy Arena Match Play 尚未連線，無法切換顯示。';
    return;
  }
  pageStatus.textContent = '';
  socket.send(JSON.stringify({ e: 'audience-set-mode', mode: button.dataset.mode }));
});

setConnectionStatus(false);
setMatchPlayStatus('connecting');
connectSocket();
