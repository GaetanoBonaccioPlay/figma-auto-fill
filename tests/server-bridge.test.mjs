import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Bridge } from '../dist/server/bridge.mjs';

async function started(options = {}) {
  const bridge = new Bridge({ port: 0, ...options });
  await bridge.start();
  return bridge;
}
const until = async (condition, ms = 2000) => {
  const end = Date.now() + ms;
  while (!condition()) { if (Date.now() > end) throw new Error('timeout del test'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
async function plugin(bridge, handler, headers) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { headers });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ hello: 'figma-auto-fill-plugin' }));
  ws.on('message', async raw => {
    const request = JSON.parse(String(raw));
    const reply = await handler?.(request);
    if (reply) ws.send(JSON.stringify({ id: request.id, ...reply }));
  });
  await until(() => bridge.connected);
  return ws;
}

test('senza plugin le richieste falliscono con un messaggio che dice di aprirlo', async () => {
  const bridge = await started();
  try {
    assert.equal(bridge.connected, false);
    await assert.rejects(bridge.request('snapshot'), /non è collegato.*aprilo in Figma Desktop/);
  } finally { await bridge.close(); }
});

test('richiesta/risposta con id di correlazione, errori del plugin propagati', async () => {
  const bridge = await started();
  const ws = await plugin(bridge, request => request.command === 'plan'
    ? { ok: false, error: 'La selezione Figma è cambiata' }
    : { ok: true, data: { echo: request.command, payload: request.payload } });
  try {
    assert.deepEqual(await bridge.request('snapshot', { frameIds: ['1:1'] }), { echo: 'snapshot', payload: { frameIds: ['1:1'] } });
    await assert.rejects(bridge.request('plan', {}), /selezione Figma è cambiata/);
    const results = await Promise.all([bridge.request('snapshot', 1), bridge.request('snapshot', 2)]);
    assert.deepEqual(results.map(item => item.payload), [1, 2]);
  } finally { ws.close(); await bridge.close(); }
});

test('timeout se il plugin non risponde', async () => {
  const bridge = await started({ timeoutMs: 80 });
  const ws = await plugin(bridge, () => null);
  try { await assert.rejects(bridge.request('snapshot'), /non ha risposto/); }
  finally { ws.close(); await bridge.close(); }
});

test('se il plugin si scollega a metà, la richiesta fallisce subito e poi si può ricollegare', async () => {
  const bridge = await started();
  let ws = await plugin(bridge, () => null);
  try {
    const pending = bridge.request('generate', {}, 5000);
    await new Promise(resolve => setTimeout(resolve, 30));
    ws.close();
    await assert.rejects(pending, /si è scollegato/);
    await until(() => !bridge.connected);
    ws = await plugin(bridge, () => ({ ok: true, data: 'di nuovo qui' }));
    assert.equal(await bridge.request('snapshot'), 'di nuovo qui');
  } finally { ws.close(); await bridge.close(); }
});

test('rifiuta le pagine web (origine diversa da null) e chi non si presenta', async () => {
  const bridge = await started();
  try {
    const evil = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { headers: { origin: 'https://evil.example' } });
    await new Promise(resolve => { evil.once('error', resolve); evil.once('unexpected-response', resolve); });
    assert.equal(bridge.connected, false);
    const anonymous = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { headers: { origin: 'null' } });
    await new Promise(resolve => anonymous.once('open', resolve));
    anonymous.send(JSON.stringify({ ciao: 1 }));
    await new Promise(resolve => anonymous.once('close', resolve));
    assert.equal(bridge.connected, false);
  } finally { await bridge.close(); }
});

test('una seconda istanza sulla stessa porta resta in attesa senza crashare', async () => {
  const first = await started();
  const second = new Bridge({ port: first.port, retryMs: 50 });
  try {
    await second.start();
    assert.match(second.startError, /già in uso/);
    assert.equal(second.active, false);
    assert.equal(second.connected, false);
  } finally { await first.close(); await second.close(); }
});

test('l\'istanza in attesa si prende la porta da sola quando l\'altra si chiude', async () => {
  const first = await started();
  const port = first.port;
  const second = new Bridge({ port, retryMs: 30 });
  try {
    await second.start();
    assert.equal(second.active, false);
    await first.close();
    await until(() => second.active);
    assert.equal(second.startError, null);
    const ws = await plugin(second, () => ({ ok: true, data: 'ripreso' }));
    assert.equal(await second.request('snapshot'), 'ripreso');
    ws.close();
  } finally { await first.close(); await second.close(); }
});

test('una richiesta all\'istanza in attesa si fa cedere la porta e il plugin passa a lei', async () => {
  const first = await started({ retryMs: 5000 });
  const port = first.port;
  const second = new Bridge({ port, retryMs: 5000, pluginWaitMs: 2000 });
  let ws = await plugin(first, () => ({ ok: true, data: 'dalla prima' }));
  try {
    await second.start();
    assert.equal(await first.request('snapshot'), 'dalla prima');
    // Il plugin vero si ricollega da solo quando la connessione cade: qui lo simuliamo.
    ws.on('close', async () => {
      await until(() => second.active);
      ws = await plugin(second, () => ({ ok: true, data: 'dalla seconda' }));
    });
    assert.equal(await second.request('snapshot'), 'dalla seconda');
    assert.equal(first.active, false);
    assert.equal(first.connected, false);
    assert.match(first.startError, /altra sessione/);
  } finally { ws.close(); await first.close(); await second.close(); }
});

test('chi ha un comando in corso non cede la porta', async () => {
  const first = await started({ retryMs: 5000 });
  const second = new Bridge({ port: first.port, retryMs: 5000 });
  let answer;
  const ws = await plugin(first, request => new Promise(resolve => { answer = () => resolve({ ok: true, data: request.command }); }));
  try {
    await second.start();
    const pending = first.request('generate', {}, 5000);
    await until(() => answer);
    await assert.rejects(second.request('snapshot'), /non è collegato/);
    assert.match(second.startError, /sta usando il plugin/);
    assert.equal(first.active, true);
    answer();
    assert.equal(await pending, 'generate');
  } finally { ws.close(); await first.close(); await second.close(); }
});

test('una porta tenuta da un altro programma dà un errore che dice come controllare', async () => {
  const { createServer } = await import('node:net');
  const foreign = createServer(socket => socket.destroy());
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const bridge = new Bridge({ port: foreign.address().port, retryMs: 5000 });
  try {
    await bridge.start();
    await bridge.claim();
    assert.equal(bridge.active, false);
    assert.match(bridge.startError, /non la cede.*lsof -i/);
  } finally { await bridge.close(); foreign.close(); }
});
