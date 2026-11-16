const ARENA_EVENT_TYPES = new Set([
  'allianceSelection',
  'audienceDisplayMode',
  'displayConfiguration',
  'eventStatus',
  'lowerThird',
  'matchLoad',
  'matchTime',
  'matchTiming',
  'playSound',
  'realtimeScore',
  'reload',
  'scorePosted'
]);
const STRING_EVENT_TYPES = new Set(['audienceDisplayMode', 'playSound']);
const OPTIONAL_STRING_EVENT_TYPES = new Set(['displayConfiguration', 'reload']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createArenaState() {
  return {
    allianceSelection: null,
    audienceDisplayMode: null,
    displayConfiguration: null,
    eventStatus: null,
    lowerThird: null,
    matchLoad: null,
    matchTime: null,
    matchTiming: null,
    playSound: null,
    realtimeScore: null,
    reload: null,
    scorePosted: null
  };
}

function mergeObjects(previous, incoming) {
  const merged = Object.fromEntries(Object.entries(previous || {}));
  for (const [key, value] of Object.entries(incoming)) {
    const mergedValue = isRecord(value) && isRecord(merged[key])
      ? mergeObjects(merged[key], value)
      : value;
    Object.defineProperty(merged, key, {
      value: mergedValue,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return merged;
}

function applyArenaMessage(state, message) {
  if (!isRecord(state) || !isRecord(message) || !ARENA_EVENT_TYPES.has(message.type)) return null;
  if (STRING_EVENT_TYPES.has(message.type)) {
    if (typeof message.data !== 'string') return null;
  } else if (OPTIONAL_STRING_EVENT_TYPES.has(message.type)) {
    if (message.data !== null && typeof message.data !== 'string' && !isRecord(message.data)) return null;
  } else if (!isRecord(message.data)) {
    return null;
  }
  const data = STRING_EVENT_TYPES.has(message.type) || OPTIONAL_STRING_EVENT_TYPES.has(message.type)
    ? message.data
    : mergeObjects(state[message.type], message.data);
  return { ...state, [message.type]: data };
}

function buildAudienceWebSocketUrl(protocol, host, displayId) {
  const normalizedProtocol = typeof protocol === 'string' && protocol.endsWith(':')
    ? protocol
    : `${protocol}:`;
  if (!['ws:', 'wss:'].includes(normalizedProtocol)) {
    throw new Error('CHEESY_ARENA_PROTOCOL must be ws or wss');
  }
  if (typeof host !== 'string' || !host.trim()) {
    throw new Error('Cheesy Arena host is required');
  }
  if (typeof displayId !== 'string' || !displayId.trim()) {
    throw new Error('CHEESY_ARENA_DISPLAY_ID is required');
  }

  const url = new URL(`${normalizedProtocol}//${host.trim()}:8080`);
  url.pathname = '/displays/audience/websocket';
  url.searchParams.set('displayId', displayId);
  return url.toString();
}

function buildBracketWebSocketUrl(protocol, host) {
  const normalizedProtocol = typeof protocol === 'string' && protocol.endsWith(':')
    ? protocol
    : `${protocol}:`;
  if (!['ws:', 'wss:'].includes(normalizedProtocol)) {
    throw new Error('CHEESY_ARENA_PROTOCOL must be ws or wss');
  }
  if (typeof host !== 'string' || !host.trim()) {
    throw new Error('Cheesy Arena host is required');
  }

  const url = new URL(`${normalizedProtocol}//${host.trim()}:8080`);
  url.pathname = '/displays/bracket/websocket';
  return url.toString();
}

function buildMatchPlayWebSocketUrl(protocol, host) {
  const normalizedProtocol = typeof protocol === 'string' && protocol.endsWith(':')
    ? protocol
    : `${protocol}:`;
  if (!['ws:', 'wss:'].includes(normalizedProtocol)) {
    throw new Error('CHEESY_ARENA_PROTOCOL must be ws or wss');
  }
  if (typeof host !== 'string' || !host.trim()) {
    throw new Error('Cheesy Arena host is required');
  }

  const url = new URL(`${normalizedProtocol}//${host.trim()}:8080`);
  url.pathname = '/match_play/websocket';
  return url.toString();
}

module.exports = {
  applyArenaMessage,
  buildAudienceWebSocketUrl,
  buildBracketWebSocketUrl,
  buildMatchPlayWebSocketUrl,
  createArenaState
};
