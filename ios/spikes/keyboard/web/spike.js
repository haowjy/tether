// Spike 1 page: three xterm.js terminals, a tab bar, a web sheet, an editor
// stand-in, selectable text, an output flood, and the bench responder.
// Native talks to it through window.__tether.receive(messages); it talks to
// native through the `tether` message handler (postMessage returns a promise).
import { Terminal } from './xterm.mjs';
import { FitAddon } from './addon-fit.mjs';
import { WebglAddon } from './addon-webgl.mjs';

const handler = window.webkit?.messageHandlers?.tether;
const post = (message) => (handler ? handler.postMessage(message) : Promise.resolve(null));
const log = (kind, detail = {}) => { post({ type: 'log', kind, detail }); };

const $ = (id) => document.getElementById(id);
const termwrap = $('termwrap');
const echoEl = $('echo');
const banner = $('banner');

function showError(text) {
  banner.textContent = text;
  banner.hidden = false;
  log('error', { text });
}
window.addEventListener('error', (e) => showError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`unhandled rejection: ${e.reason}`));
document.addEventListener('securitypolicyviolation', (e) =>
  showError(`CSP ${e.violatedDirective} blocked ${e.blockedURI}`));

// ---- Terminals ------------------------------------------------------------

const BAR_HEIGHT = 44;
const THEME = { background: '#101012', foreground: '#d8d8d8', cursor: '#7ee787' };
let renderer = 'webgl';

function makeTab(index) {
  const host = document.createElement('div');
  host.className = 'termhost';
  termwrap.appendChild(host);
  const term = new Terminal({
    disableStdin: true,
    cursorBlink: false,
    fontSize: 13,
    fontFamily: 'Menlo, ui-monospace, monospace',
    scrollback: 5000,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => { webgl.dispose(); log('webglContextLost', { tab: index }); });
    term.loadAddon(webgl);
  } catch (err) {
    renderer = 'dom';
    log('webglFailed', { tab: index, error: String(err) });
  }
  // ios-shell.md: xterm.js's helper textarea must never take focus.
  const textarea = term.textarea;
  if (textarea) {
    textarea.setAttribute('tabindex', '-1');
    textarea.inert = true;
    textarea.readOnly = true;
  }
  term.onCursorMove(() => { if (index === active) pan(); });
  term.write(`\x1b[1mtab${index + 1}\x1b[0m · input from the native keyboard echoes here\r\n`);
  return { term, fit, host, echo: '', height: 0, top: 0 };
}

let active = 0;
const tabs = [0, 1, 2].map(makeTab);

function showTab(index) {
  active = index;
  tabs.forEach((t, i) => t.host.classList.toggle('hidden', i !== index));
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', Number(b.dataset.tab) === index));
  renderEcho();
  pan();
}

// The terminal keeps its rows when the keyboard opens; it slides so the
// cursor row stays visible above the tab bar (plan.md "Layout"). Heights are
// cached: pan runs on every cursor move, so it must not force a layout.
let visibleHeight = 0;
function measure() { visibleHeight = termwrap.clientHeight; }
window.addEventListener('resize', () => { measure(); pan(); });

function pan() {
  const t = tabs[active];
  let top = 0;
  if (t.height > visibleHeight) {
    const cursorBottom = (t.term.buffer.active.cursorY + 1) * (t.height / t.term.rows);
    top = Math.max(visibleHeight - t.height, Math.min(0, visibleHeight - cursorBottom));
  }
  if (top !== t.top) {
    t.top = top;
    t.host.style.top = `${top}px`;
  }
}

// ---- Input echo -------------------------------------------------------------

const KEY = '\x1b[36m';
const PASTE = '\x1b[35m';
const RESET = '\x1b[0m';

function hex(base64) {
  return [...atob(base64)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
}

function echo(event) {
  const t = tabs[active];
  let shown;
  if ('text' in event) {
    shown = event.text;
    t.term.write(event.text);
  } else if ('key' in event) {
    shown = `⟨${event.key}⟩`;
    t.term.write(KEY + shown + RESET + (event.key === 'Enter' ? '\r\n' : ''));
  } else if ('paste' in event) {
    shown = `⟨paste ${event.paste.length}⟩${event.paste}`;
    t.term.write(`${PASTE}⟨paste ${event.paste.length}⟩${RESET}${event.paste.replace(/\r?\n/g, '\r\n')}`);
  } else if ('bytes' in event) {
    shown = `⟨bytes ${hex(event.bytes)}⟩`;
    t.term.write(KEY + shown + RESET);
  } else {
    shown = `⟨? ${JSON.stringify(event)}⟩`;
  }
  t.echo = (t.echo + shown.replace(/\r?\n/g, '⏎')).slice(-200);
  renderEcho();
}

function renderEcho() {
  echoEl.textContent = `tab${active + 1} ▸ ${tabs[active].echo}`;
}

// ---- Viewport from native -----------------------------------------------------

function applyViewport(v) {
  document.documentElement.style.setProperty('--kb', `${v.mode === 'B' ? v.keyboardHeight : 0}px`);
  // Only the collapsed layout sizes the terminal; keyboard moves never do.
  if (v.reason === 'initial' || v.reason === 'rotation') sizeTerminals(v);
  requestAnimationFrame(() => { measure(); pan(); });
  reportLayout(v);
}

function sizeTerminals(v) {
  const chrome = $('static').offsetHeight + echoEl.offsetHeight + BAR_HEIGHT;
  const height = Math.max(60, Math.floor(v.collapsedHeight - chrome - v.safeBottom));
  const width = Math.floor(v.width);
  for (const t of tabs) {
    t.host.style.width = `${width}px`;
    t.host.style.height = `${height}px`;
    t.height = height;
    t.fit.fit();
  }
  const { cols, rows } = tabs[0].term;
  post({ type: 'term', cols, rows, reason: v.reason, width, height, renderer });
}

// M4: report once the page has the new size (geometry A) and a frame has passed.
function reportLayout(v) {
  const start = performance.now();
  const settled = () => v.mode !== 'A' || Math.abs(window.innerHeight - v.height) < 2;
  const check = () => {
    if (settled() || performance.now() - start > 1000) {
      requestAnimationFrame(() => post({
        type: 'layout', seq: v.seq, reason: v.reason, settled: settled(),
        innerHeight: window.innerHeight, waitedMs: Math.round(performance.now() - start),
        cols: tabs[active].term.cols, rows: tabs[active].term.rows,
      }));
    } else {
      requestAnimationFrame(check);
    }
  };
  check();
}

// WebKit adjusting for a keyboard it doesn't own shows up here. Logged once
// the viewport has been still for 200 ms, not on every animation frame.
let viewportLogTimer = 0;
window.visualViewport?.addEventListener('resize', () => {
  clearTimeout(viewportLogTimer);
  viewportLogTimer = setTimeout(() => {
    const vv = window.visualViewport;
    log('visualViewport', { height: vv.height, offsetTop: vv.offsetTop, innerHeight: window.innerHeight, scrollY: window.scrollY });
  }, 200);
});

// ---- Flood ---------------------------------------------------------------------

const FLOOD_LABELS = new Map([[0, '0'], [100_000, '100K'], [1_000_000, '1M']]);
const FLOOD_BLOCK = (() => {
  let s = '';
  for (let n = 0; s.length < 256 * 1024; n++) {
    s += `\x1b[${31 + (n % 7)}m${String(n).padStart(6, '0')} the quick brown fox jumps over the lazy dog 0123456789\x1b[0m\r\n`;
  }
  return s;
})();
const flood = { rate: 0, timer: 0, last: 0, since: 0, offset: 0, pending: 0, written: 0 };

function setFlood(rate, source) {
  if (flood.rate > 0) {
    const seconds = (performance.now() - flood.since) / 1000;
    log('floodStats', { target: flood.rate, bytesPerSecond: Math.round(flood.written / seconds), seconds: seconds.toFixed(1) });
  }
  clearInterval(flood.timer);
  Object.assign(flood, { rate, timer: 0, last: performance.now(), since: performance.now(), written: 0 });
  if (rate > 0) flood.timer = setInterval(floodTick, 16);
  const label = FLOOD_LABELS.get(rate) ?? String(rate);
  $('flood').textContent = `flood ${label}`;
  $('flood').classList.toggle('on', rate > 0);
  post({ type: 'flood', rate, label, source });
}

function floodTick() {
  const now = performance.now();
  const bytes = Math.min(128 * 1024, Math.round((flood.rate * (now - flood.last)) / 1000));
  flood.last = now;
  // xterm.js is behind: skip this tick so its write queue stays bounded.
  if (flood.pending > 512 * 1024 || bytes <= 0) return;
  const chunk = FLOOD_BLOCK.slice(flood.offset, flood.offset + bytes);
  flood.offset = (flood.offset + bytes) % FLOOD_BLOCK.length;
  flood.pending += chunk.length;
  tabs[active].term.write(chunk, () => {
    flood.pending -= chunk.length;
    flood.written += chunk.length;
  });
}

// ---- Bench ---------------------------------------------------------------------

async function benchWebToNative(count) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await post({ type: 'haptic', kind: 'selection', bench: true });
    samples.push(performance.now() - start);
  }
  post({ type: 'benchResult', name: 'M3', samples });
}

// ---- Messages from native -------------------------------------------------------

function receive(messages) {
  for (const m of messages) {
    switch (m.type) {
      case 'input': for (const e of m.events) echo(e); break;
      case 'viewport': applyViewport(m); break;
      case 'bench':
        if ('id' in m) post({ type: 'ack', id: m.id });
        else if (m.m3) benchWebToNative(m.m3);
        break;
      case 'flood': setFlood(m.rate, 'native'); break;
      default: log('unknownNativeMessage', { type: String(m.type) });
    }
  }
}

window.__tether = {
  receive,
  activeTab: () => ({ host: 'spike', tab: active }),
};

// ---- Controls --------------------------------------------------------------------

// Taps on the terminal ask for the keyboard. xterm.js cancels touch defaults on
// its own elements, so watch pointer events and ignore drags (scrolling).
let down = null;
termwrap.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
termwrap.addEventListener('pointerup', (e) => {
  if (!down || e.target.closest('.overlay')) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 10 && performance.now() - down.t < 500) post({ type: 'focus', mode: 'terminal' });
  down = null;
}, true);

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  showTab(Number(b.dataset.tab));
  post({ type: 'haptic', kind: 'selection' });
}));

$('flood').addEventListener('click', () => {
  const rates = [...FLOOD_LABELS.keys()];
  setFlood(rates[(rates.indexOf(flood.rate) + 1) % rates.length], 'page');
});

let sheetTaps = 0;
$('sheetbtn').addEventListener('click', () => $('sheet').classList.toggle('open'));
$('sheetclose').addEventListener('click', () => $('sheet').classList.remove('open'));
document.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
  sheetTaps += 1;
  $('sheetcount').textContent = `taps: ${sheetTaps}`;
}));

// ios-shell.md: the editor asks for `webText` when it opens, before the tap,
// and gives the keyboard back with `focus terminal` when it closes.
$('editbtn').addEventListener('click', () => {
  $('editor').classList.add('open');
  post({ type: 'focus', mode: 'webText' });
});
$('editclose').addEventListener('click', () => {
  $('editor').classList.remove('open');
  post({ type: 'focus', mode: 'terminal' });
});

$('kbbtn').addEventListener('click', () => post({ type: 'focus', mode: 'terminal' }));

// ---- Boot ------------------------------------------------------------------------

showTab(0);
post({ type: 'ready', renderer, userAgent: navigator.userAgent, location: location.href }).then((boot) => {
  if (!boot) return;
  if (boot.bridgeVersion !== 1) showError(`bridge version ${boot.bridgeVersion}, page expects 1`);
  applyViewport(boot.viewport);
});
