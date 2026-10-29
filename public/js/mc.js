const liveTitle = document.getElementById('liveTitle');
    const liveDetail = document.getElementById('liveDetail');
    let data = { guests: [], awards: [] };
    let liveState = { activeType: 'none', stage: 'idle', payload: {} };
    let compactState = { t: 'n', i: '', s: 'idle' };

    function makeNote(item, type) {
      const label = document.createElement('label');
      label.className = 'note-label';
      label.append(document.createTextNode('現場筆記 · 發音 / 提醒 / 致謝'));
      const note = document.createElement('textarea');
      const storageKey = `nks-mc-note:${type}:${item.id || item.name || item.org}`;
      note.value = localStorage.getItem(storageKey) || '';
      note.placeholder = '僅保存在這台裝置的瀏覽器';
      note.addEventListener('input', () => localStorage.setItem(storageKey, note.value));
      label.append(note);
      return label;
    }

    function makeCard(item, type, detail) {
      const card = document.createElement('article');
      const isLive = liveState.activeType === type && liveState.payload?.id === item.id;
      if (isLive) card.classList.add('is-live');
      const info = document.createElement('div');
      const badge = document.createElement('div');
      badge.className = 'item-type';
      badge.textContent = isLive ? '目前正在大螢幕顯示' : (type === 'guest' ? '致詞嘉賓' : '獎項');
      const title = document.createElement('h3');
      title.className = 'item-title';
      title.textContent = type === 'guest' ? (item.name || '未命名嘉賓') : (item.name || '未命名獎項');
      const subtitle = document.createElement('p');
      subtitle.className = 'item-detail';
      subtitle.textContent = detail;
      info.append(badge, title, subtitle);
      card.append(info, makeNote(item, type));
      return card;
    }

    function render() {
      const guestList = document.getElementById('guestList');
      const awardList = document.getElementById('awardList');
      guestList.replaceChildren();
      awardList.replaceChildren();
      (data.guests || []).forEach((guest) => {
        guestList.append(makeCard(guest, 'guest', [guest.org, guest.jobTitle].filter(Boolean).join(' · ')));
      });
      (data.awards || []).forEach((award) => {
        const teams = String(award.winnerTeams || '').trim().split(/\s+/).filter(Boolean).map((team) => `Team ${team}`).join(' · ');
        awardList.append(makeCard(award, 'award', [teams, award.winnerName].filter(Boolean).join(' · ')));
      });
      document.getElementById('empty').hidden = Boolean(guestList.childElementCount || awardList.childElementCount);
    }

    function renderLiveState(state) {
      liveState = state || { activeType: 'none', stage: 'idle', payload: {} };
      const isActive = liveState.activeType !== 'none';
      const liveBadge = document.getElementById('liveBadge');
      liveBadge.textContent = isActive ? 'PGM LIVE · 正在播出' : 'PGM 待命';
      liveBadge.classList.toggle('is-active', isActive);
      if (liveState.activeType === 'guest') {
        liveTitle.textContent = liveState.payload.name || '致詞嘉賓';
        liveDetail.textContent = [liveState.payload.org, liveState.payload.jobTitle].filter(Boolean).join(' · ');
      } else if (liveState.activeType === 'award') {
        liveTitle.textContent = liveState.payload.name || '頒獎流程';
        const teams = String(liveState.payload.winnerTeams || '').trim().split(/\s+/).filter(Boolean).map((team) => `Team ${team}`).join(' · ');
        liveDetail.textContent = `${liveState.stage === 'opening_envelope' ? '開信封' : '下底字卡'}${teams ? ` · ${teams}` : ''}`;
      } else {
        liveTitle.textContent = '目前沒有字卡';
        liveDetail.textContent = '等待導播發送';
      }
      render();
    }

    function renderCompactState(message) {
      compactState = message;
      const activeType = message.t === 'g' ? 'guest' : message.t === 'a' ? 'award' : 'none';
      const items = activeType === 'guest' ? data.guests : activeType === 'award' ? data.awards : [];
      const payload = items.find((item) => String(item.id) === String(message.i)) || {};
      const stage = message.s === 'oe' ? 'opening_envelope' : message.s === 'sl' ? 'showing_lower_third' : message.s;
      renderLiveState({ activeType, stage, payload });
    }

    async function loadData() {
      try {
        const response = await fetch('/api/data', { cache: 'no-store' });
        if (!response.ok) throw new Error('資料讀取失敗');
        data = await response.json();
        render();
        renderCompactState(compactState);
      } catch (error) {
        liveDetail.textContent = '流程資料暫時無法載入';
      }
    }

    function connectSocket() {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        if (message.e === 's') renderCompactState(message);
        if (message.e === 'd') {
          data = message.d;
          render();
          renderCompactState(compactState);
        }
      });
      socket.addEventListener('close', () => window.setTimeout(connectSocket, 1000));
    }
    connectSocket();
    loadData();
