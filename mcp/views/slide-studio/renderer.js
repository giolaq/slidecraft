import { css, runtime } from './presentation-assets.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function slideHTML(s, index, deck) {
  const e = escapeHTML;
  const colorStyle = [['background','--bg'],['foreground','--fg'],['accent','--accent'],['muted','--muted'],['panel','--panel']].filter(([key]) => /^#[0-9a-f]{6}$/i.test(s.colors?.[key] || '')).map(([key, variable]) => variable + ':' + s.colors[key]).join(';');
  if (s.elements) {
    const content = s.elements.map(el => {
      const style = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;color:${el.color};font-size:${el.fontSize}px;font-weight:${el.bold ? 700 : 400};line-height:1.2;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere`;
      return `<div data-element-id="${e(el.id)}" data-reveal style="${e(style)}">${el.type === 'image' ? `<img src="${e(el.src)}" alt="${e(el.text || '')}" style="width:100%;height:100%;object-fit:${el.fit}" />` : e(el.text || '')}</div>`;
    }).join('');
    return `<section class="slide" id="${e(s.id)}" style="${colorStyle};padding:0;background:var(--bg)" data-motion="${s.motion || 'rise'}" aria-label="Slide ${index + 1}: ${e(s.title)}" ${index ? 'inert aria-hidden="true"' : 'aria-hidden="false"'}>${content}</section>`;
  }
  const bullets = s.bullets?.length ? `<ul class="bullets">${s.bullets.map(x => `<li data-reveal>${e(x)}</li>`).join('')}</ul>` : '';
  const cards = s.cards ? `<div class="cards">${s.cards.map((c, i) => `<article data-reveal><span class="item-number">${String(i + 1).padStart(2, '0')}</span><h3>${e(c.title)}</h3><p>${e(c.body)}</p></article>`).join('')}</div>` : '';
  const metrics = s.metrics ? `<div class="metrics">${s.metrics.map(c => `<article data-reveal><strong>${e(c.value)}</strong><p>${e(c.label)}</p></article>`).join('')}</div>` : '';
  const steps = s.steps ? `<ol class="timeline">${s.steps.map(c => `<li data-reveal><h3>${e(c.title)}</h3><p>${e(c.body)}</p></li>`).join('')}</ol>` : '';
  const photo=s.image ? `<figure class="slide-photo"><img src="${e(s.image.src)}" alt="${e(s.image.alt)}" style="object-fit:${s.image.fit==='cover'?'cover':'contain'}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><p hidden role="alert">Photo unavailable: ${e(s.image.alt)}. Re-import using add-photo.</p>${s.image.caption?`<figcaption>${e(s.image.caption)}</figcaption>`:''}</figure>` : '';
  return `<section class="slide layout-${s.layout}" id="${e(s.id)}" style="${colorStyle}" data-motion="${s.motion || 'rise'}" aria-label="Slide ${index + 1}: ${e(s.title)}" ${index ? 'inert aria-hidden="true"' : 'aria-hidden="false"'}>
    <div class="slide-top"><span>${e(deck.title)}</span><span>${e(s.eyebrow || 'SLIDECRAFT')}</span></div>
    <div class="slide-content"><div class="intro"><div class="eyebrow" data-reveal>${e(s.eyebrow || '')}</div><h1 data-reveal>${e(s.title)}</h1>${s.body ? `<p class="body" data-reveal>${e(s.body)}</p>` : ''}</div><div class="details">${photo}${bullets}${cards}${metrics}${steps}${s.html ? `<div class="custom-content" data-reveal>${s.html}</div>` : ''}</div></div>
    <footer><span>${e(s.footer || deck.author || 'Made with Slidecraft')}</span><span>${String(index + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}</span></footer>
  </section>`;
}

export function render(deck) {

  return `<!doctype html>
<html lang="en" data-theme="${deck.theme?.mode || 'dark'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(deck.title)}</title><style>${css} .slide-photo{margin:0;max-height:450px;display:flex;flex-direction:column;gap:10px}.slide-photo img{width:100%;height:360px;min-height:0}.slide-photo figcaption{font-size:18px;color:var(--muted)}</style><style>html:root{--accent:${deck.theme?.accent || '#cbff73'};${[['background','--bg'],['foreground','--fg'],['muted','--muted'],['panel','--panel']].filter(([key]) => /^#[0-9a-f]{6}$/i.test(deck.theme?.[key] || '')).map(([key, variable]) => variable + ':' + deck.theme[key]).join(';')}}</style></head>
<body><main id="stage">${deck.slides.map((s, i) => slideHTML(s, i, deck)).join('')}</main>
<nav class="controls" aria-label="Presentation controls"><button id="previous" aria-label="Previous slide">←</button><span id="position" aria-live="polite"></span><button id="next" aria-label="Next slide">→</button><button id="notes-toggle" aria-label="Toggle speaker notes">Notes</button><button id="fullscreen" aria-label="Enter fullscreen">⛶</button></nav>
<aside id="notes" hidden><strong>Speaker notes</strong><p id="notes-text"></p></aside><div id="progress"></div>
<script id="deck-data" type="application/json">${safeJSON(deck)}</script><script>${runtime}</script></body></html>`;
}
