import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readDeck, revision, saveDeck, assertDeck } from './deck.js';
import { render } from './render.js';

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request exceeds 2 MB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function serve(file, port = 4310) {
  await readDeck(file);
  const token = randomBytes(24).toString('hex');
  const editor = (await readFile(new URL('./studio.html', import.meta.url), 'utf8')).replace('__TOKEN__', token);
  let queue = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "frame-ancestors 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    const actualPort = server.address()?.port;
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!hosts.includes(req.headers.host)) return send(403, { error: 'Local access only' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, editor, 'text/html');
      if (req.method === 'GET' && url.pathname === '/api/deck') {
        const text = await readFile(file, 'utf8');
        return send(200, { deck: assertDeck(JSON.parse(text)), revision: revision(text) });
      }
      if (req.method === 'GET' && ['/present', '/export'].includes(url.pathname)) {
        const html = render(await readDeck(file));
        if (url.pathname === '/export') res.setHeader('Content-Disposition', 'attachment; filename="presentation.html"');
        return send(200, html, 'text/html');
      }
      if (['PUT', 'POST'].includes(req.method)) {
        if (req.headers['x-slidecraft-token'] !== token || (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin))) return send(403, { error: 'Invalid local editor token or origin' });
        const payload = await body(req);
        if (req.method === 'POST' && url.pathname === '/api/preview') return send(200, { html: render(payload.deck) });
        if (req.method === 'PUT' && url.pathname === '/api/deck') {
          const operation = queue.then(async () => {
            const current = await readFile(file, 'utf8');
            if (payload.revision !== revision(current)) return send(409, { error: 'The deck changed on disk. Copy your edits, then reload the disk version before saving.' });
            await saveDeck(file, payload.deck);
            return send(200, { revision: revision(await readFile(file, 'utf8')) });
          });
          queue = operation.catch(() => {});
          return await operation;
        }
      }
      send(404, { error: 'Not found' });
    } catch (e) { send(400, { error: e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
