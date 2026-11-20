const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bracketScript = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'bracket.js'),
  'utf8'
);

function createElement() {
  const classes = new Set();
  return {
    children: [],
    attributes: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      }
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children.flatMap((child) => child.children || [child]);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

function createBracketHarness() {
  const elements = new Map([
    ['bracketImage', createElement()],
    ['bracketStatus', createElement()],
    ['bracketSlide', createElement()],
    ['alliancesSlide', createElement()],
    ['allianceList', createElement()]
  ]);
  elements.get('bracketSlide').classList.add('is-active');
  const intervals = [];
  const timeouts = [];
  const windowListeners = {};
  const fetchCalls = [];
  let socket;

  class StubWebSocket {
    constructor() {
      this.listeners = {};
      socket = this;
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
  }

  const context = {
    document: {
      getElementById(id) {
        return elements.get(id);
      },
      createElement,
      createDocumentFragment: createElement
    },
    window: {
      location: { protocol: 'http:', host: 'localhost', origin: 'http://localhost' },
      addEventListener(name, callback) {
        windowListeners[name] = callback;
      },
      setInterval(callback, delay) {
        intervals.push({ callback, delay });
      },
      setTimeout(callback, delay) {
        timeouts.push({ callback, delay });
      }
    },
    fetch(url, options) {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ Id: 1, TeamIds: [4400, 8044, 9405] }])
      });
    },
    WebSocket: StubWebSocket,
    console
  };
  vm.runInNewContext(bracketScript, context);
  return { elements, intervals, timeouts, socket, windowListeners, fetchCalls };
}

test('shows bracket for 15 seconds and alliances for 10 seconds', async () => {
  const { elements, intervals, timeouts, fetchCalls } = createBracketHarness();
  const bracketSlide = elements.get('bracketSlide');
  const alliancesSlide = elements.get('alliancesSlide');

  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 10000);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 15000);
  assert.equal(bracketSlide.classList.contains('is-active'), true);
  assert.equal(alliancesSlide.classList.contains('is-active'), false);
  assert.equal(fetchCalls.length, 1);
  timeouts[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bracketSlide.classList.contains('is-active'), false);
  assert.equal(alliancesSlide.classList.contains('is-active'), true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(elements.get('allianceList').children.length, 1);
  assert.equal(timeouts[1].delay, 10000);
  timeouts[1].callback();
  assert.equal(bracketSlide.classList.contains('is-active'), true);
  assert.equal(alliancesSlide.classList.contains('is-active'), false);
  assert.equal(timeouts[2].delay, 15000);
});

test('fetches alliances once when activated and renders the API data', async () => {
  const { elements, windowListeners, fetchCalls } = createBracketHarness();
  const activate = {
    origin: 'http://localhost',
    data: { type: 'load-alliance-data' }
  };
  assert.equal(fetchCalls.length, 1);

  windowListeners.message(activate);
  windowListeners.message(activate);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/api/alliances');
  const [row] = elements.get('allianceList').children;
  assert.equal(row.children[0].textContent, 'Alliance 1');
  assert.equal(row.children[1].children.length, 3);
  assert.equal(row.children[1].children[0].children[0].src, '/api/teams/4400/avatar');
  assert.equal(row.children[1].children[0].children[1].textContent, '4400');
});

test('ignores alliance load requests from another origin', () => {
  const { windowListeners, fetchCalls } = createBracketHarness();
  assert.equal(fetchCalls.length, 1);
  windowListeners.message({
    origin: 'https://other.example',
    data: { type: 'load-alliance-data' }
  });

  assert.equal(fetchCalls.length, 1);
});
