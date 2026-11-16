const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyArenaMessage,
  buildAudienceWebSocketUrl,
  buildBracketWebSocketUrl,
  buildMatchPlayWebSocketUrl,
  createArenaState
} = require('../arena-state');

test('stores supported audience events independently and preserves their payloads', () => {
  const initialState = createArenaState();
  const matchLoad = { Match: { LongName: 'Qualification 1' } };
  const realtimeScore = {
    Red: { Score: { Auto: 3 }, ScoreSummary: { Score: 19 } },
    Blue: { Score: { Auto: 5 }, ScoreSummary: { Score: 17 } }
  };

  const withMatch = applyArenaMessage(initialState, { type: 'matchLoad', data: matchLoad });
  const withTime = applyArenaMessage(withMatch, { type: 'matchTime', data: { MatchState: 2, MatchTimeSec: 8 } });
  const withScore = applyArenaMessage(withTime, { type: 'realtimeScore', data: realtimeScore });

  assert.deepEqual(withScore.matchLoad, matchLoad);
  assert.equal(withScore.matchTime.MatchTimeSec, 8);
  assert.equal(withScore.realtimeScore.Red.ScoreSummary.Score, 19);
  assert.equal(withScore.realtimeScore.Red.Score.Auto, 3);
  assert.equal(initialState.matchLoad, null);
});

test('merges partial events without clearing previously received alliance fields', () => {
  const initialState = createArenaState();
  const withScore = applyArenaMessage(initialState, {
    type: 'realtimeScore',
    data: {
      Red: { ScoreSummary: { Score: 31, FoulPoints: 4 } },
      Blue: { ScoreSummary: { Score: 27 } }
    }
  });
  const updatedScore = applyArenaMessage(withScore, {
    type: 'realtimeScore',
    data: { Red: { ScoreSummary: { Score: 35 } } }
  });

  assert.equal(updatedScore.realtimeScore.Red.ScoreSummary.Score, 35);
  assert.equal(updatedScore.realtimeScore.Red.ScoreSummary.FoulPoints, 4);
  assert.equal(updatedScore.realtimeScore.Blue.ScoreSummary.Score, 27);
});

test('ignores ping, unknown message types, and malformed supported payloads', () => {
  const state = createArenaState();
  assert.equal(applyArenaMessage(state, { type: 'ping', data: null }), null);
  assert.equal(applyArenaMessage(state, { type: 'audienceDisplayMode', data: null }), null);
  assert.equal(applyArenaMessage(state, { type: 'realtimeScore', data: null }), null);
  assert.equal(applyArenaMessage(state, { type: 'matchTiming', data: [] }), null);
  assert.equal(applyArenaMessage(state, null), null);
});

test('builds the official audience display endpoint with an encoded display ID', () => {
  assert.equal(
    buildAudienceWebSocketUrl('wss', '10.0.100.5', 'audience west'),
    'wss://10.0.100.5:8080/displays/audience/websocket?displayId=audience+west'
  );
  assert.equal(
    buildAudienceWebSocketUrl('ws:', 'localhost', 'audience-2'),
    'ws://localhost:8080/displays/audience/websocket?displayId=audience-2'
  );
});

test('builds the Cheesy Arena bracket websocket endpoint', () => {
  assert.equal(
    buildBracketWebSocketUrl('ws', 'localhost'),
    'ws://localhost:8080/displays/bracket/websocket'
  );
});

test('builds the official Match Play websocket endpoint', () => {
  assert.equal(
    buildMatchPlayWebSocketUrl('ws', 'localhost'),
    'ws://localhost:8080/match_play/websocket'
  );
});

test('stores audience display mode and score posting events', () => {
  const state = createArenaState();
  const withMode = applyArenaMessage(state, { type: 'audienceDisplayMode', data: 'score' });
  const withScore = applyArenaMessage(withMode, {
    type: 'scorePosted',
    data: { RedScoreSummary: { Score: 42 } }
  });

  assert.equal(withScore.audienceDisplayMode, 'score');
  assert.equal(withScore.scorePosted.RedScoreSummary.Score, 42);
});

test('stores queueing display event status', () => {
  const state = applyArenaMessage(createArenaState(), {
    type: 'eventStatus',
    data: { EarlyLateMessage: 'Matches are running on time' }
  });

  assert.equal(state.eventStatus.EarlyLateMessage, 'Matches are running on time');
});

test('rejects missing configuration and non-WebSocket protocols', () => {
  assert.throws(() => buildAudienceWebSocketUrl('http', '10.0.100.5', 'display-1'), /CHEESY_ARENA_PROTOCOL/);
  assert.throws(() => buildAudienceWebSocketUrl('ws', '', 'display-1'), /host is required/);
  assert.throws(() => buildAudienceWebSocketUrl('ws', 'localhost', ''), /CHEESY_ARENA_DISPLAY_ID/);
});
