// Copyright 2014 Team 254. All Rights Reserved.
// Author: pat@patfairbank.com (Patrick Fairbank)
// Author: nick@team254.com (Nick Eyre)
//
// Client-side methods for the audience display.

let websocket;
let websocketReconnectTimer = null;
let transitionMap;
const transitionQueue = [];
let transitionInProgress = false;
let currentScreen = "blank";
let redSide;
let blueSide;
let currentMatch;
let pendingMatchTimeData = null;
let overlayCenteringHideParams;
let overlayCenteringShowParams;
const sponsorImageTemplate = Handlebars.compile($("#sponsorImageTemplate").html());
const sponsorTextTemplate = Handlebars.compile($("#sponsorTextTemplate").html());
const isRecord = function (value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};
const toFiniteNumber = function (value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const applyDisplaySides = function (urlParams) {
  const reversed = urlParams.get("reversed") === "true";
  $("body").attr("data-reversed", String(reversed));
  $(".reversible-left, .reversible-right").attr("data-reversed", String(reversed));
  return {
    redSide: reversed ? "right" : "left",
    blueSide: reversed ? "left" : "right"
  };
};

const createHubActiveController = function (getCurrentScreen) {
  const activeProgressLength = 158;
  const progressStartOffsets = {
    left: toFiniteNumber($("#leftHubActive svg .active-progress").attr("stroke-dashoffset")) ?? 5,
    right: toFiniteNumber($("#rightHubActive svg .active-progress").attr("stroke-dashoffset")) ?? -5
  };
  const hubActiveStateBySide = {
    left: {
      active: false, lastRemainingSec: 0, lastDurationSec: 0, activeUntilTimeMs: null,
      hideTimeoutId: null, resetTimeoutId: null, animationFrameId: null, pendingRestart: false
    },
    right: {
      active: false, lastRemainingSec: 0, lastDurationSec: 0, activeUntilTimeMs: null,
      hideTimeoutId: null, resetTimeoutId: null, animationFrameId: null, pendingRestart: false
    }
  };

  const getProgressEndOffset = function (side) {
    return side === "left" ? activeProgressLength : -activeProgressLength;
  };
  const getProgressOffset = function (side, remainingSec, durationSec) {
    const progressRatio = Math.max(0, Math.min(remainingSec, durationSec)) / durationSec;
    return progressStartOffsets[side] + (1 - progressRatio) *
      (getProgressEndOffset(side) - progressStartOffsets[side]);
  };
  const getAdjustedRemainingSec = function (state) {
    return state.activeUntilTimeMs === null
      ? state.lastRemainingSec
      : Math.max(0, (state.activeUntilTimeMs - Date.now()) / 1000);
  };
  const restartAnimation = function (state, circle, side, remainingSec, durationSec) {
    if (state.animationFrameId !== null) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }
    circle.stop(true, true);
    circle.css("transition", "none");
    circle.css("stroke-dashoffset", getProgressOffset(side, remainingSec, durationSec));
    circle[0].getBoundingClientRect();
    state.animationFrameId = requestAnimationFrame(function () {
      circle.css("transition", `stroke-dashoffset ${remainingSec * 1000}ms linear`);
      circle.css("stroke-dashoffset", getProgressEndOffset(side));
      state.animationFrameId = null;
    });
  };
  const resetAnimation = function (state, circle, side) {
    if (!state.active) {
      circle.stop(true, true);
      circle.css("transition", "");
      circle.css("stroke-dashoffset", progressStartOffsets[side]);
    }
  };
  const cancelPendingReset = function (state, circle) {
    if (state.hideTimeoutId !== null) {
      clearTimeout(state.hideTimeoutId);
      state.hideTimeoutId = null;
    }
    if (state.resetTimeoutId !== null) {
      clearTimeout(state.resetTimeoutId);
      state.resetTimeoutId = null;
      circle.off("transitionend.hubActiveReset");
    }
  };
  const scheduleReset = function (state, circle, side) {
    const reset = function () {
      if (state.resetTimeoutId !== null) clearTimeout(state.resetTimeoutId);
      circle.off("transitionend.hubActiveReset");
      resetAnimation(state, circle, side);
      state.resetTimeoutId = null;
    };
    circle.off("transitionend.hubActiveReset");
    circle.on("transitionend.hubActiveReset", function (event) {
      if (event.originalEvent && event.originalEvent.propertyName === "opacity") reset();
    });
    state.resetTimeoutId = setTimeout(reset, 400);
  };

  return {
    restartPendingHubActiveIndicators: function () {
      for (const [side, state] of Object.entries(hubActiveStateBySide)) {
        const remainingSec = getAdjustedRemainingSec(state);
        if (!state.pendingRestart || !state.active || remainingSec <= 0 || state.lastDurationSec <= 0) continue;
        const circle = $(`#${side}HubActive svg .active-progress`);
        restartAnimation(state, circle, side, remainingSec, state.lastDurationSec);
        state.pendingRestart = false;
      }
    },
    updateHubActiveIndicator: function (side, remainingValue, durationValue) {
      const state = hubActiveStateBySide[side];
      const remainingSec = toFiniteNumber(remainingValue) ?? 0;
      const durationSec = toFiniteNumber(durationValue) ?? 0;
      const hub = $(`#${side}HubActive`);
      const circle = $(`#${side}HubActive svg .active-progress`);
      const text = $(`#${side}HubActive svg text`);
      const wasActive = state.active;

      if (remainingSec > 0 && durationSec > 0) {
        const shouldRestart = !state.active ||
          remainingSec > state.lastRemainingSec ||
          durationSec !== state.lastDurationSec;
        cancelPendingReset(state, circle);
        state.active = true;
        state.activeUntilTimeMs = Date.now() + remainingSec * 1000;
        state.pendingRestart = getCurrentScreen() !== "match";
        hub.attr("data-active", "true");
        text.text(Math.ceil(remainingSec));
        if (shouldRestart) {
          if (state.pendingRestart) {
            circle.stop(true, true);
            circle.css("transition", "");
            circle.css("stroke-dashoffset", getProgressOffset(side, remainingSec, durationSec));
          } else {
            restartAnimation(state, circle, side, remainingSec, durationSec);
          }
        }
      } else {
        state.active = false;
        state.activeUntilTimeMs = null;
        state.pendingRestart = false;
        text.text("");
        if (state.animationFrameId !== null) {
          cancelAnimationFrame(state.animationFrameId);
          state.animationFrameId = null;
        }
        if (wasActive) {
          state.hideTimeoutId = setTimeout(function () {
            hub.attr("data-active", "false");
            scheduleReset(state, circle, side);
            state.hideTimeoutId = null;
          }, 500);
        } else if (state.hideTimeoutId === null && state.resetTimeoutId === null) {
          resetAnimation(state, circle, side);
          hub.attr("data-active", "false");
        }
      }
      state.lastRemainingSec = remainingSec;
      state.lastDurationSec = durationSec;
    }
  };
};
const hubActiveController = createHubActiveController(function () { return currentScreen; });

const getAvatarUrl = function (teamId) {
  return teamId ? `/api/teams/${encodeURIComponent(teamId)}/avatar` : "/assets/scoreboard/robot.png";
};

const setTeamAvatar = function (element, teamId) {
  element.off("error").on("error", function () {
    this.src = "/assets/scoreboard/robot.png";
  });
  element.attr("src", getAvatarUrl(teamId));
};

const isPlayoffMatch = function (match) {
  return Boolean(match && (match.Type === 3 || String(match.Type || "").toLowerCase() === "playoff"));
};

const getMatchName = function (match) {
  return [match.LongName, match.NameDetail]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" – ");
};

// Constants for overlay positioning. The CSS is the source of truth for the values that represent initial state.
const overlayCenteringTopUp = -130;
const overlayCenteringBottomDown = parseFloat($("#overlayCentering").css("bottom"));
const eventMatchInfoDown = "30px";
const eventMatchInfoUp = $("#eventMatchInfo").css("height");
const logoUp = "35px";
const logoDown = $("#logo").css("top");
const scoreIn = $(".score").css("width");
const scoreMid = "185px";
const scoreOut = "400px";
const scoreFieldsOut = "180px";
const scoreLogoTop = "-530px";
const bracketLogoTop = "-780px";
const bracketLogoScale = 0.75;
const timeoutDetailsIn = $("#timeoutDetails").css("width");
const timeoutDetailsOut = "100vw";
let audiencePosition = "bottom";
let audienceZoomFactor = 1;
const audienceOverlayReferenceWidth = 1080;

const applyAudiencePosition = function (position, animate = true) {
  if (position !== "top" && position !== "bottom") return;
  audiencePosition = position;
  const atTop = position === "top";
  const overlayCentering = $("#overlayCentering");
  if (atTop) {
    overlayCenteringHideParams = {queue: false, top: overlayCenteringTopUp * audienceZoomFactor + "px"};
    overlayCenteringShowParams = {queue: false, top: 50 * audienceZoomFactor + "px"};
    overlayCentering.css({
      transformOrigin: "center top",
      bottom: "auto",
      top: overlayCenteringHideParams.top
    });
    $("#timeoutDetails").css({transformOrigin: "center top", bottom: "auto", top: 0});
  } else {
    overlayCenteringHideParams = {
      queue: false,
      bottom: overlayCenteringBottomDown * audienceZoomFactor + "px"
    };
    overlayCenteringShowParams = {queue: false, bottom: "0px"};
    overlayCentering.css({
      transformOrigin: "center bottom",
      top: "auto",
      bottom: overlayCenteringHideParams.bottom
    });
    $("#timeoutDetails").css({transformOrigin: "center bottom", top: "auto", bottom: 0});
  }
  if (animate && (currentScreen === "intro" || currentScreen === "match")) {
    overlayCentering.transition(overlayCenteringShowParams, 500, "ease");
  }
};

// Handles a websocket message to change which screen is displayed.
const handleAudienceDisplayMode = function (targetScreen) {
  transitionQueue.push(targetScreen);
  executeTransitionQueue();
};

// Sequentially executes all transitions in the queue. Returns without doing anything if another invocation is already
// in progress.
const executeTransitionQueue = function () {
  if (transitionInProgress) {
    // There is an existing invocation of this method which will execute all transitions in the queue.
    return;
  }

  if (transitionQueue.length > 0) {
    transitionInProgress = true;
    const targetScreen = transitionQueue.shift();
    const callback = function () {
      // When the current transition is complete, call this method again to invoke the next one in the queue.
      currentScreen = targetScreen;
      transitionInProgress = false;
      setTimeout(executeTransitionQueue, 100);  // A small delay is needed to avoid visual glitches.
    };

    if (targetScreen === currentScreen) {
      callback();
      return;
    }

    if (targetScreen === "sponsor") {
      initializeSponsorDisplay();
    }

    let transitions = transitionMap[currentScreen][targetScreen];
    if (transitions !== undefined) {
      transitions(callback);
    } else {
      // There is no direct transition defined; need to go to the blank screen first.
      transitionMap[currentScreen]["blank"](function () {
        transitionMap["blank"][targetScreen](callback);
      });
    }
  }
};

// Handles a websocket message to update the teams for the current match.
const handleMatchLoad = function (data) {
  const match = isRecord(data.Match) ? data.Match : {};
  currentMatch = match;
  const playoff = isPlayoffMatch(match);
  const matchup = isRecord(data.Matchup) ? data.Matchup : {};
  for (const [alliance, side] of [["Red", redSide], ["Blue", blueSide]]) {
    const stationPrefix = alliance === "Red" ? "R" : "B";
    for (let position = 1; position <= 3; position += 1) {
      const teamId = match[`${alliance}${position}`];
      const teamNumber = $(`#${side}Team${position}`);
      teamNumber.text(teamId || "");
      if (teamId) teamNumber.css("display", "flex");
      else teamNumber.hide();
      const avatar = $(`#${side}Team${position}Avatar`);
      setTeamAvatar(avatar, teamId);
      avatar.toggle(Boolean(teamId));

      const station = isRecord(data.Teams) ? data.Teams[`${stationPrefix}${position}`] : null;
      const hasCard = playoff
        ? data[`Playoff${alliance}AllianceYellowCard`] === true
        : isRecord(station) && (station.YellowCard === true || station.Card === "yellow");
      teamNumber.attr("data-yellow-card", String(hasCard));
    }

    const playoffAlliance = $(`#${side}PlayoffAlliance`);
    playoffAlliance.text(playoff ? String(match[`Playoff${alliance}Alliance`] || "") : "");
    if (playoff) playoffAlliance.css("display", "flex");
    else playoffAlliance.hide();
    $(`#${side}PlayoffAllianceWins`)
      .text(playoff ? matchup[`${alliance}AllianceWins`] ?? data[`${alliance}AllianceWins`] ?? "" : "");
    $(`#timeout-match-${side}`)
      .text(playoff ? `ALLIANCE ${match[`Playoff${alliance}Alliance`] || ""}` : "")
      .removeClass("timeout-match-red timeout-match-blue")
      .addClass(alliance === "Red" ? "timeout-match-red" : "timeout-match-blue");
  }
  if (playoff && toFiniteNumber(matchup.NumWinsToAdvance) > 1) {
    $("#playoffSeriesStatus").css("display", "flex");
  } else {
    $("#playoffSeriesStatus").hide();
  }
  $(".timeout-match-info").toggle(playoff);
  const matchName = getMatchName(match);
  $("#matchName").text(matchName);
  $("#Timeout-Name").text(matchName);
};

// Handles a websocket message to update the match time countdown.
const hasMatchTimingFor = function (data) {
  if (typeof matchTiming === "undefined" || !isRecord(matchTiming)) return false;
  const requiredFields = {
    0: ["AutoDurationSec"],
    1: ["AutoDurationSec"],
    2: ["AutoDurationSec"],
    4: [
      "AutoDurationSec",
      "TransitionShiftDurationSec",
      "ShiftDurationSec",
      "EndgameDurationSec",
      "PauseDurationSec"
    ],
    6: ["TimeoutDurationSec"]
  }[data.MatchState] || [];
  return requiredFields.every(function (field) {
    const value = matchTiming[field];
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  });
};

const handleMatchTime = function (data) {
  if (!isRecord(data)) return;
  if (!hasMatchTimingFor(data)) {
    pendingMatchTimeData = data;
    return;
  }
  pendingMatchTimeData = null;
  translateMatchTime(data, function (matchState, matchStateText, countdownSec) {
    $("body").attr("data-match-state", matchState);
    $("#matchTime").text(matchState === "POST_MATCH" ? "0:00" : getCountdownString(countdownSec));
    $("#Timeout-timer").text(matchState === "TIMEOUT_ACTIVE" ? getCountdownString(countdownSec) : "0:00");
  });

  // The official layout shows the shift row only during Teleop.
  const isTeleop = data.MatchState === 5;
  $("#shiftCounter, #shiftTime").toggle(isTeleop);
  if (isTeleop) {
    $("#currentShift").text(data.CurrentShift);
    $("#shiftTime").text(`:${String(data.ShiftTimeSec).padStart(2, "0")}`);
  }
};

// Handles a websocket message to update the match score.
const handleRealtimeScore = function (data) {
  const playoff = isPlayoffMatch(currentMatch);
  for (const [alliance, side] of [["Red", redSide], ["Blue", blueSide]]) {
    const allianceData = isRecord(data[alliance]) ? data[alliance] : {};
    const summary = isRecord(allianceData.ScoreSummary) ? allianceData.ScoreSummary : {};
    const totalScore = toFiniteNumber(summary.Score ?? allianceData.Score);
    const postMatchPoints = toFiniteNumber(summary.PostMatchPoints) || 0;
    const score = totalScore === null ? null : totalScore - postMatchPoints;
    const totalFuel = toFiniteNumber(summary.NumFuel);
    const postMatchFuel = toFiniteNumber(summary.NumFuelPostMatch) || 0;
    const currentFuel = totalFuel === null ? null : Math.max(0, totalFuel - postMatchFuel);
    const fuelGoal = toFiniteNumber(summary.NumFuelGoal);

    $(`#${side}ScoreNumber`).text(score === null ? "" : String(score));
    $(`#${side}FuelNumerator`).text(currentFuel === null ? "" : String(currentFuel));
    $(`#${side}FuelDenominator`).text(!playoff && fuelGoal !== null && fuelGoal > 0 ? `/${fuelGoal}` : "");
    hubActiveController.updateHubActiveIndicator(
      side, allianceData.ActiveRemainingSec, allianceData.ActiveDurationSec
    );
  }
};

const setFinalResultIndicator = function (side, label, result) {
  const indicator = $(`#${side}FinalResultIndicator`);
  indicator.text(label);
  indicator.attr("data-result", result);
};
// Handles a websocket message to populate the final score data.
const handleScorePosted = function (data) {
  $(".traversal-bonus-field").toggle(data.TraversalBonusEnabled);

  if (data.RedWon) {
    setFinalResultIndicator(redSide, "WINNER", "winner");
    setFinalResultIndicator(blueSide, "", "");
  } else if (data.BlueWon) {
    setFinalResultIndicator(redSide, "", "");
    setFinalResultIndicator(blueSide, "WINNER", "winner");
  } else {
    setFinalResultIndicator(redSide, "TIE", "tie");
    setFinalResultIndicator(blueSide, "TIE", "tie");
  }
  const tiebreakReason = data.TiebreakReason || "";
  $("#finalTiebreakReason").text(tiebreakReason);
  $("#finalTiebreakReason").attr("data-visible", tiebreakReason !== "");

  $(`#${redSide}FinalScore`).text(data.RedScoreSummary.Score);
  $(`#${redSide}FinalAlliance`).text("Alliance " + data.Match.PlayoffRedAlliance);
  setTeamInfo(redSide, 1, data.Match.Red1, getPostedCard(data, "Red", data.Match.Red1), data.RedRankings);
  setTeamInfo(redSide, 2, data.Match.Red2, getPostedCard(data, "Red", data.Match.Red2), data.RedRankings);
  setTeamInfo(redSide, 3, data.Match.Red3, getPostedCard(data, "Red", data.Match.Red3), data.RedRankings);
  if (data.RedOffFieldTeamIds.length > 0) {
    setTeamInfo(redSide, 4, data.RedOffFieldTeamIds[0], getPostedCard(data, "Red", data.RedOffFieldTeamIds[0]), data.RedRankings);
  } else {
    setTeamInfo(redSide, 4, 0, getPostedCard(data, "Red", 0), data.RedRankings);
  }
  $(`#${redSide}FinalAutoFuelPoints`).text(data.RedScoreSummary.AutoFuelPoints);
  $(`#${redSide}FinalAutoTowerPoints`).text(data.RedScoreSummary.AutoTowerPoints);
  $(`#${redSide}FinalTeleopFuelPoints`).text(data.RedScoreSummary.TeleopFuelPoints);
  $(`#${redSide}FinalTeleopTowerPoints`).text(data.RedScoreSummary.TeleopTowerPoints);
  $(`#${redSide}FinalFoulPoints`).text(data.RedScoreSummary.FoulPoints);
  $(`#${redSide}FinalEnergizedBonusRankingPoint img`)
    .toggleClass("RedGetRP", data.RedScoreSummary.EnergizedBonusRankingPoint)
    .toggleClass("NoGetRP", !data.RedScoreSummary.EnergizedBonusRankingPoint);
  $(`#${redSide}FinalEnergizedBonusRankingPoint`).attr(
    "data-checked", data.RedScoreSummary.EnergizedBonusRankingPoint
  );
  $(`#${redSide}FinalSuperchargedBonusRankingPoint img`)
    .toggleClass("RedGetRP", data.RedScoreSummary.SuperchargedBonusRankingPoint)
    .toggleClass("NoGetRP", !data.RedScoreSummary.SuperchargedBonusRankingPoint);
  $(`#${redSide}FinalSuperchargedBonusRankingPoint`).attr(
    "data-checked", data.RedScoreSummary.SuperchargedBonusRankingPoint
  );
  $(`#${redSide}FinalTraversalBonusRankingPoint img`)
    .toggleClass("RedGetRP", data.RedScoreSummary.TraversalBonusRankingPoint)
    .toggleClass("NoGetRP", !data.RedScoreSummary.TraversalBonusRankingPoint);
  $(`#${redSide}FinalTraversalBonusRankingPoint`).attr(
    "data-checked", data.RedScoreSummary.TraversalBonusRankingPoint
  );
  //$(`#${redSide}FinalRankingPoints`).html(data.RedRankingPoints);
  $(`#${redSide}FinalWins`).text(data.RedWins);
  const redFinalDestination = $(`#${redSide}FinalDestination`);
  redFinalDestination.html(data.RedDestination.replace("Advances to ", "Advances to<br>"));
  redFinalDestination.toggle(data.RedDestination !== "");
  redFinalDestination.attr("data-won", data.RedWon);
  let $imgs1 =$(`#${redSide}FinalRankingPoints img`);
  $imgs1.removeClass('RedGetRP');
  let $RedWinRP = Math.max(0, data.RedRankingPoints - $('div.playoff-hidden-field.final-rank-point img.RedGetRP').length);
  $imgs1.slice(0, $RedWinRP).addClass('RedGetRP').removeClass('NoGetRP');
  $imgs1.slice($RedWinRP).addClass('NoGetRP').removeClass('RedGetRP');
  $(`#${blueSide}FinalScore`).text(data.BlueScoreSummary.Score);
  $(`#${blueSide}FinalAlliance`).text("Alliance " + data.Match.PlayoffBlueAlliance);
  setTeamInfo(blueSide, 1, data.Match.Blue1, getPostedCard(data, "Blue", data.Match.Blue1), data.BlueRankings);
  setTeamInfo(blueSide, 2, data.Match.Blue2, getPostedCard(data, "Blue", data.Match.Blue2), data.BlueRankings);
  setTeamInfo(blueSide, 3, data.Match.Blue3, getPostedCard(data, "Blue", data.Match.Blue3), data.BlueRankings);
  if (data.BlueOffFieldTeamIds.length > 0) {
    setTeamInfo(blueSide, 4, data.BlueOffFieldTeamIds[0], getPostedCard(data, "Blue", data.BlueOffFieldTeamIds[0]), data.BlueRankings);
  } else {
    setTeamInfo(blueSide, 4, 0, getPostedCard(data, "Blue", 0), data.BlueRankings);
  }
  $(`#${blueSide}FinalAutoFuelPoints`).text(data.BlueScoreSummary.AutoFuelPoints);
  $(`#${blueSide}FinalAutoTowerPoints`).text(data.BlueScoreSummary.AutoTowerPoints);
  $(`#${blueSide}FinalTeleopFuelPoints`).text(data.BlueScoreSummary.TeleopFuelPoints);
  $(`#${blueSide}FinalTeleopTowerPoints`).text(data.BlueScoreSummary.TeleopTowerPoints);
  $(`#${blueSide}FinalFoulPoints`).text(data.BlueScoreSummary.FoulPoints);
  $(`#${blueSide}FinalEnergizedBonusRankingPoint img`)
    .toggleClass("BlueGetRP", data.BlueScoreSummary.EnergizedBonusRankingPoint)
    .toggleClass("NoGetRP", !data.BlueScoreSummary.EnergizedBonusRankingPoint);
  $(`#${blueSide}FinalEnergizedBonusRankingPoint`).attr(
    "data-checked", data.BlueScoreSummary.EnergizedBonusRankingPoint
  );
  $(`#${blueSide}FinalSuperchargedBonusRankingPoint img`)
    .toggleClass("BlueGetRP", data.BlueScoreSummary.SuperchargedBonusRankingPoint)
    .toggleClass("NoGetRP", !data.BlueScoreSummary.SuperchargedBonusRankingPoint);
  $(`#${blueSide}FinalSuperchargedBonusRankingPoint`).attr(
    "data-checked", data.BlueScoreSummary.SuperchargedBonusRankingPoint
  );
    $(`#${blueSide}FinalTraversalBonusRankingPoint img`)
    .toggleClass("BlueGetRP", data.BlueScoreSummary.TraversalBonusRankingPoint)
    .toggleClass("NoGetRP", !data.BlueScoreSummary.TraversalBonusRankingPoint);
  $(`#${blueSide}FinalTraversalBonusRankingPoint`).attr(
    "data-checked", data.BlueScoreSummary.TraversalBonusRankingPoint
  );
  //$(`#${blueSide}FinalRankingPoints`).html(data.BlueRankingPoints);
  $(`#${blueSide}FinalWins`).text(data.BlueWins);
  const blueFinalDestination = $(`#${blueSide}FinalDestination`);
  blueFinalDestination.html(data.BlueDestination.replace("Advances to ", "Advances to<br>"));
  blueFinalDestination.toggle(data.BlueDestination !== "");
  blueFinalDestination.attr("data-won", data.BlueWon);
  let $imgs2 =$(`#${blueSide}FinalRankingPoints img`);
  $imgs2.removeClass('BlueGetRP');
  let $BlueWinRP = Math.max(0, data.BlueRankingPoints - $('div.playoff-hidden-field.final-rank-point img.BlueGetRP').length);
  console.log("BlueWinRP: " + $BlueWinRP);
  $imgs2.slice(0, $BlueWinRP).addClass('BlueGetRP').removeClass('NoGetRP');
  $imgs2.slice($BlueWinRP).addClass('NoGetRP').removeClass('BlueGetRP');
  $("#finalMatchName").text(getMatchName(data.Match) || "\u00a0");

  // Reload the bracket to reflect any changes.
  $("#bracketSvg").attr("src", "/api/bracket/svg?activeMatch=saved&v=" + new Date().getTime());

  if (data.Match.Type === matchTypePlayoff) {
    // Hide bonus ranking points and show playoff-only fields.
    $(".playoff-hidden-field").hide();
    $(".playoff-only-field").show();
  } else {
    $(".playoff-hidden-field").show();
    $(".playoff-only-field").hide();
  }
};

// Handles a websocket message to play a sound to signal match start/stop/etc.
const handlePlaySound = function (sound) {
  $("audio").each(function (k, v) {
    // Stop and reset any sounds that are still playing.
    v.pause();
    v.currentTime = 0;
  });
  const soundElement = $("#sound-" + sound)[0];
  if (soundElement) soundElement.play().catch(function () {});
};

// Handles a websocket message to update the alliance selection screen.
const handleAllianceSelection = function (data) {
  const alliances = Array.isArray(data.Alliances) ? data.Alliances.filter(isRecord) : [];
  const rankedTeams = data.RankedTeams;
  if (alliances && alliances.length > 0) {
    const table = $("<table>", {id: "allianceSelectionTable"});
    alliances.forEach(function (alliance, index) {
      const row = $("<tr>");
      $("<td>", {class: "alliance-cell"}).text(index + 1).appendTo(row);
      (Array.isArray(alliance.TeamIds) ? alliance.TeamIds : []).forEach(function (teamId) {
        $("<td>", {class: "selection-cell"}).text(teamId || "").appendTo(row);
      });
      row.appendTo(table);
    });
    $("#allianceSelection").empty().append(table);
  }
  if (rankedTeams) {
    const captainSlotsRemaining = (alliances || [])
      .filter(function (alliance) { return alliance.TeamIds[0] === 0; })
      .length;

    let text = "";
    let unpickedCount = 0;
    $.each(rankedTeams, function (i, v) {
      if (unpickedCount >= 20) {
        return false;
      }
      if (!v.Picked) {
        let tileClass = unpickedCount < captainSlotsRemaining ? "data-captain='true'" : "";
        text += `<div class="unpicked"><div class="unpicked-rank" ${tileClass}>${v.Rank}</div>` +
          `<div class="unpicked-team">${v.TeamId}</div></div>`;
        unpickedCount++;
      }
    });
    $("#allianceRankings").html(text);
  }

  if (data.ShowTimer) {
    $("#allianceSelectionTimer").text(getCountdownString(data.TimeRemainingSec));
    $("#allianceTimerBox").show();
  } else {
    $("#allianceTimerBox").hide();
  }
};

// Handles a websocket message to populate and/or show/hide a lower third.
const handleLowerThird = function (data) {
  if (data.LowerThird !== null) {
    if (data.LowerThird.BottomText === "") {
      $("#lowerThirdTop").hide();
      $("#lowerThirdBottom").hide();
      $("#lowerThirdSingle").text(data.LowerThird.TopText);
      $("#lowerThirdSingle").show();
    } else {
      $("#lowerThirdSingle").hide();
      $("#lowerThirdTop").text(data.LowerThird.TopText);
      $("#lowerThirdBottom").text(data.LowerThird.BottomText);
      $("#lowerThirdTop").show();
      $("#lowerThirdBottom").show();
    }
  }

  const lowerThirdElement = $("#lowerThird");
  if (data.ShowLowerThird && !lowerThirdElement.is(":visible")) {
    lowerThirdElement.show();
    lowerThirdElement.transition({queue: false, left: "70px"}, 750, "ease");
  } else if (!data.ShowLowerThird && lowerThirdElement.is(":visible")) {
    lowerThirdElement.transition({queue: false, left: "-1000px"}, 1000, "ease", function () {
      lowerThirdElement.hide();
    });
  }
};
const transitionAllianceSelectionToBlank = function (callback) {
  $('#allianceSelectionBackground').hide();
  $('#allianceSelectionCentering').transition({queue: false, right: "-60em"}, 500, "ease", callback);
  $('#allianceRankingsCentering.enabled').transition({queue: false, left: "-60em"}, 500, "ease");
};

const transitionBlankToAllianceSelection = function (callback) {
  $('#allianceSelectionBackground').show();
  $('#allianceSelectionCentering').css("right", "-60em").show();
  $('#allianceSelectionCentering').transition({queue: false, right: "6vw"}, 500, "ease", callback);
  $('#allianceRankingsCentering.enabled').css("left", "-60em").show();
  $('#allianceRankingsCentering.enabled').transition({queue: false, left: "4vw"}, 500, "ease");
};

const transitionBlankToBracket = function (callback) {
  transitionBlankToLogo(function () {
    setTimeout(function () {
      transitionLogoToBracket(callback);
    }, 50);
  });
};

const handleMatchTimingMessage = function (data) {
  if (!isRecord(data)) return;
  handleMatchTiming(data);
  if (pendingMatchTimeData && hasMatchTimingFor(pendingMatchTimeData)) {
    const pending = pendingMatchTimeData;
    pendingMatchTimeData = null;
    handleMatchTime(pending);
  }
};

const transitionBlankToIntro = function (callback) {
  $("#overlayCentering").transition(overlayCenteringShowParams, 500, "ease", function () {
    $(".teams").css("display", "flex");
    $(".avatars").css("display", "flex");
    $(".avatars").css("opacity", 1);
    $(".score").transition({queue: false, width: scoreMid}, 500, "ease", function () {
      $("#eventMatchInfo").css("display", "flex");
      $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoDown}, 500, "ease", callback);
    });
  });
};

const transitionBlankToLogo = function (callback) {
  $(".blindsCenter.blank").css({rotateY: "0deg"});
  $(".blindsCenter.full").css({rotateY: "-180deg"});
  $(".blinds.right").transition({queue: false, right: 0}, 1000, "ease");
  $(".blinds.left").transition({queue: false, left: 0}, 1000, "ease", function () {
    $(".blinds.left").addClass("full");
    $(".blinds.right").hide();
    setTimeout(function () {
      $(".blindsCenter.blank").transition({queue: false, rotateY: "180deg"}, 500, "ease");
      $(".blindsCenter.full").transition({queue: false, rotateY: "0deg"}, 500, "ease", callback);
    }, 200);
  });
};

const transitionBlankToLogoLuma = function (callback) {
  $(".blindsCenter.blank").css({rotateY: "180deg"});
  $(".blindsCenter.full").transition({queue: false, rotateY: "0deg"}, 1000, "ease", callback);
};

const transitionBlankToMatch = function (callback) {
  $("#overlayCentering").transition(overlayCenteringShowParams, 500, "ease", function () {
    $(".teams").css("display", "flex");
    $(".score-fields").css("display", "flex");
    $(".score-fields").transition({queue: false, width: scoreFieldsOut}, 500, "ease");
    $("#logo").transition({queue: false, top: logoUp}, 500, "ease");
    $(".score").transition({queue: false, width: scoreOut}, 500, "ease", function () {
      $("#eventMatchInfo").css("display", "flex");
      $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoDown}, 500, "ease", callback);
      $(".score-number").transition({queue: false, opacity: 1}, 750, "ease");
      $("#matchTime").transition({queue: false, opacity: 1}, 750, "ease");
      $(".score-fields").transition({queue: false, opacity: 1}, 750, "ease");
      hubActiveController.restartPendingHubActiveIndicators();
    });
  });
};

const transitionBlankToScore = function (callback) {
  transitionBlankToLogo(function () {
    setTimeout(function () {
      transitionLogoToScore(callback);
    }, 50);
  });
};

const transitionBlankToSponsor = function (callback) {
  $(".blindsCenter.blank").css({rotateY: "90deg"});
  $(".blinds.right").transition({queue: false, right: 0}, 1000, "ease");
  $(".blinds.left").transition({queue: false, left: 0}, 1000, "ease", function () {
    $(".blinds.left").addClass("full");
    $(".blinds.right").hide();
    setTimeout(function () {
      $("#sponsor").show();
      $("#sponsor").transition({queue: false, opacity: 1}, 1000, "ease", callback);
    }, 200);
  });
};

const transitionBlankToTimeout = function (callback) {
  $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoUp}, 500, "ease", function () {
    $("#eventMatchInfo").hide();
    $(".score").transition({queue: false, width: scoreIn}, 500, "ease", function () {
      $(".avatars").css("opacity", 0);
      $(".avatars").hide();
      $(".teams").hide();
      $("#overlayCentering").transition(overlayCenteringHideParams, 1000, "ease", callback);
    });
  });
  $("#timeoutDetails").transition({queue: false, opacity: 1}, 500, "ease");
};

const transitionBracketToBlank = function (callback) {
  transitionBracketToLogo(function () {
    transitionLogoToBlank(callback);
  });
};

const transitionBracketToLogo = function (callback) {
  $("#bracket").transition({queue: false, opacity: 0}, 500, "ease", function () {
    $("#bracket").hide();
  });
  $(".blindsCenter.full").transition({queue: false, top: 0, scale: 1}, 625, "ease", callback);
};

const transitionBracketToLogoLuma = function (callback) {
  transitionBracketToLogo(function () {
    transitionLogoToLogoLuma(callback);
  });
};

const transitionBracketToScore = function (callback) {
  $(".blindsCenter.full").transition({queue: false, top: scoreLogoTop, scale: 1}, 1000, "ease");
  $("#bracket").transition({queue: false, opacity: 0}, 1000, "ease", function () {
    $("#bracket").hide();
    $("#finalScore").show();
    $("#finalScore").transition({queue: false, opacity: 1}, 1000, "ease", callback);
  });
};

const transitionBracketToSponsor = function (callback) {
  transitionBracketToLogo(function () {
    transitionLogoToSponsor(callback);
  });
};

const transitionIntroToBlank = function (callback) {
  $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoUp}, 500, "ease", function () {
    $("#eventMatchInfo").hide();
    $(".score").transition({queue: false, width: scoreIn}, 500, "ease", function () {
      $(".avatars").css("opacity", 0);
      $(".avatars").hide();
      $(".teams").hide();
      $("#overlayCentering").transition(overlayCenteringHideParams, 1000, "ease", callback);
    });
  });
};

const transitionIntroToMatch = function (callback) {
  $(".avatars").transition({queue: false, opacity: 0}, 500, "ease", function () {
    $(".avatars").hide();
  });
  $(".score-fields").css("display", "flex");
  $(".score-fields").transition({queue: false, width: scoreFieldsOut}, 500, "ease");
  $("#logo").transition({queue: false, top: logoUp}, 500, "ease");
  $(".score").transition({queue: false, width: scoreOut}, 500, "ease", function () {
    $(".score-number").transition({queue: false, opacity: 1}, 750, "ease");
    $("#matchTime").transition({queue: false, opacity: 1}, 750, "ease", callback);
    $(".score-fields").transition({queue: false, opacity: 1}, 750, "ease");
    hubActiveController.restartPendingHubActiveIndicators();
  });
};

/*const transitionIntroToTimeout = function (callback) {
  $("#timeoutDetails").transition({queue: false, width: timeoutDetailsOut, opacity: 1}, 500, "ease");
  $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoUp}, 500, "ease", function () {
    $("#eventMatchInfo").hide();
    $(".score").transition({queue: false, width: scoreIn}, 500, "ease", function () {
      $(".avatars").css("opacity", 0);
      $(".avatars").hide();
      $(".teams").hide();
      $("#overlayCentering").transition(overlayCenteringHideParams, 1000, "ease", callback);
    });
  });
};*/

const transitionLogoToBlank = function (callback) {
  $(".blindsCenter.blank").transition({queue: false, rotateY: "360deg"}, 500, "ease");
  $(".blindsCenter.full").transition({queue: false, rotateY: "180deg"}, 500, "ease", function () {
    setTimeout(function () {
      $(".blinds.left").removeClass("full");
      $(".blinds.right").show();
      $(".blinds.right").transition({queue: false, right: "-50%"}, 1000, "ease");
      $(".blinds.left").transition({queue: false, left: "-50%"}, 1000, "ease", callback);
    }, 200);
  });
};

const transitionLogoToBracket = function (callback) {
  $(".blindsCenter.full").transition({queue: false, top: bracketLogoTop, scale: bracketLogoScale}, 625, "ease");
  $("#bracket").show();
  $("#bracket").transition({queue: false, opacity: 1}, 1000, "ease", callback);
};

const transitionLogoToLogoLuma = function (callback) {
  $(".blinds.left").removeClass("full");
  $(".blinds.right").show();
  $(".blinds.right").transition({queue: false, right: "-50%"}, 1000, "ease");
  $(".blinds.left").transition({queue: false, left: "-50%"}, 1000, "ease", function () {
    if (callback) {
      callback();
    }
  });
};

const transitionLogoToScore = function (callback) {
  $(".blindsCenter.full").transition({queue: false, top: scoreLogoTop}, 625, "ease");
  $("#finalScore").show();
  $("#finalScore").transition({queue: false, opacity: 1}, 1000, "ease", callback);
};

const transitionLogoToSponsor = function (callback) {
  $(".blindsCenter.full").transition({queue: false, rotateY: "90deg"}, 750, "ease", function () {
    $("#sponsor").show();
    $("#sponsor").transition({queue: false, opacity: 1}, 1000, "ease", callback);
  });
};

const transitionLogoLumaToBlank = function (callback) {
  $(".blindsCenter.full").transition({queue: false, rotateY: "180deg"}, 1000, "ease", callback);
};

const transitionLogoLumaToBracket = function (callback) {
  transitionLogoLumaToLogo(function () {
    transitionLogoToBracket(callback);
  });
};

const transitionLogoLumaToLogo = function (callback) {
  $(".blinds.right").transition({queue: false, right: 0}, 1000, "ease");
  $(".blinds.left").transition({queue: false, left: 0}, 1000, "ease", function () {
    $(".blinds.left").addClass("full");
    $(".blinds.right").hide();
    if (callback) {
      callback();
    }
  });
};

const transitionLogoLumaToScore = function (callback) {
  transitionLogoLumaToLogo(function () {
    transitionLogoToScore(callback);
  });
};

const transitionMatchToBlank = function (callback) {
  $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoUp}, 500, "ease");
  $("#matchTime").transition({queue: false, opacity: 0}, 300, "linear");
  $(".score-fields").transition({queue: false, opacity: 0}, 300, "ease");
  $(".score-number").transition({queue: false, opacity: 0}, 300, "linear", function () {
    $("#eventMatchInfo").hide();
    $(".score-fields").transition({queue: false, width: 0}, 500, "ease");
    $("#logo").transition({queue: false, top: logoDown}, 500, "ease");
    $(".score").transition({queue: false, width: scoreIn}, 500, "ease", function () {
      $(".teams").hide();
      $(".score-fields").hide();
      $("#overlayCentering").transition(overlayCenteringHideParams, 1000, "ease", callback);
    });
  });
};

const transitionMatchToIntro = function (callback) {
  $(".score-number").transition({queue: false, opacity: 0}, 300, "linear");
  $(".score-fields").transition({queue: false, opacity: 0}, 300, "ease");
  $("#matchTime").transition({queue: false, opacity: 0}, 300, "linear", function () {
    $(".score-fields").transition({queue: false, width: 0}, 500, "ease");
    $("#logo").transition({queue: false, top: logoDown}, 500, "ease");
    $(".score").transition({queue: false, width: scoreMid}, 500, "ease", function () {
      $(".score-fields").hide();
      $(".avatars").css("display", "flex");
      $(".avatars").transition({queue: false, opacity: 1}, 500, "ease", callback);
    });
  });
};

const transitionScoreToBlank = function (callback) {
  transitionScoreToLogo(function () {
    transitionLogoToBlank(callback);
  });
};

const transitionScoreToBracket = function (callback) {
  $(".blindsCenter.full").transition({queue: false, top: bracketLogoTop, scale: bracketLogoScale}, 1000, "ease");
  $("#finalScore").transition({queue: false, opacity: 0}, 1000, "ease", function () {
    $("#finalScore").hide();
    $("#bracket").show();
    $("#bracket").transition({queue: false, opacity: 1}, 1000, "ease", callback);
  });
};

const transitionScoreToLogo = function (callback) {
  $("#finalScore").transition({queue: false, opacity: 0}, 500, "ease", function () {
    $("#finalScore").hide();
  });
  $(".blindsCenter.full").transition({queue: false, top: 0}, 625, "ease", callback);
};

const transitionScoreToLogoLuma = function (callback) {
  transitionScoreToLogo(function () {
    transitionLogoToLogoLuma(callback);
  });
};

const transitionScoreToSponsor = function (callback) {
  transitionScoreToLogo(function () {
    transitionLogoToSponsor(callback);
  });
};

const transitionSponsorToBlank = function (callback) {
  $("#sponsor").transition({queue: false, opacity: 0}, 1000, "ease", function () {
    setTimeout(function () {
      $(".blinds.left").removeClass("full");
      $(".blinds.right").show();
      $(".blinds.right").transition({queue: false, right: "-50%"}, 1000, "ease");
      $(".blinds.left").transition({queue: false, left: "-50%"}, 1000, "ease", callback);
      $("#sponsor").hide();
    }, 200);
  });
};

const transitionSponsorToBracket = function (callback) {
  transitionSponsorToLogo(function () {
    transitionLogoToBracket(callback);
  });
};

const transitionSponsorToLogo = function (callback) {
  $("#sponsor").transition({queue: false, opacity: 0}, 1000, "ease", function () {
    $(".blindsCenter.full").transition({queue: false, rotateY: "0deg"}, 750, "ease", callback);
    $("#sponsor").hide();
  });
};

const transitionSponsorToScore = function (callback) {
  transitionSponsorToLogo(function () {
    transitionLogoToScore(callback);
  });
};

const transitionTimeoutToBlank = function (callback) {
  $(".timeout-detail").transition({queue: false, opacity: 0}, 300, "linear");
  $("#timeoutDetails").transition({queue: false, width: timeoutDetailsIn, opacity: 0}, 500, "ease");

  $("#matchTime").transition({queue: false, opacity: 0}, 300, "linear", function () {
    $("#logo").transition({queue: false, top: logoDown}, 500, "ease", function () {
      $("#overlayCentering").transition(overlayCenteringHideParams, 1000, "ease", callback);
    });
  });
};

/*const transitionTimeoutToIntro = function (callback) {
  $(".timeout-detail").transition({queue: false, opacity: 0}, 300, "linear");
  $("#timeoutDetails").transition({queue: false, width: timeoutDetailsIn, opacity: 0}, 500, "ease");

  $("#matchTime").transition({queue: false, opacity: 0}, 300, "linear", function () {
    $("#logo").transition({queue: false, top: logoDown}, 500, "ease", function () {
      $(".avatars").css("display", "flex");
      $(".avatars").css("opacity", 1);
      $(".teams").css("display", "flex");
      $(".score").transition({queue: false, width: scoreMid}, 500, "ease", function () {
        $("#eventMatchInfo").show();
        $("#eventMatchInfo").transition({queue: false, height: eventMatchInfoDown}, 500, "ease", callback);
      });
    });
  });
};*/

// Loads sponsor slide data and builds the slideshow HTML.
const initializeSponsorDisplay = function () {
  $.getJSON("/api/sponsor_slides").done(function (slides) {
    $("#sponsorContainer").empty();
    if (slides.length === 0) {
      $("#sponsorContainer").html('<div class="carousel-item active"><h1>Sponsor 投影片尚未設定</h1></div>');
      return;
    }

    // Inject the HTML for each slide into the DOM.
    $.each(slides, function (index, slide) {
      slide.DisplayTimeMs = slide.DisplayTimeSec * 1000;
      slide.First = index === 0;

      let slideHtml;
      if (slide.Image) {
        slideHtml = sponsorImageTemplate(slide);
      } else {
        slideHtml = sponsorTextTemplate(slide);
      }
      $("#sponsorContainer").append(slideHtml);
    });
  }).fail(function () {
    $("#audienceConnectionStatus")
      .text("無法載入 Sponsor 投影片")
      .attr("data-visible", "true");
  });
};

// Resolve the card without consulting individual team entries during playoffs.
const getPostedCard = function (data, alliance, teamId) {
  if (!teamId) return "";
  return isPlayoffMatch(data.Match)
    ? data[`Playoff${alliance}AllianceCard`]
    : data[`${alliance}Cards`][teamId.toString()];
};

const setTeamInfo = function (side, position, teamId, card, rankings) {
  const teamNumberElement = $(`#${side}FinalTeam${position}`);
  teamNumberElement.text(teamId);
  teamNumberElement.toggle(teamId > 0);
  const avatarElement = $(`#${side}FinalTeam${position}Avatar`);
  setTeamAvatar(avatarElement, teamId);
  avatarElement.toggle(teamId > 0);

  const cardElement = $(`#${side}FinalTeam${position}Card`);
  cardElement.attr("data-card", card || "");

  const ranking = rankings && rankings[teamId];
  let rankIndicator = "";
  let rankNumber = "";
  if (ranking !== undefined && ranking !== null && ranking.Rank !== 0) {
    rankNumber = ranking.Rank;
    if (rankNumber > ranking.PreviousRank && ranking.PreviousRank > 0) {
      rankIndicator = "rank-down";
    } else if (rankNumber < ranking.PreviousRank) {
      rankIndicator = "rank-up";
    }
  }

  const rankIndicatorElement = $(`#${side}FinalTeam${position}RankIndicator`);
  rankIndicatorElement.attr("src", rankIndicator === "" ? "" : `/assets/scoreboard/${rankIndicator}.svg`);
  rankIndicatorElement.toggle(rankIndicator !== "" && teamId > 0);

  const rankNumberElement = $(`#${side}FinalTeam${position}RankNumber`);
  rankNumberElement.text(rankNumber);
  rankNumberElement.toggle(teamId > 0);
};

$(function () {
  // Read the configuration for this display from the URL query string.
  const urlParams = new URLSearchParams(window.location.search);
  document.body.style.backgroundColor = urlParams.get("background");
  const sides = applyDisplaySides(urlParams);
  redSide = sides.redSide;
  blueSide = sides.blueSide;

  // Scale only the overlay, including its offsets so it slides fully offscreen at any zoom.
  const configuredZoomFactor = Number(urlParams.get("zoomFactor"));
  const requestedZoomFactor = Number.isFinite(configuredZoomFactor) && configuredZoomFactor > 0
    ? configuredZoomFactor
    : 1;
  const viewportFitFactor = window.innerWidth > 0
    ? Math.min(1, window.innerWidth / audienceOverlayReferenceWidth)
    : 1;
  audienceZoomFactor = requestedZoomFactor * viewportFitFactor;
  $("#overlayCentering").css("transform", `scale(${audienceZoomFactor})`);
  const requestedPosition = urlParams.get("overlayLocation");
  applyAudiencePosition(requestedPosition === "top" ? "top" : "bottom", false);

  const eventHandlers = {
    allianceSelection: function (event) {
      handleAllianceSelection(event.data);
    },
    audienceDisplayMode: function (event) {
      handleAudienceDisplayMode(event.data);
    },
    lowerThird: function (event) {
      handleLowerThird(event.data);
    },
    matchLoad: function (event) {
      handleMatchLoad(event.data);
    },
    matchTime: function (event) {
      handleMatchTime(event.data);
    },
    matchTiming: function (event) {
      handleMatchTimingMessage(event.data);
    },
    playSound: function (event) {
      handlePlaySound(event.data);
    },
    realtimeScore: function (event) {
      handleRealtimeScore(event.data);
    },
    scorePosted: function (event) {
      handleScorePosted(event.data);
    },
  };

  const dispatchArenaEvent = function (type, data) {
    if (eventHandlers[type]) eventHandlers[type]({data: data});
  };

  const setConnectionStatus = function (message) {
    $("#audienceConnectionStatus")
      .text(message || "")
      .attr("data-visible", message ? "true" : "false");
  };

  const connectToRelay = function () {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    websocket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    websocket.addEventListener("open", function () {
      websocketReconnectTimer = null;
      const requestedMode = urlParams.get("mode");
      if (requestedMode) {
        websocket.send(JSON.stringify({e: "audience-set-mode", mode: requestedMode}));
      }
    });
    websocket.addEventListener("message", function (event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (message.e === "arena-event") {
        dispatchArenaEvent(message.t, message.d);
      } else if (message.e === "arena-snapshot" && message.d) {
        Object.entries(message.d).forEach(function ([type, data]) {
          if (data !== null) dispatchArenaEvent(type, data);
        });
      } else if (message.e === "audience-matchplay-status") {
        setConnectionStatus(message.status === "connected" ? "" : `Match Play ${message.status}`);
      } else if (message.e === "audience-position") {
        applyAudiencePosition(message.v);
      } else if (message.e === "audience-command-error") {
        setConnectionStatus(message.message || "Unable to change the audience display mode.");
      }
    });
    websocket.addEventListener("close", function () {
      setConnectionStatus("Reconnecting to audience relay...");
      if (!websocketReconnectTimer) {
        websocketReconnectTimer = window.setTimeout(connectToRelay, 1000);
      }
    });
    websocket.addEventListener("error", function () {
      websocket.close();
    });
  };

  ["left", "right"].forEach(function (side) {
    let rows = "";
    for (let position = 1; position <= 4; position += 1) {
      rows += `<div class="final-team-row">
        <img class="final-team-avatar" id="${side}FinalTeam${position}Avatar" src="" alt="">
        <div class="final-team-number" id="${side}FinalTeam${position}"></div>
        <div class="final-team-card"><div id="${side}FinalTeam${position}Card"></div></div>
        <div class="final-team-rank playoff-hidden-field">
          <img id="${side}FinalTeam${position}RankIndicator" src="" alt="">
          <div id="${side}FinalTeam${position}RankNumber"></div>
        </div>
      </div>`;
    }
    $(`#${side}FinalTeamRows`).html(rows);
  });

  // Map how to transition from one screen to another. Missing links between screens indicate that first we
  // must transition to the blank screen and then to the target screen.
  transitionMap = {
    allianceSelection: {
      blank: transitionAllianceSelectionToBlank,
    },
    blank: {
      allianceSelection: transitionBlankToAllianceSelection,
      bracket: transitionBlankToBracket,
      intro: transitionBlankToIntro,
      logo: transitionBlankToLogo,
      logoLuma: transitionBlankToLogoLuma,
      match: transitionBlankToMatch,
      score: transitionBlankToScore,
      sponsor: transitionBlankToSponsor,
      timeout: transitionBlankToTimeout,
    },
    bracket: {
      blank: transitionBracketToBlank,
      logo: transitionBracketToLogo,
      logoLuma: transitionBracketToLogoLuma,
      score: transitionBracketToScore,
      sponsor: transitionBracketToSponsor,
    },
    intro: {
      blank: transitionIntroToBlank,
      match: transitionIntroToMatch
    },
    logo: {
      blank: transitionLogoToBlank,
      bracket: transitionLogoToBracket,
      logoLuma: transitionLogoToLogoLuma,
      score: transitionLogoToScore,
      sponsor: transitionLogoToSponsor,
    },
    logoLuma: {
      blank: transitionLogoLumaToBlank,
      bracket: transitionLogoLumaToBracket,
      logo: transitionLogoLumaToLogo,
      score: transitionLogoLumaToScore,
    },
    match: {
      blank: transitionMatchToBlank,
      intro: transitionMatchToIntro,
    },
    score: {
      blank: transitionScoreToBlank,
      bracket: transitionScoreToBracket,
      logo: transitionScoreToLogo,
      logoLuma: transitionScoreToLogoLuma,
      sponsor: transitionScoreToSponsor,
    },
    sponsor: {
      blank: transitionSponsorToBlank,
      bracket: transitionSponsorToBracket,
      logo: transitionSponsorToLogo,
      score: transitionSponsorToScore,
    },
    timeout: {
      blank: transitionTimeoutToBlank
    },
  }
  connectToRelay();
});
