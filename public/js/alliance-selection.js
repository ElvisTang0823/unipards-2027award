const allianceSelectionElement = document.getElementById("allianceSelection");
const allianceRankingsElement = document.getElementById("allianceRankings");
const allianceTimerBox = document.getElementById("allianceTimerBox");
const allianceTimerElement = document.getElementById("allianceSelectionTimer");
const allianceSelectionStatus = document.getElementById("allianceSelectionStatus");
let relaySocket;
let reconnectDelay = 1000;

function getCountdownString(seconds) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${Math.floor(safeSeconds / 60)}:${remainder}`;
}

function renderAlliances(alliances) {
  const table = document.createElement("table");
  table.id = "allianceSelectionTable";
  alliances.forEach(function (alliance, index) {
    if (!alliance || typeof alliance !== "object" || Array.isArray(alliance)) return;
    const row = table.insertRow();
    const allianceCell = row.insertCell();
    allianceCell.className = "alliance-cell";
    allianceCell.textContent = String(index + 1);
    const teamIds = Array.isArray(alliance.TeamIds) ? alliance.TeamIds : [];
    teamIds.forEach(function (teamId) {
      const cell = row.insertCell();
      cell.className = "selection-cell";
      cell.textContent = teamId ? String(teamId) : "";
    });
  });
  allianceSelectionElement.replaceChildren(table);
}

function renderRankedTeams(alliances, rankedTeams) {
  const captainSlotsRemaining = alliances.filter(function (alliance) {
    return Array.isArray(alliance.TeamIds) && alliance.TeamIds[0] === 0;
  }).length;
  const fragment = document.createDocumentFragment();
  let unpickedCount = 0;
  rankedTeams.forEach(function (team) {
    if (unpickedCount >= 20 || !team || team.Picked) return;
    const tile = document.createElement("div");
    tile.className = "unpicked";
    const rank = document.createElement("div");
    rank.className = "unpicked-rank";
    if (unpickedCount < captainSlotsRemaining) rank.dataset.captain = "true";
    rank.textContent = team.Rank === null || team.Rank === undefined ? "" : String(team.Rank);
    const teamId = document.createElement("div");
    teamId.className = "unpicked-team";
    teamId.textContent = team.TeamId === null || team.TeamId === undefined ? "" : String(team.TeamId);
    tile.append(rank, teamId);
    fragment.append(tile);
    unpickedCount += 1;
  });
  allianceRankingsElement.replaceChildren(fragment);
}

function renderAllianceSelection(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const alliances = Array.isArray(data.Alliances) ? data.Alliances : [];
  const rankedTeams = Array.isArray(data.RankedTeams) ? data.RankedTeams : [];
  renderAlliances(alliances);
  renderRankedTeams(alliances, rankedTeams);
  allianceTimerBox.classList.toggle("is-visible", data.ShowTimer === true);
  if (data.ShowTimer === true) {
    allianceTimerElement.textContent = getCountdownString(data.TimeRemainingSec);
  }
  allianceSelectionStatus.textContent = "";
}

function handleRelayMessage(message) {
  if (message.e === "arena-event" && message.t === "allianceSelection") {
    renderAllianceSelection(message.d);
  } else if (message.e === "arena-snapshot" && message.d && message.d.allianceSelection) {
    renderAllianceSelection(message.d.allianceSelection);
  } else if (message.e === "arena-connection") {
    allianceSelectionStatus.textContent = message.status === "connected"
      ? ""
      : `Cheesy Arena connection: ${message.status || "unknown"}`;
  }
}

function connectRelay() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  relaySocket = socket;
  socket.addEventListener("open", function () {
    reconnectDelay = 1000;
  });
  socket.addEventListener("message", function (event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring invalid alliance selection relay message:", error);
      return;
    }
    handleRelayMessage(message);
  });
  socket.addEventListener("close", function () {
    if (relaySocket === socket) relaySocket = null;
    allianceSelectionStatus.textContent = "Relay disconnected; reconnecting.";
    window.setTimeout(connectRelay, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
  socket.addEventListener("error", function () {
    socket.close();
  });
}

connectRelay();
