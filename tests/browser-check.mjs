import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { serve } from '../src/server.js';
import { saveDeck } from '../src/deck.js';
import { render } from '../src/render.js';

const temp = await mkdtemp(join(tmpdir(), 'slidecraft-browser-'));
const file = join(temp, 'demo.json');
const deck = JSON.parse(await readFile(new URL('../examples/demo.deck.json', import.meta.url), 'utf8'));
await saveDeck(file, deck);
const server = await serve(file, 0);
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${temp}/chrome`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const browserURL = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chromium did not start')), 15000);
    chrome.once('error', e => { clearTimeout(timeout); reject(e); });
    chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  const debugging = new URL(browserURL);
  const targets = await (await fetch(`http://${debugging.host}/json/list`)).json();
  socket = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const job = pending.get(message.id); pending.delete(message.id); if (message.error) job.reject(new Error(message.error.message)); else job.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    return result.result.value;
  };
  const until = async expression => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 80)); }
    throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(await evaluate(`({url: location.href, title: document.title, body: document.body?.innerText.slice(0, 800)})`)) + '\n' + exceptions.join('\n'));
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until(`document.querySelectorAll('.slide-item').length === 7 && document.getElementById('preview').srcdoc.length > 1000`);
  await evaluate(`document.querySelectorAll('.slide-item')[2].click()`);
  await evaluate(`document.getElementById('title').value='A focused edit stays focused.'; document.getElementById('title').dispatchEvent(new Event('input'))`);
  await until(`document.getElementById('preview').srcdoc.includes('A focused edit stays focused.')`);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(await evaluate(`document.querySelector('.slide-item.active strong').textContent`), 'A focused edit stays focused.');
  await evaluate(`document.getElementById('save').click()`);
  await until(`document.getElementById('status').textContent === 'Saved locally'`);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).slides[2].title, 'A focused edit stays focused.');
  const external = JSON.parse(await readFile(file, 'utf8')); external.slides[2].title = 'An agent changed this slide.';
  await saveDeck(file, external);
  await until(`document.getElementById('title').value === 'An agent changed this slide.'`);
  await evaluate(`document.getElementById('body').value='Unsaved browser text'; document.getElementById('body').dispatchEvent(new Event('input'))`);
  external.slides[2].title = 'A second agent edit'; await saveDeck(file, external);
  await until(`document.getElementById('notice').textContent.includes('changed on disk')`);
  assert.equal(await evaluate(`document.getElementById('body').value`), 'Unsaved browser text');
  await evaluate(`document.getElementById('save').click()`);
  await until(`document.getElementById('status').textContent === 'Save failed'`);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).slides[2].title, 'A second agent edit');
  await saveDeck(file, deck);
  await evaluate(`dirty=false; sourceDirty=false; load(true)`);
  await until(`document.getElementById('status').textContent === 'Saved locally'`);
  await new Promise(r => setTimeout(r, 1000));
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('../dist/studio-preview.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  await cdp('Page.navigate', { url: base + '/present#the-workflow' });
  await until(`Boolean(window.slidecraft)`);
  assert.equal(await evaluate(`window.slidecraft.current.id`), 'the-workflow');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate(`window.slidecraft.current.id`), 'principle');
  await evaluate(`document.getElementById('notes-toggle').click()`);
  assert.equal(await evaluate(`document.getElementById('notes').hidden`), false);
  const overflows = await evaluate(`(() => { const errors=[]; for(const slide of document.querySelectorAll('.slide')) { window.slidecraft.go(slide.id); for(const a of slide.getAnimations({subtree:true})) a.finish(); const footer=slide.querySelector('footer').getBoundingClientRect(); for(const el of slide.querySelectorAll('h1,.body,.bullets,.cards,.metrics,.timeline')) {const r=el.getBoundingClientRect(); if(r.bottom>footer.top+1 || r.right>slide.getBoundingClientRect().right+1) errors.push(slide.id+': '+el.className);}} return errors; })()`);
  assert.deepEqual(overflows, [], 'Sample content must fit every slide');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`window.slidecraft.go(0)`);
  assert.equal(await evaluate(`document.getAnimations().length`), 0);
  const pdf = await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  assert.ok(Buffer.from(pdf.data, 'base64').length > 10000);
  await writeFile(new URL('../dist/demo.pdf', import.meta.url), Buffer.from(pdf.data, 'base64'));
  const exported = await (await fetch(base + '/export')).text();
  assert.equal(exported, render(deck));
  await cdp('Page.navigate', { url: base + '/present#iteration-loop' });
  await until(`Boolean(window.slidecraft)`);
  await cdp('Network.enable');
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  assert.equal(await evaluate(`window.slidecraft.current.id`), 'iteration-loop');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate(`window.slidecraft.current.id`), 'next-idea');
  assert.deepEqual(exceptions, [], 'No browser runtime exceptions');
  console.log('Browser checks passed: focused edit, save, live reload, conflict, navigation, notes, layout fit, reduced motion, PDF, HTML playback with networking disabled. Direct file:// opening is excluded because the managed browser blocks it.');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
