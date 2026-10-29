const wrapper = document.getElementById('lowerThirdWrapper');
    const ltContent = document.getElementById('ltContent');

    const envContainer = document.getElementById('envelopeContainer');
    const envAwardName = document.getElementById('envAwardName');
    const envCard = document.getElementById('envelopeCard');
    const tickerBar = document.getElementById('tickerBar');
    const tickerTrack = document.getElementById('tickerTrack');
    const watermark = document.getElementById('watermark');
    const ceremonyRibbon = document.getElementById('ceremonyRibbon');
    const ceremonyTitle = document.getElementById('ceremonyTitle');
    const ceremonySubtitle = document.getElementById('ceremonySubtitle');
    const displayWhere = new URLSearchParams(window.location.search).get('where');
    const tickerWhere = displayWhere === 'up' ? 'up' : 'down';
    if (displayWhere === 'top') watermark.classList.add('where-top');

    let autoTransitionTimer = null;
    let currentLowerThirdContent = null;
    let lowerThirdTransitionId = 0;
    let data = { guests: [], awards: [], tickerLines: [] };
    let compactState = { t: 'n', i: '', s: 'idle' };
    let tickerVisible = false;
    let ceremonyVisible = false;
    let activeCeremonyId = '';
    const teamAvatarPreloads = new Map();

    function preloadTeamAvatar(teamId) {
      if (teamAvatarPreloads.has(teamId)) return teamAvatarPreloads.get(teamId);

      const avatarUrl = `/api/teams/${encodeURIComponent(teamId)}/avatar`;
      const image = new Image();
      const preload = new Promise((resolve) => {
        image.addEventListener('load', () => resolve(avatarUrl), { once: true });
        image.addEventListener('error', () => {
          teamAvatarPreloads.delete(teamId);
          resolve(null);
        }, { once: true });
      });
      teamAvatarPreloads.set(teamId, preload);
      image.src = avatarUrl;
      return preload;
    }

    function preloadTeamAvatars(awards) {
      const teamIds = new Set();
      for (const award of awards || []) {
        for (const teamId of String(award.winnerTeams || '').trim().split(/\s+/)) {
          if (/^[A-Za-z0-9_-]+$/.test(teamId)) teamIds.add(teamId);
        }
      }
      for (const teamId of teamIds) preloadTeamAvatar(teamId);
    }

    function renderCeremony(ceremony = {}) {
      ceremonyTitle.textContent = ceremony.title || '';
      ceremonySubtitle.textContent = ceremony.subtitle || '';
    }

    function renderCompactState(message) {
      compactState = message;
      const activeType = message.t === 'g' ? 'guest' : message.t === 'a' ? 'award' : 'none';
      const items = activeType === 'guest' ? data.guests : activeType === 'award' ? data.awards : [];
      const payload = items.find((item) => String(item.id) === String(message.i)) || {};
      const stage = message.s === 'oe' ? 'opening_envelope' : message.s === 'sl' ? 'showing_lower_third' : message.s;
      renderState({ activeType, stage, payload });
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
        if (message.e === 'k') {
          tickerVisible = message.v === 1;
          updateTicker({ visible: tickerVisible, lines: data.tickerLines });
        }
        if (message.e === 'w') watermark.classList.toggle('is-visible', message.v === 1);
        if (message.e === 'c') {
          ceremonyVisible = message.v === 1;
          activeCeremonyId = ceremonyVisible ? message.i || '' : '';
          const ceremony = (data.ceremonies || []).find((item) => item.id === activeCeremonyId);
          renderCeremony(ceremony);
          ceremonyRibbon.classList.toggle('is-visible', ceremonyVisible);
          ceremonyRibbon.setAttribute('aria-hidden', String(!ceremonyVisible));
        }
        if (message.e === 'd') {
          data = message.d;
          renderCeremony((data.ceremonies || []).find((item) => item.id === activeCeremonyId));
          preloadTeamAvatars(data.awards);
          updateTicker({ visible: tickerVisible, lines: data.tickerLines });
          renderCompactState(compactState);
        }
      });
      socket.addEventListener('close', () => window.setTimeout(connectSocket, 1000));
    }
    connectSocket();

    fetch('/api/data', { cache: 'no-store' })
      .then((response) => response.json())
      .then((loadedData) => {
        data = loadedData;
        renderCeremony((data.ceremonies || []).find((item) => item.id === activeCeremonyId));
        preloadTeamAvatars(data.awards);
        updateTicker({ visible: tickerVisible, lines: data.tickerLines });
        renderCompactState(compactState);
      })
      .catch(() => {});

    function updateTicker(ticker) {
      tickerBar.className = `where-${tickerWhere}`;
      const lines = Array.isArray(ticker.lines) ? ticker.lines.filter((line) => String(line).trim()) : [];

      if (ticker.visible && lines.length) {
        tickerTrack.replaceChildren();
        const copy = document.createElement('div');
        copy.className = 'ticker-copy';
        lines.forEach((line, index) => {
          if (index > 0) copy.append('　　◆　　');
          copy.append(document.createTextNode(line));
        });
        copy.append('　　◆　　');
        tickerTrack.append(copy);

        const copyWidth = copy.getBoundingClientRect().width;
        const copiesPerLoop = Math.max(1, Math.ceil(tickerBar.clientWidth / copyWidth));
        for (let copyIndex = 1; copyIndex < copiesPerLoop * 2; copyIndex += 1) {
          tickerTrack.append(copy.cloneNode(true));
        }

        const loopWidth = copyWidth * copiesPerLoop;
        tickerTrack.style.animation = 'none';
        void tickerTrack.offsetWidth;
        tickerTrack.style.animation = '';
        tickerTrack.style.animationDuration = `${Math.max(18, loopWidth / 100)}s`;
        tickerTrack.style.animationPlayState = 'running';
        tickerBar.classList.add('is-visible');
      } else {
        tickerTrack.style.animationPlayState = 'paused';
        tickerBar.classList.remove('is-visible');
      }
    }

    function updateLowerThird(content, signature) {
      if (currentLowerThirdContent === signature) return;
      currentLowerThirdContent = signature;
      const transitionId = ++lowerThirdTransitionId;
      const showNewContent = () => {
        if (transitionId !== lowerThirdTransitionId) return;
        ltContent.replaceChildren(content);
        requestAnimationFrame(() => wrapper.classList.add('is-visible'));
      };

      if (wrapper.classList.contains('is-visible')) {
        wrapper.classList.remove('is-visible');
        window.setTimeout(showNewContent, 220);
      } else {
        showNewContent();
      }
    }

    function showAwardLowerThird(payload) {
      const awardName = payload.name || '獎項名稱';
      const teamIds = String(payload.winnerTeams || '').trim().split(/\s+/).filter(Boolean);
      const layout = document.createElement('div');
      layout.className = 'award-layout';
      const left = document.createElement('div');
      left.className = 'award-left';
      left.textContent = awardName;
      const right = document.createElement('div');
      right.className = 'award-right';
      const winner = createTeamDisplay(teamIds, 'award-winner-main');
      const winnerName = document.createElement('div');
      winnerName.className = 'guest-job';
      winnerName.textContent = payload.winnerName || '';
      right.append(winner, winnerName);
      layout.append(left, right);

      updateLowerThird(layout, `award:${JSON.stringify([payload.id, awardName, teamIds, payload.winnerName])}`);

      // 隱藏信封，彈出下方字條
      envContainer.classList.remove('is-visible');
    }

    function createTeamDisplay(teamIds, className) {
      const container = document.createElement('div');
      container.className = className;
      const validTeamIds = teamIds.filter((teamId) => /^[A-Za-z0-9_-]+$/.test(teamId));
      validTeamIds.forEach((teamId, index) => {
        if (index > 0) {
          const separator = document.createElement('span');
          separator.className = 'award-team-separator';
          separator.textContent = '·';
          container.append(separator);
        }

        const team = document.createElement('span');
        team.className = 'award-team-item';
        const logo = document.createElement('img');
        logo.className = 'award-team-logo';
        logo.alt = '';
        logo.src = '/assets/logos/0.png';
        preloadTeamAvatar(teamId).then((avatarUrl) => {
          if (avatarUrl) logo.src = avatarUrl;
        });
        const label = document.createElement('span');
        label.textContent = `FRC${teamId}`;
        team.append(logo, label);
        container.append(team);
      });
      return container;
    }

    function renderState(state) {
      // 清除舊有的定時器與動畫
      if (autoTransitionTimer) {
        clearTimeout(autoTransitionTimer);
        autoTransitionTimer = null;
      }
      if (state.activeType === 'none') {
        currentLowerThirdContent = null;
        lowerThirdTransitionId += 1;
        wrapper.classList.remove('is-visible');
        envContainer.classList.remove('is-visible');
        return;
      }

      // 1. 致詞嘉賓
      if (state.activeType === 'guest') {
        envContainer.classList.remove('is-visible');

        const org = state.payload.org || '';
        const name = state.payload.name || '';
        const job = state.payload.jobTitle || '';

        const layout = document.createElement('div');
        layout.className = 'guest-layout';
        if (org) {
          const organization = document.createElement('div');
          organization.className = 'guest-org';
          organization.textContent = org;
          layout.append(organization);
        }
        const nameRow = document.createElement('div');
        nameRow.className = 'guest-name-row';
        const guestName = document.createElement('span');
        guestName.className = 'guest-name';
        guestName.textContent = name;
        nameRow.append(guestName);
        if (job) {
          const jobTitle = document.createElement('span');
          jobTitle.className = 'guest-job';
          jobTitle.textContent = job;
          nameRow.append(jobTitle);
        }
        layout.append(nameRow);
        updateLowerThird(layout, `guest:${JSON.stringify([state.payload.id, org, name, job])}`);
      }

      // 2. 開信封 (全螢幕卡片 2 秒後自動自動過渡至下方 Lower Third)
      if (state.activeType === 'award' && state.stage === 'opening_envelope') {
        currentLowerThirdContent = null;
        lowerThirdTransitionId += 1;
        wrapper.classList.remove('is-visible');

        const teamIds = String(state.payload.winnerTeams || '').trim().split(/\s+/).filter(Boolean);
        envAwardName.innerText = state.payload.name || '獎項名稱';
        envCard.replaceChildren(createTeamDisplay(teamIds, 'envelope-team-row'));
        envCard.style.fontSize = teamIds.length > 2 ? '3rem' : '3.2rem';

        envContainer.classList.remove('is-visible');
        requestAnimationFrame(() => envContainer.classList.add('is-visible'));

        // 設定 2000ms (2秒) 後自動執行下底字卡動畫
        autoTransitionTimer = setTimeout(() => {
          showAwardLowerThird(state.payload);
        }, 1500);
      }

      // 3. 直接觸發下底字卡 (手動 Mode)
      if (state.activeType === 'award' && state.stage === 'showing_lower_third') {
        showAwardLowerThird(state.payload);
      }
    }
