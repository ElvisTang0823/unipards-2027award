const pendingMessages = [];
    let db = { guests: [], awards: [], tickerLines: [''] };
let watermarkVisible = true;
    let tickerVisible = false;
    let activeCeremonyId = '';
    let activeProgramState = { t: 'n', i: '', s: 'idle' };
    let socket;

function setWatermarkVisible(visible) {
  watermarkVisible = visible;
  const button = document.getElementById('watermarkToggle');
  button.textContent = visible ? '隱藏浮水印' : '顯示浮水印';
  button.classList.toggle('btn-hide', visible);
  button.classList.toggle('btn-show', !visible);
}

function setTickerVisible(visible) {
  tickerVisible = visible;
  const button = document.getElementById('tickerToggle');
  button.textContent = visible ? '隱藏跑馬燈' : '顯示跑馬燈';
  button.classList.toggle('btn-hide', visible);
  button.classList.toggle('btn-show', !visible);
}

function setCeremonyState(visible, ceremonyId = '') {
  activeCeremonyId = visible ? ceremonyId : '';
  updateProgramButtons();
  document.querySelectorAll('#ceremonyTable [data-action="toggle-ceremony"]').forEach((button) => {
    const isActive = button.dataset.ceremonyId === activeCeremonyId;
    button.textContent = isActive ? '隱藏' : '顯示';
    button.classList.toggle('btn-hide', isActive);
    button.classList.toggle('btn-show', !isActive);
  });
}

function updateProgramButtons() {
  document.querySelectorAll('[data-action="toggle-guest"], [data-action="toggle-award"]').forEach((button) => {
    const type = button.dataset.action === 'toggle-guest' ? 'g' : 'a';
    const item = type === 'g' ? db.guests[Number(button.dataset.index)] : db.awards[Number(button.dataset.index)];
    const isActive = Boolean(item && activeProgramState.t === type && String(item.id) === String(activeProgramState.i));
    button.textContent = isActive ? '隱藏' : '顯示';
    button.classList.toggle('btn-hide', isActive);
    button.classList.toggle('btn-show', !isActive);
  });
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (message.e === 's') {
      activeProgramState = message;
      updateProgramButtons();
    }
    if (message.e === 'w') setWatermarkVisible(message.v === 1);
    if (message.e === 'k') setTickerVisible(message.v === 1);
    if (message.e === 'c') setCeremonyState(message.v === 1, message.i || '');
  });
  socket.addEventListener('open', () => {
    while (pendingMessages.length) socket.send(JSON.stringify(pendingMessages.shift()));
      });
      socket.addEventListener('close', () => window.setTimeout(connectSocket, 1000));
    }
    connectSocket();

    function sendMessage(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      else pendingMessages.push(message);
    }

    async function init() {
      const res = await fetch('/api/data');
      db = await res.json();
      if (!Array.isArray(db.tickerLines)) db.tickerLines = [''];
      if (!Array.isArray(db.ceremonies)) {
        db.ceremonies = db.ceremony && (db.ceremony.title || db.ceremony.subtitle)
          ? [{ id: 'ceremony_legacy', title: db.ceremony.title || '', subtitle: db.ceremony.subtitle || '' }]
          : [];
      }
      renderTables();
      renderCeremonies();
      renderTickerLines();
    }

    function renderTables() {
      const gBody = document.querySelector('#guestTable tbody');
      gBody.innerHTML = db.guests.map((g, index) => `
        <tr>
          <td><input type="text" value="${g.org || ''}" placeholder="例: 國立成功大學" data-entity="guest" data-index="${index}" data-field="org"></td>
          <td><input type="text" value="${g.name || ''}" placeholder="例: 沈校長" data-entity="guest" data-index="${index}" data-field="name"></td>
          <td><input type="text" value="${g.jobTitle || ''}" placeholder="例: 校長 (可留空)" data-entity="guest" data-index="${index}" data-field="jobTitle"></td>
          <td class="actions-cell">
            <div class="btn-group">
              <button class="btn-show" data-action="toggle-guest" data-index="${index}">顯示</button>
            </div>
          </td>
        </tr>
      `).join('');

      const aBody = document.querySelector('#awardTable tbody');
      aBody.innerHTML = db.awards.map((a, index) => `
        <tr>
          <td><input type="text" value="${a.name || ''}" data-entity="award" data-index="${index}" data-field="name"></td>
          <td><input type="password" value="${a.winnerTeams || ''}" placeholder="6998 7589" autocomplete="new-password" data-entity="award" data-index="${index}" data-field="winnerTeams" data-mask-on-edit></td>
          <td><input type="password" value="${a.winnerName || ''}" autocomplete="new-password" data-entity="award" data-index="${index}" data-field="winnerName" data-mask-on-edit></td>
          <td class="actions-cell">
            <div class="btn-group">
              <button class="btn-ticker" data-action="preview-award" data-index="${index}">預覽</button>
              <button class="btn-env" data-action="trigger-envelope" data-index="${index}">開信封</button>
              <button class="btn-show" data-action="toggle-award" data-index="${index}">顯示</button>
            </div>
          </td>
        </tr>
      `).join('');
      updateProgramButtons();
    }

    function escapeAttribute(value) {
      return String(value || '').replace(/[&"<>']/g, (character) => ({
        '&': '&amp;',
        '"': '&quot;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;'
      })[character]);
    }

    function renderCeremonies() {
      const body = document.querySelector('#ceremonyTable tbody');
      body.innerHTML = db.ceremonies.map((ceremony, index) => {
        const isActive = ceremony.id === activeCeremonyId;
        return `
          <tr>
            <td><input type="text" value="${escapeAttribute(ceremony.title)}" placeholder="例如：開幕典禮" data-entity="ceremony" data-index="${index}" data-field="title"></td>
            <td><input type="text" value="${escapeAttribute(ceremony.subtitle)}" placeholder="例如：2027 NKS Award" data-entity="ceremony" data-index="${index}" data-field="subtitle"></td>
            <td class="actions-cell">
              <div class="btn-group">
                <button class="${isActive ? 'btn-hide' : 'btn-show'}" data-action="toggle-ceremony" data-index="${index}" data-ceremony-id="${escapeAttribute(ceremony.id)}">${isActive ? '隱藏' : '顯示'}</button>
                <button class="btn-hide" data-action="delete-ceremony" data-index="${index}">刪除</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function saveData() {
      const response = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db)
      });
      if (!response.ok) throw new Error('資料儲存失敗');
      document.getElementById('saveStatus').textContent = '變更暫存於伺服器記憶體';
    }

    async function saveNow() {
      const status = document.getElementById('saveStatus');
      try {
        await saveData();
        const response = await fetch('/api/save', { method: 'POST' });
        if (!response.ok) throw new Error('無法寫入 data.json');
        status.textContent = '資料已儲存';
      } catch (error) {
        status.textContent = error.message;
      }
    }

    async function saveBackup() {
      const status = document.getElementById('saveStatus');
      try {
        await saveData();
        const response = await fetch('/api/backup', { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '備份失敗');
        status.textContent = `已建立備份 ${result.filename}`;
      } catch (error) {
        status.textContent = error.message;
      }
    }

    function updateGuest(i, key, val) { db.guests[i][key] = val; saveData(); }
    function updateAward(i, key, val) { db.awards[i][key] = val; saveData(); }

    function renderTickerLines() {
      const container = document.getElementById('tickerLines');
      container.replaceChildren();
      db.tickerLines.forEach((line, index) => {
        const row = document.createElement('div');
        row.className = 'ticker-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = line;
        input.placeholder = '輸入一行跑馬燈文字';
        input.addEventListener('change', () => updateTickerLine(index, input.value));

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '刪除';
        removeButton.setAttribute('aria-label', '刪除此行');
        removeButton.addEventListener('click', () => removeTickerLine(index));

        row.append(input, removeButton);
        container.append(row);
      });
    }

    function updateTickerLine(index, value) {
      db.tickerLines[index] = value;
      saveData();
    }

    function addTickerLine() {
      db.tickerLines.push('');
      saveData();
      renderTickerLines();
    }

    function removeTickerLine(index) {
      db.tickerLines.splice(index, 1);
      saveData();
      renderTickerLines();
    }

    function toggleTicker() {
      setTickerVisible(!tickerVisible);
      sendMessage({ e: 'k', v: tickerVisible ? 1 : 0 });
    }

    function toggleWatermark() {
      setWatermarkVisible(!watermarkVisible);
      sendMessage({ e: 'w', v: watermarkVisible ? 1 : 0 });
    }

    function toggleCeremony(index) {
      const ceremony = db.ceremonies[index];
      if (!ceremony) return;
      const willShow = ceremony.id !== activeCeremonyId;
      sendMessage({ e: 'c', v: willShow ? 1 : 0, i: ceremony.id });
      setCeremonyState(willShow, willShow ? ceremony.id : '');
    }

    function addCeremony() {
      db.ceremonies.push({ id: `c_${Date.now()}`, title: '', subtitle: '' });
      saveData();
      renderCeremonies();
    }

    function deleteCeremony(index) {
      const [ceremony] = db.ceremonies.splice(index, 1);
      if (ceremony?.id === activeCeremonyId) {
        sendMessage({ e: 'c', v: 0 });
        setCeremonyState(false);
      }
      saveData();
      renderCeremonies();
    }

    function addGuestRow() {
      db.guests.push({ id: 'g_' + Date.now(), org: '', name: '新嘉賓', jobTitle: '' });
      saveData(); renderTables();
    }

    function addAwardRow() {
      db.awards.push({ id: 'a_' + Date.now(), name: '新獎項', winnerTeams: '6998', winnerName: '隊名' });
      saveData(); renderTables();
    }

    function toggleGuest(i) {
      const guest = db.guests[i];
      if (!guest) return;
      if (activeProgramState.t === 'g' && String(activeProgramState.i) === String(guest.id)) {
        clearOverlay();
      } else {
        sendMessage({ e: 't', t: 'g', i: String(guest.id) });
      }
    }

    function triggerEnvelope(i) {
      if (!db.awards[i]) return;
      sendMessage({ e: 't', t: 'a', i: String(db.awards[i].id), s: 'oe' });
    }

    function previewAward(i) {
      if (!db.awards[i]) return;
      sendMessage({ e: 't', t: 'a', i: String(db.awards[i].id), s: 'pv' });
    }

    function toggleAward(i) {
      const award = db.awards[i];
      if (!award) return;
      if (activeProgramState.t === 'a' && String(activeProgramState.i) === String(award.id)) {
        clearOverlay();
      } else {
        sendMessage({ e: 't', t: 'a', i: String(award.id), s: 'sl' });
      }
    }

    function clearOverlay() {
      sendMessage({ e: 't', t: 'n' });
    }

    function emergencyClear() {
      sendMessage({ e: 't', t: 'n', clearTicker: true });
      setCeremonyState(false);
    }

    document.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.dataset.entity) return;
      const index = Number(input.dataset.index);
      if (input.dataset.entity === 'guest') updateGuest(index, input.dataset.field, input.value);
      if (input.dataset.entity === 'award') updateAward(index, input.dataset.field, input.value);
      if (input.dataset.entity === 'ceremony') {
        db.ceremonies[index][input.dataset.field] = input.value;
        saveData();
      }
    });

    document.addEventListener('focusin', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.hasAttribute('data-mask-on-edit')) {
        input.type = 'text';
      }
    });

    document.addEventListener('focusout', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.hasAttribute('data-mask-on-edit')) {
        input.type = 'password';
      }
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const index = Number(button.dataset.index);
      switch (button.dataset.action) {
        case 'clear-overlay': clearOverlay(); break;
        case 'emergency-clear': emergencyClear(); break;
        case 'toggle-ticker': toggleTicker(); break;
        case 'save-now': saveNow(); break;
        case 'save-backup': saveBackup(); break;
        case 'add-guest': addGuestRow(); break;
        case 'add-award': addAwardRow(); break;
        case 'add-ceremony': addCeremony(); break;
        case 'add-ticker-line': addTickerLine(); break;
        case 'toggle-watermark': toggleWatermark(); break;
        case 'toggle-ceremony': toggleCeremony(index); break;
        case 'delete-ceremony': deleteCeremony(index); break;
        case 'toggle-guest': toggleGuest(index); break;
        case 'trigger-envelope': triggerEnvelope(index); break;
        case 'preview-award': previewAward(index); break;
        case 'toggle-award': toggleAward(index); break;
      }
    });

    init();
