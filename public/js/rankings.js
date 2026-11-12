const rankingsContainer = document.querySelector('.rankings-container');
const scroller = document.getElementById('scroller');
const rankingsTables = [
  document.getElementById('rankings1'),
  document.getElementById('rankings2')
];
const rankingsStatus = document.getElementById('rankingsStatus');
const initialDwellMs = 3000;
const updateIntervalMs = 10000;
const requestedScrollMsPerRow = Number(new URLSearchParams(window.location.search).get('scrollMsPerRow'));
const scrollMsPerRow = Number.isFinite(requestedScrollMsPerRow) && requestedScrollMsPerRow > 0
  ? Math.min(requestedScrollMsPerRow, 30000)
  : 1000;
let rankingsData = null;
let cycleTimer;
let dataRefreshTimer;
let staticUpdateTimer;
const teamAvatarPreloads = new Map();

function displayValue(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function makeCell(value, className) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = displayValue(value);
  return cell;
}

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

function makeTeamCell(team) {
  const cell = document.createElement('td');
  const identity = document.createElement('div');
  identity.className = 'team-identity';

  const logo = document.createElement('img');
  logo.className = 'team-logo';
  logo.src = '/assets/logos/0.png';
  logo.alt = '';

  const teamId = displayValue(team.TeamId);
  const teamInfo = document.createElement('div');
  teamInfo.className = 'team-info';
  const number = document.createElement('div');
  number.className = 'team-number';
  number.textContent = teamId;
  const name = document.createElement('div');
  name.className = 'team-name';
  name.textContent = displayValue(team.Nickname);
  teamInfo.append(number, name);

  identity.append(logo, teamInfo);
  cell.append(identity);
  if (team.TeamId !== null && team.TeamId !== undefined && String(team.TeamId)) {
    logo.dataset.teamId = String(team.TeamId);
    preloadTeamAvatar(String(team.TeamId)).then((avatarUrl) => {
      if (avatarUrl && logo.isConnected && logo.dataset.teamId === String(team.TeamId)) {
        logo.src = avatarUrl;
      }
    });
  }
  return cell;
}

function renderRankings(table, data) {
  const body = document.createElement('tbody');
  for (const team of data.Rankings) {
    if (!team || typeof team !== 'object') continue;
    const row = document.createElement('tr');
    row.append(
      makeCell(team.Rank),
      makeTeamCell(team),
      makeCell(team.RankingPoints),
      makeCell(team.MatchPoints),
      makeCell(team.AutoFuelPoints),
      makeCell(team.TowerPoints),
      makeCell(`${displayValue(team.Wins)}-${displayValue(team.Losses)}-${displayValue(team.Ties)}`),
      makeCell(team.Disqualifications),
      makeCell(team.Played)
    );
    body.append(row);
  }
  table.replaceChildren(body);
}

async function getRankingsData() {
  try {
    const response = await fetch('/api/rankings', { cache: 'no-store' });
    if (!response.ok) throw new Error(`排名 API 回應 ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.Rankings)) throw new Error('排名資料格式不正確');
    rankingsData = data;
    rankingsStatus.textContent = '';
    return true;
  } catch (error) {
    console.error('無法取得排名資料：', error);
    rankingsStatus.textContent = '無法取得排名資料，將自動重試';
    return false;
  }
}

async function updateStaticRankings() {
  clearTimeout(staticUpdateTimer);
  if (!await getRankingsData()) {
    staticUpdateTimer = setTimeout(updateStaticRankings, updateIntervalMs);
    return;
  }

  renderRankings(rankingsTables[1], rankingsData);
  scroller.style.transition = 'none';
  scroller.style.transform = 'translateY(-2px)';
  if (rankingsTables[1].getBoundingClientRect().height > rankingsContainer.clientHeight) {
    cycleTimer = setTimeout(cycleRankings, initialDwellMs);
  } else {
    staticUpdateTimer = setTimeout(updateStaticRankings, updateIntervalMs);
  }
}

function cycleRankings() {
  clearTimeout(cycleTimer);
  clearTimeout(dataRefreshTimer);
  if (!rankingsData) {
    staticUpdateTimer = setTimeout(updateStaticRankings, updateIntervalMs);
    return;
  }

  rankingsTables[0].replaceChildren(
    ...Array.from(rankingsTables[1].childNodes, (node) => node.cloneNode(true))
  );
  scroller.style.transition = 'none';
  scroller.style.transform = 'translateY(-1px)';
  void scroller.offsetHeight;
  renderRankings(rankingsTables[1], rankingsData);

  const nextTableHeight = rankingsTables[1].getBoundingClientRect().height;
  if (nextTableHeight <= rankingsContainer.clientHeight) {
    rankingsTables[0].replaceChildren();
    scroller.style.transform = 'translateY(-2px)';
    staticUpdateTimer = setTimeout(updateStaticRankings, updateIntervalMs);
    return;
  }

  const rowCount = rankingsTables[0].rows.length;
  const tableHeight = rankingsTables[0].getBoundingClientRect().height;
  if (!rowCount || tableHeight <= rankingsContainer.clientHeight) {
    staticUpdateTimer = setTimeout(updateStaticRankings, updateIntervalMs);
    return;
  }

  const scrollDistance = tableHeight + parseInt(getComputedStyle(rankingsTables[0]).borderBottomWidth, 10);
  const scrollTime = scrollMsPerRow * rowCount;
  scroller.style.transition = `transform ${scrollTime}ms linear`;
  requestAnimationFrame(() => {
    scroller.style.transform = `translateY(-${scrollDistance}px)`;
  });

  cycleTimer = setTimeout(cycleRankings, scrollTime + 50);
  dataRefreshTimer = setTimeout(getRankingsData, Math.max(0, scrollTime - 2000));
}

updateStaticRankings();
window.addEventListener('resize', () => {
  if (rankingsData) updateStaticRankings();
});
