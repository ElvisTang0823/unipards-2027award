const data = { guests: [], awards: [], ceremonies: [] };
let activeProgramState = { t: 'n', i: '', s: 'idle' };
let activeCeremonyId = '';
let tickerVisible = false;
let watermarkVisible = true;
let socket;

function updateGlobalButton(button, visible, label) {
  button.textContent = `${label}：${visible ? '隱藏' : '顯示'}`;
  button.classList.toggle('btn-hide', visible);
  button.classList.toggle('btn-show', !visible);
}

function updateGlobalControls() {
  updateGlobalButton(document.getElementById('tickerToggle'), tickerVisible, '跑馬燈');
  updateGlobalButton(document.getElementById('watermarkToggle'), watermarkVisible, '浮水印');
}

function isProgramActive(type, id) {
  return activeProgramState.t === type && String(activeProgramState.i) === String(id);
}

function createButton(label, action, itemId, type, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `control-button ${className}`;
  button.dataset.action = action;
  if (itemId !== undefined) button.dataset.id = String(itemId);
  if (type) button.dataset.type = type;
  button.textContent = label;
  return button;
}

function createCard(title, actions, isActive) {
  const card = document.createElement('article');
  card.className = `control-card${isActive ? ' is-active' : ''}`;

  const heading = document.createElement('h3');
  heading.className = 'card-title';
  heading.textContent = title;

  const actionGroup = document.createElement('div');
  actionGroup.className = 'card-actions';
  actionGroup.append(...actions);
  card.append(heading, actionGroup);
  return card;
}

function renderControls() {
  const guestControls = document.getElementById('guestControls');
  guestControls.replaceChildren(...data.guests.map((guest) => {
    const isActive = isProgramActive('g', guest.id);
    const toggle = createButton(isActive ? '隱藏' : '顯示', 'toggle-program', guest.id, 'g', isActive ? 'btn-hide' : 'btn-show');
    toggle.classList.add('btn-primary');
    return createCard(guest.name || '未命名嘉賓', [toggle], isActive);
  }));

  const awardControls = document.getElementById('awardControls');
  awardControls.replaceChildren(...data.awards.map((award) => {
    const isActive = isProgramActive('a', award.id);
    const toggle = createButton(isActive ? '隱藏' : '顯示', 'toggle-program', award.id, 'a', isActive ? 'btn-hide' : 'btn-show');
    const preview = createButton('預覽', 'preview-award', award.id, '', 'btn-preview');
    const envelope = createButton('開信封', 'trigger-envelope', award.id, '', 'btn-envelope');
    toggle.classList.add('btn-primary');
    return createCard(award.name || '未命名獎項', [toggle, preview, envelope], isActive);
  }));

  const ceremonyControls = document.getElementById('ceremonyControls');
  ceremonyControls.replaceChildren(...data.ceremonies.map((ceremony) => {
    const isActive = ceremony.id === activeCeremonyId;
    const toggle = createButton(isActive ? '隱藏' : '顯示', 'toggle-ceremony', ceremony.id, '', isActive ? 'btn-hide' : 'btn-show');
    toggle.classList.add('btn-primary');
    return createCard(ceremony.title || '未命名儀式', [toggle], isActive);
  }));
}

function setConnectionStatus(connected) {
  const status = document.getElementById('connectionStatus');
  status.setAttribute('aria-label', connected ? '控制已連線' : '控制連線中斷，重新連線中');
  status.classList.toggle('is-connected', connected);
  status.classList.toggle('is-disconnected', !connected);
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    setConnectionStatus(true);
    document.getElementById('pageStatus').textContent = '';
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message.e === 's') {
      activeProgramState = message;
      renderControls();
    } else if (message.e === 'w') {
      watermarkVisible = message.v === 1;
      updateGlobalControls();
    } else if (message.e === 'k') {
      tickerVisible = message.v === 1;
      updateGlobalControls();
    } else if (message.e === 'c') {
      activeCeremonyId = message.v === 1 ? message.i || '' : '';
      renderControls();
    } else if (message.e === 'd' && message.d) {
      data.guests = Array.isArray(message.d.guests) ? message.d.guests : [];
      data.awards = Array.isArray(message.d.awards) ? message.d.awards : [];
      data.ceremonies = Array.isArray(message.d.ceremonies) ? message.d.ceremonies : [];
      renderControls();
    }
  });
  socket.addEventListener('close', () => {
    setConnectionStatus(false);
    window.setTimeout(connectSocket, 1000);
  });
  socket.addEventListener('error', () => socket.close());
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    document.getElementById('pageStatus').textContent = '控制連線尚未建立，請稍後再試。';
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

async function loadData() {
  try {
    const response = await fetch('/api/data');
    if (!response.ok) throw new Error('無法載入控制清單。');
    const loadedData = await response.json();
    data.guests = Array.isArray(loadedData.guests) ? loadedData.guests : [];
    data.awards = Array.isArray(loadedData.awards) ? loadedData.awards : [];
    data.ceremonies = Array.isArray(loadedData.ceremonies) ? loadedData.ceremonies : [];
    renderControls();
  } catch (error) {
    document.getElementById('pageStatus').textContent = error.message || '載入控制清單失敗。';
  }
}

function toggleProgram(type, id) {
  if (isProgramActive(type, id)) {
    sendMessage({ e: 't', t: 'n' });
  } else {
    sendMessage({ e: 't', t: type, i: id, s: type === 'a' ? 'sl' : undefined });
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'emergency-clear':
      sendMessage({ e: 't', t: 'n', clearTicker: true });
      break;
    case 'toggle-ticker':
      if (sendMessage({ e: 'k', v: tickerVisible ? 0 : 1 })) tickerVisible = !tickerVisible;
      updateGlobalControls();
      break;
    case 'toggle-watermark':
      if (sendMessage({ e: 'w', v: watermarkVisible ? 0 : 1 })) watermarkVisible = !watermarkVisible;
      updateGlobalControls();
      break;
    case 'toggle-program':
      toggleProgram(button.dataset.type, id);
      break;
    case 'preview-award':
      sendMessage({ e: 't', t: 'a', i: id, s: 'pv' });
      break;
    case 'trigger-envelope':
      sendMessage({ e: 't', t: 'a', i: id, s: 'oe' });
      break;
    case 'toggle-ceremony': {
      const visible = id !== activeCeremonyId;
      if (sendMessage({ e: 'c', v: visible ? 1 : 0, i: id })) {
        activeCeremonyId = visible ? id : '';
        renderControls();
      }
      break;
    }
  }
});

updateGlobalControls();
connectSocket();
loadData();
