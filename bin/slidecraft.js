#!/usr/bin/env node
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { readDeck, saveDeck, validate } from '../src/deck.js';
import { render } from '../src/render.js';
import { serve } from '../src/server.js';

const [command, name, ...args] = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
async function stdin() { let text = ''; for await (const chunk of process.stdin) text += chunk; return text; }
const help = `Slidecraft — local HTML presentation authoring

  node bin/slidecraft.js init deck.json [--title "My presentation"]
  node bin/slidecraft.js serve deck.json [--port 4310]
  node bin/slidecraft.js inspect deck.json
  node bin/slidecraft.js validate deck.json
  node bin/slidecraft.js patch deck.json --slide ID --stdin
  node bin/slidecraft.js render deck.json [--out dist/presentation.html]

patch reads a JSON object from stdin and merges its top-level fields into one
slide. Arrays are replaced. IDs cannot be changed with patch. All writes are
validated; earlier versions are saved in .slidecraft-history beside the deck.
`;
try {
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); }
  else {
    if (!name) throw new Error('Provide a deck path. Use --help for commands.');
    const file = resolve(name);
    switch (command) {
      case 'init': {
        try { await stat(file); throw new Error(`Refusing to overwrite existing file: ${file}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const deck = JSON.parse(await readFile(new URL('../examples/demo.deck.json', import.meta.url), 'utf8'));
        deck.title = option('--title') || 'My presentation';
        await saveDeck(file, deck, { backup: false });
        console.log(`Created ${file}. Replace the sample story with your own.`);
        break;
      }
      case 'validate': {
        const deck = JSON.parse(await readFile(file, 'utf8'));
        const errors = validate(deck);
        if (errors.length) throw new Error(errors.join('\n'));
        console.log(`Valid deck: ${deck.slides.length} slides`);
        break;
      }
      case 'inspect': {
        const deck = await readDeck(file);
        console.log(JSON.stringify({ title: deck.title, theme: deck.theme, slides: deck.slides.map((s, i) => ({ number: i + 1, ...s })) }, null, 2));
        break;
      }
      case 'patch': {
        if (!args.includes('--stdin') || !option('--slide')) throw new Error('patch requires --slide ID --stdin');
        const changes = JSON.parse(await stdin());
        if (!changes || Array.isArray(changes) || typeof changes !== 'object') throw new Error('Patch must be a JSON object');
        if ('id' in changes) throw new Error('Keep slide IDs stable; patch cannot change id');
        const deck = await readDeck(file);
        const i = deck.slides.findIndex(s => s.id === option('--slide'));
        if (i < 0) throw new Error(`Unknown slide: ${option('--slide')}`);
        deck.slides[i] = { ...deck.slides[i], ...changes };
        await saveDeck(file, deck);
        console.log(`Updated slide ${deck.slides[i].id}`);
        break;
      }
      case 'render': {
        const output = resolve(option('--out') || 'dist/presentation.html');
        if (output === file) throw new Error('Output must differ from the source deck');
        const html = render(await readDeck(file));
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, html);
        console.log(`Exported ${output}`);
        break;
      }
      case 'serve': {
        const port = Number(option('--port') || 4310);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
        const server = await serve(file, port);
        console.log(`Slidecraft studio: http://127.0.0.1:${server.address().port}\nWatching ${file}\nCtrl+C to stop.`);
        break;
      }
      default: throw new Error(`Unknown command: ${command}`);
    }
  }
} catch (e) { console.error(`Slidecraft: ${e.message}`); process.exitCode = 1; }
