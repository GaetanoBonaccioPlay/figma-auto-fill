import test from 'node:test';
import assert from 'node:assert/strict';

// Il relay della UI gira nel browser: qui WebSocket, window e parent sono finti.
class FakeSocket {
  static instances = [];
  static OPEN = 1;
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; FakeSocket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.onopen(); }
  receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose({ code }); }
}
const listeners = [];
const toFigma = [];
globalThis.WebSocket = FakeSocket;
globalThis.window = { addEventListener: (type, fn) => listeners.push([type, fn]) };
globalThis.parent = { postMessage: (message, origin) => toFigma.push({ message, origin }) };
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };

const { startAgentBridge } = await import('../dist/agent-bridge.mjs');
const fromFigma = pluginMessage => listeners.filter(([type]) => type === 'message').forEach(([, fn]) => fn({ data: { pluginMessage } }));

test('si collega a localhost, si presenta, inoltra i comandi a Figma e rimanda le risposte', () => {
  const statuses = [];
  startAgentBridge(connected => statuses.push(connected));
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, 'ws://localhost:3055');
  assert.deepEqual(statuses, [false]);

  socket.open();
  assert.deepEqual(statuses, [false], 'aperto non basta: serve il benvenuto del server');
  socket.receive({ welcome: 'figma-auto-fill-server' });
  assert.deepEqual(statuses, [false, true]);
  assert.deepEqual(socket.sent[0], { hello: 'figma-auto-fill-plugin' });

  socket.receive({ id: 'r1', command: 'snapshot', payload: { frameIds: ['1:1'] } });
  assert.deepEqual(toFigma[0], { message: { pluginMessage: { kind: 'agent-command', id: 'r1', command: 'snapshot', payload: { frameIds: ['1:1'] } } }, origin: '*' });

  fromFigma({ kind: 'agent-result', id: 'r1', ok: true, data: { frames: [] } });
  fromFigma({ kind: 'agent-result', id: 'r2', ok: false, error: 'La selezione Figma è cambiata' });
  assert.deepEqual(socket.sent.slice(1), [
    { id: 'r1', ok: true, data: { frames: [] } },
    { id: 'r2', ok: false, error: 'La selezione Figma è cambiata' }
  ]);
});

test('ignora messaggi non validi e messaggi di Figma che non sono risultati', () => {
  const socket = FakeSocket.instances[0];
  const before = [toFigma.length, socket.sent.length];
  socket.onmessage({ data: 'non json' });
  socket.receive({ command: 'snapshot' });
  fromFigma({ kind: 'selection', frames: [] });
  fromFigma(undefined);
  assert.deepEqual([toFigma.length, socket.sent.length], before);
});

test('se il server cade segnala lo stato e si ricollega da solo', () => {
  const statuses = [];
  FakeSocket.instances.length = 0;
  timers.length = 0;
  startAgentBridge(connected => statuses.push(connected));
  const first = FakeSocket.instances[0];
  first.open();
  first.receive({ welcome: 'figma-auto-fill-server' });
  first.drop();
  assert.deepEqual(statuses, [false, true, false]);
  assert.equal(timers.at(-1).ms, 2000);
  timers.at(-1).fn();
  assert.equal(FakeSocket.instances.length, 2, 'nuovo tentativo di connessione');
  // una risposta di Figma mentre non c'è un socket aperto non deve esplodere
  fromFigma({ kind: 'agent-result', id: 'x', ok: true, data: null });
});

test('lo stato della UI (modello del nome, nomi base) è servito dalla UI senza passare da Figma', () => {
  FakeSocket.instances.length = 0;
  const state = { naming: { template: '{Data}_{Nome}-{Lingua}-{Paese}', start: 1, date: '261109' }, baseNames: { '1:1': 'Hero' }, sectionMode: 'none', targets: ['EN'], primary: 'EN' };
  startAgentBridge(() => {}, () => state);
  const socket = FakeSocket.instances[0];
  socket.open();
  const before = toFigma.length;
  socket.receive({ id: 'u1', command: 'ui-state' });
  assert.deepEqual(socket.sent.at(-1), { id: 'u1', ok: true, data: state });
  assert.equal(toFigma.length, before, 'nessun messaggio al codice Figma');

  FakeSocket.instances.length = 0;
  startAgentBridge(() => {});
  const old = FakeSocket.instances[0];
  old.open();
  old.receive({ id: 'u2', command: 'ui-state' });
  assert.equal(old.sent.at(-1).ok, false);
});

test('rifiutato perché il server ha già un altro plugin: lo dice, senza mai dirsi collegato', () => {
  const statuses = [];
  FakeSocket.instances.length = 0;
  timers.length = 0;
  startAgentBridge((connected, status) => statuses.push(status));
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].drop(4001);
  assert.deepEqual(statuses, [{ connected: false, busy: false }, { connected: false, busy: true }], 'nessun «collegato» prima del rifiuto');
  timers.find(timer => timer.ms === 1500).fn();
  assert.equal(statuses.length, 2, 'il timer di un socket chiuso non fa nulla');
  timers.at(-1).fn();
  const retry = FakeSocket.instances[1];
  retry.open();
  retry.receive({ welcome: 'figma-auto-fill-server' });
  assert.deepEqual(statuses.at(-1), { connected: true, busy: false });
  assert.equal(toFigma.filter(item => item.message.pluginMessage?.command === undefined).length, 0, 'il benvenuto non va a Figma');
});

test('un server di una versione precedente non manda il benvenuto: collegato dopo una breve attesa', () => {
  const statuses = [];
  FakeSocket.instances.length = 0;
  timers.length = 0;
  startAgentBridge(connected => statuses.push(connected));
  FakeSocket.instances[0].open();
  assert.deepEqual(statuses, [false]);
  timers.find(timer => timer.ms === 1500).fn();
  assert.deepEqual(statuses, [false, true]);
});
