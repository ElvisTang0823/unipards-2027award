const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pitDisplayScript = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'pit-display.js'),
  'utf8'
);

function createPitDisplayHarness() {
  const frames = new Map();
  const frameElements = ['practice', 'qualification', 'playoff', 'allianceSelection'].map((display) => {
    const frame = {
      dataset: { display },
      active: display === 'practice',
      attributes: {},
      tabIndex: display === 'practice' ? 0 : -1,
      contentDocument: { readyState: 'complete' },
      contentWindow: {
        messages: [],
        postMessage(message, origin) {
          this.messages.push({ message, origin });
        }
      },
      classList: {
        toggle(name, active) {
          if (name === 'is-active') frame.active = active;
        }
      },
      addEventListener() {},
      setAttribute(name, value) {
        frame.attributes[name] = value;
      }
    };
    frames.set(display, frame);
    return frame;
  });
  class StubWebSocket {
    addEventListener() {}
  }

  const context = {
    document: {
      getElementById() {
        return { textContent: '' };
      },
      querySelectorAll() {
        return frameElements;
      }
    },
    window: {
      location: { protocol: 'http:', host: 'localhost', origin: 'http://localhost' },
      setTimeout() {}
    },
    WebSocket: StubWebSocket,
    console
  };
  vm.runInNewContext(pitDisplayScript, context);
  return { context, frames };
}

test('returns to the loaded playoff bracket when alliance-selection mode ends', () => {
  const { context, frames } = createPitDisplayHarness();

  context.handlePitDisplayMessage({
    e: 'arena-event',
    t: 'matchLoad',
    d: { Match: { Type: 3 } }
  });
  context.handlePitDisplayMessage({
    e: 'arena-event',
    t: 'allianceSelection',
    d: { ShowTimer: true, Alliances: [{ TeamIds: [1, 2, 3] }] }
  });
  assert.equal(frames.get('allianceSelection').active, true);

  context.handlePitDisplayMessage({
    e: 'arena-event',
    t: 'audienceDisplayMode',
    d: 'bracket'
  });
  assert.equal(frames.get('allianceSelection').active, false);
  assert.equal(frames.get('playoff').active, true);

  context.handlePitDisplayMessage({
    e: 'arena-event',
    t: 'allianceSelection',
    d: { ShowTimer: true, Alliances: [{ TeamIds: [1, 2, 3] }] }
  });
  assert.equal(frames.get('playoff').active, true);
  assert.equal(frames.get('playoff').contentWindow.messages.length, 1);
  assert.equal(frames.get('playoff').contentWindow.messages[0].message.type, 'load-alliance-data');
  assert.equal(frames.get('playoff').contentWindow.messages[0].origin, 'http://localhost');
});

test('uses the display mode in the Arena snapshot over stale alliance data', () => {
  const { context, frames } = createPitDisplayHarness();

  context.handlePitDisplayMessage({
    e: 'arena-snapshot',
    d: {
      matchLoad: { Match: { Type: 3 } },
      audienceDisplayMode: 'bracket',
      allianceSelection: { ShowTimer: true, Alliances: [{ TeamIds: [1, 2, 3] }] }
    }
  });

  assert.equal(frames.get('allianceSelection').active, false);
  assert.equal(frames.get('playoff').active, true);
});
