const bracketImage = document.getElementById('bracketImage');
const bracketStatus = document.getElementById('bracketStatus');
const bracketSlide = document.getElementById('bracketSlide');
const alliancesSlide = document.getElementById('alliancesSlide');
const allianceList = document.getElementById('allianceList');
const refreshIntervalMs = 10000;
const bracketDisplayDurationMs = 15000;
const allianceDisplayDurationMs = 10000;
let latestRequestId = 0;
let allianceRequestStarted = false;
let bracketSocket;
let reconnectDelay = 1000;

function showSlide(showBracket) {
  bracketSlide.classList.toggle('is-active', showBracket);
  bracketSlide.setAttribute('aria-hidden', String(!showBracket));
  alliancesSlide.classList.toggle('is-active', !showBracket);
  alliancesSlide.setAttribute('aria-hidden', String(showBracket));
  if (!showBracket) loadAlliancesOnce();
}

function scheduleSlideTransition(showBracket) {
  const durationMs = showBracket ? bracketDisplayDurationMs : allianceDisplayDurationMs;
  window.setTimeout(() => {
    const nextShowsBracket = !showBracket;
    showSlide(nextShowsBracket);
    scheduleSlideTransition(nextShowsBracket);
  }, durationMs);
}

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

function renderAlliances(alliances) {
  const validAlliances = alliances.filter((alliance) => (
    alliance && typeof alliance === 'object' && !Array.isArray(alliance)
  ));
  if (!validAlliances.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'alliance-empty';
    emptyMessage.textContent = '目前沒有聯盟編組資料';
    allianceList.replaceChildren(emptyMessage);
    return;
  }

  const rows = document.createDocumentFragment();
  validAlliances.forEach((alliance, index) => {
    const row = document.createElement('div');
    row.className = 'alliance-row';

    const name = document.createElement('div');
    name.className = 'alliance-name';
    name.textContent = `Alliance ${alliance.Id || index + 1}`;

    const teams = document.createElement('div');
    teams.className = 'alliance-teams';
    (Array.isArray(alliance.TeamIds) ? alliance.TeamIds : []).forEach((teamId) => {
      const team = document.createElement('div');
      team.className = 'alliance-team';
      if (teamId) {
        const logo = document.createElement('img');
        logo.src = `/api/teams/${encodeURIComponent(teamId)}/avatar`;
        logo.alt = '';
        logo.onerror = () => {
          logo.onerror = null;
          logo.src = '/assets/logos/0.png';
        };
        team.append(logo);
      }

      const number = document.createElement('span');
      number.textContent = teamId ? String(teamId) : '';
      team.append(number);
      teams.append(team);
    });

    row.append(name, teams);
    rows.append(row);
  });
  allianceList.replaceChildren(rows);
}

function loadAlliancesOnce() {
  if (allianceRequestStarted) return;
  allianceRequestStarted = true;
  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'alliance-empty';
  loadingMessage.textContent = '正在載入聯盟編組…';
  allianceList.replaceChildren(loadingMessage);
  fetch('/api/alliances', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Alliance API returned HTTP ${response.status}`);
      return response.json();
    })
    .then((alliances) => {
      if (!Array.isArray(alliances)) throw new Error('Alliance API returned an invalid response');
      renderAlliances(alliances);
    })
    .catch((error) => {
      console.error('Failed to load alliance data:', error);
      const errorMessage = document.createElement('p');
      errorMessage.className = 'alliance-empty';
      errorMessage.textContent = '無法取得聯盟編組資料';
      allianceList.replaceChildren(errorMessage);
    });
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || !event.data || event.data.type !== 'load-alliance-data') return;
  loadAlliancesOnce();
});

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
showSlide(true);
loadAlliancesOnce();
scheduleSlideTransition(true);
connectBracketWebSocket();
