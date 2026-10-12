import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const layouts = ['cover', 'split', 'statement', 'cards', 'metrics', 'timeline', 'custom'];
export const motions = ['rise', 'fade', 'zoom', 'slide', 'none'];
export function validate(deck) {
  const errors = [];
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, path, required = false) => {
    if (v === undefined && !required) return;
    if (typeof v !== 'string' || (required && !v.trim())) errors.push(`${path} must be ${required ? 'a non-empty' : 'a'} string`);
  };
  if (!object(deck)) return ['Deck must be an object'];
  if (deck.version !== 1) errors.push('version must be 1');
  str(deck.title, 'title', true);
  for (const key of ['subtitle', 'author', 'css', 'script']) str(deck[key], key);
  if (deck.theme !== undefined) {
    if (!object(deck.theme)) errors.push('theme must be an object');
    else {
      if (deck.theme.mode !== undefined && !['dark', 'light'].includes(deck.theme.mode)) errors.push('theme.mode must be dark or light');
      if (deck.theme.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(deck.theme.accent)) errors.push('theme.accent must be a six-digit hex color');
    }
  }
  if (!Array.isArray(deck.slides) || !deck.slides.length) return [...errors, 'slides must be a non-empty array'];
  const ids = new Set();
  deck.slides.forEach((s, i) => {
    const p = `slides[${i}]`;
    if (!object(s)) { errors.push(`${p} must be an object`); return; }
    if (typeof s.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(s.id)) errors.push(`${p}.id must be a lowercase slug starting with a letter`);
    if (ids.has(s.id)) errors.push(`${p}.id is duplicated: ${s.id}`);
    ids.add(s.id);
    str(s.title, `${p}.title`, true);
    for (const key of ['eyebrow', 'body', 'notes', 'html', 'footer']) str(s[key], `${p}.${key}`);
    if (!layouts.includes(s.layout)) errors.push(`${p}.layout must be one of ${layouts.join(', ')}`);
    if (s.motion !== undefined && !motions.includes(s.motion)) errors.push(`${p}.motion must be one of ${motions.join(', ')}`);
    if (s.layout === 'custom') str(s.html, `${p}.html`, true);
    if (s.bullets !== undefined && (!Array.isArray(s.bullets) || s.bullets.some(x => typeof x !== 'string'))) errors.push(`${p}.bullets must be an array of strings`);
    for (const [key, fields] of Object.entries({ cards: ['title', 'body'], metrics: ['value', 'label'], steps: ['title', 'body'] })) {
      if (s[key] === undefined) continue;
      if (!Array.isArray(s[key]) || s[key].length < 1 || s[key].length > 6) errors.push(`${p}.${key} must contain 1–6 items`);
      else s[key].forEach((item, j) => {
        if (!object(item)) errors.push(`${p}.${key}[${j}] must be an object`);
        else fields.forEach(field => str(item[field], `${p}.${key}[${j}].${field}`, true));
      });
    }
    const required = { cards: 'cards', metrics: 'metrics', timeline: 'steps' }[s.layout];
    if (required && s[required] === undefined) errors.push(`${p}.${required} is required for ${s.layout}`);
  });
  return errors;
}
export function assertDeck(deck) {
  const errors = validate(deck);
  if (errors.length) throw new Error(errors.join('\n'));
  return deck;
}
export async function readDeck(file) { return assertDeck(JSON.parse(await readFile(file, 'utf8'))); }
export function revision(text) { return createHash('sha256').update(text).digest('hex'); }
export async function saveDeck(file, deck, { backup = true } = {}) {
  assertDeck(deck);
  await mkdir(dirname(file), { recursive: true });
  if (backup) {
    let previous;
    try { previous = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (previous !== undefined) {
      const folder = join(dirname(file), '.slidecraft-history', basename(file));
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, `${Date.now()}-${randomUUID()}.json`), previous);
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(deck, null, 2) + '\n');
  await rename(temporary, file);
}
