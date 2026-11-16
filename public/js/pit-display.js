const pitDisplayStatus = document.getElementById("pitDisplayStatus");
const pitDisplayFrames = new Map(
  Array.from(document.querySelectorAll(".pit-display-frame"), function (frame) {
    return [frame.dataset.display, frame];
  })
);
let currentPitDisplay = "practice";
let matchLoadDisplay = "practice";
let allianceSelectionActive = false;
let pitDisplaySocket;
let reconnectDelay = 1000;

function showPitDisplay(display) {
  const selectedFrame = pitDisplayFrames.get(display);
  if (!selectedFrame || display === currentPitDisplay) return;
  pitDisplayFrames.forEach(function (frame, name) {
    const active = name === display;
    frame.classList.toggle("is-active", active);
    frame.setAttribute("aria-hidden", String(!active));
    frame.tabIndex = active ? 0 : -1;
  });
  currentPitDisplay = display;
}

function getPitDisplayForMatch(match) {
  if (!match || typeof match !== "object" || Array.isArray(match)) return null;
  const type = String(match.Type).toLowerCase();
  if (type === "0" || type === "test" || String(match.LongName || "").toLowerCase().includes("test match")) {
    return null;
  }
  if (type === "1" || type.includes("practice")) return "practice";
  if (type === "2" || type.includes("qualification") || type === "qual") return "qualification";
  if (type === "3" || type.includes("playoff") || type.includes("elimination")) return "playoff";
  return null;
}

function setPitDisplayForMatchLoad(data) {
  const match = data && data.Match && typeof data.Match === "object" ? data.Match : data;
  const display = getPitDisplayForMatch(match);
  if (!display) return;
  matchLoadDisplay = display;
  if (!allianceSelectionActive) showPitDisplay(matchLoadDisplay);
}

function setPitDisplayForAllianceSelection(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  allianceSelectionActive = data.ShowTimer === true
    || (Array.isArray(data.Alliances) && data.Alliances.length > 0)
    || (Array.isArray(data.RankedTeams) && data.RankedTeams.length > 0);
  showPitDisplay(allianceSelectionActive ? "playoff" : matchLoadDisplay);
}

function handlePitDisplayMessage(message) {
  if (message.e === "arena-event" && message.t === "matchLoad") {
    setPitDisplayForMatchLoad(message.d);
  } else if (message.e === "arena-event" && message.t === "allianceSelection") {
    setPitDisplayForAllianceSelection(message.d);
  } else if (message.e === "arena-snapshot" && message.d) {
    if (message.d.matchLoad) setPitDisplayForMatchLoad(message.d.matchLoad);
    if (message.d.allianceSelection) setPitDisplayForAllianceSelection(message.d.allianceSelection);
  } else if (message.e === "arena-connection") {
    pitDisplayStatus.textContent = message.status === "connected"
      ? ""
      : `Cheesy Arena connection: ${message.status || "unknown"}`;
  }
}

function connectPitDisplaySocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  pitDisplaySocket = socket;
  socket.addEventListener("open", function () {
    reconnectDelay = 1000;
  });
  socket.addEventListener("message", function (event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring invalid pit display relay message:", error);
      return;
    }
    handlePitDisplayMessage(message);
  });
  socket.addEventListener("close", function () {
    if (pitDisplaySocket === socket) pitDisplaySocket = null;
    pitDisplayStatus.textContent = "Pit display relay disconnected; reconnecting.";
    window.setTimeout(connectPitDisplaySocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
  socket.addEventListener("error", function () {
    socket.close();
  });
}

connectPitDisplaySocket();
