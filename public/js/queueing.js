const matchesElement = document.getElementById("matches");
const queueStatusElement = document.getElementById("queueStatus");
const connectionStatusElement = document.getElementById("connectionStatus");
let queueSocket;
let reconnectDelay = 1000;
let queueLoaded = false;
let latestMatchTime;
let latestQueueRequest = 0;

function setQueueStatus(message) {
  queueStatusElement.textContent = message;
  queueStatusElement.hidden = !message;
}

function setConnectionStatus(message) {
  connectionStatusElement.textContent = message;
  connectionStatusElement.hidden = !message;
}

function renderMatchTime() {
  if (!queueLoaded || !latestMatchTime || typeof matchTiming === "undefined" || !matchTiming) return;
  translateMatchTime(latestMatchTime, function (matchState, matchStateText, countdownSec) {
    document.getElementById("matchState").textContent = matchStateText;
    document.getElementById("matchTime").textContent = getCountdownString(countdownSec);
  });
}

async function refreshMatches() {
  const requestId = ++latestQueueRequest;
  queueLoaded = false;
  try {
    const response = await fetch("/api/pit-display/queueing/matches", {cache: "no-store"});
    if (!response.ok) {
      throw new Error(`Queueing match request failed (${response.status})`);
    }
    const html = await response.text();
    if (requestId !== latestQueueRequest) return;
    matchesElement.innerHTML = html;
    queueLoaded = true;
    setQueueStatus("");
    matchesElement.querySelectorAll(".avatar").forEach(function (avatar) {
      avatar.addEventListener("error", function () {
        this.src = "/assets/scoreboard/robot.png";
      }, {once: true});
    });
    renderMatchTime();
  } catch (error) {
    if (requestId !== latestQueueRequest) return;
    queueLoaded = matchesElement.querySelector(".card") !== null;
    setQueueStatus("無法取得排隊場次，將自動重試");
    console.error("Unable to load queueing matches:", error);
    renderMatchTime();
  }
}

function handleArenaEvent(type, data) {
  if (type === "eventStatus") {
    document.getElementById("earlyLateMessage").textContent = data.EarlyLateMessage || "";
  } else if (type === "matchLoad") {
    refreshMatches();
  } else if (type === "matchTime") {
    latestMatchTime = data;
    renderMatchTime();
  } else if (type === "matchTiming") {
    handleMatchTiming(data);
    renderMatchTime();
  }
}

function connectQueueSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  queueSocket = socket;
  socket.addEventListener("open", function () {
    reconnectDelay = 1000;
  });
  socket.addEventListener("message", function (event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring invalid queueing relay message:", error);
      return;
    }

    if (message.e === "arena-event") {
      handleArenaEvent(message.t, message.d);
    } else if (message.e === "arena-snapshot" && message.d) {
      Object.entries(message.d).forEach(function ([type, data]) {
        if (data !== null) handleArenaEvent(type, data);
      });
    } else if (message.e === "arena-connection") {
      const statusText = {
        connected: "",
        connecting: "正在連線至 Cheesy Arena…",
        reconnecting: "Cheesy Arena 連線中斷，正在重新連線…",
        "not-configured": "尚未設定 Cheesy Arena 顯示連線"
      };
      const status = Object.prototype.hasOwnProperty.call(statusText, message.status)
        ? statusText[message.status]
        : "Cheesy Arena 連線狀態未知";
      setConnectionStatus(status);
    }
  });
  socket.addEventListener("close", function () {
    if (queueSocket === socket) queueSocket = null;
    setConnectionStatus("本機資料連線中斷，正在重新連線…");
    window.setTimeout(connectQueueSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
  socket.addEventListener("error", function () {
    socket.close();
  });
}

refreshMatches();
connectQueueSocket();
