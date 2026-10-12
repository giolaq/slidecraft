(() => {
  const deck = JSON.parse(document.getElementById('deck-data').textContent);
  const slides = [...document.querySelectorAll('.slide')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = -1, initialized = false;
  function resize() {
    document.documentElement.style.setProperty('--scale', Math.min(innerWidth / 1600, innerHeight / 900));
  }
  function go(target, updateHash = true, announce = true) {
    const next = typeof target === 'string' ? slides.findIndex(s => s.id === target) : target;
    if (next < 0 || next >= slides.length) return;
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === next);
      slide.inert = i !== next;
      slide.setAttribute('aria-hidden', String(i !== next));
      slide.getAnimations({ subtree: true }).forEach(a => a.cancel());
    });
    current = next;
    const slide = slides[current];
    if (!reduced.matches && slide.dataset.motion !== 'none') {
      const from = { rise: 'translateY(32px)', fade: 'none', zoom: 'scale(.94)', slide: 'translateX(45px)' }[slide.dataset.motion];
      slide.querySelectorAll('[data-reveal]').forEach((el, i) => el.animate([
        { opacity: 0, transform: from }, { opacity: 1, transform: 'none' }
      ], { duration: 650, delay: Math.min(i * 85, 680), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
    }
    document.getElementById('position').textContent = `${current + 1} / ${slides.length}`;
    document.getElementById('previous').disabled = current === 0;
    document.getElementById('next').disabled = current === slides.length - 1;
    document.getElementById('progress').style.width = `${(current + 1) / slides.length * 100}%`;
    document.getElementById('notes-text').textContent = deck.slides[current].notes || 'No speaker notes for this slide.';
    if (updateHash) { try { history.replaceState(null, '', `#${slide.id}`); } catch { /* opaque sandbox */ } }
    window.dispatchEvent(new CustomEvent('slidechange', { detail: { index: current, id: slide.id } }));
    if (announce && initialized && parent !== window) parent.postMessage({ type: 'slidecraft:slide', id: slide.id }, '*');
  }
  window.slidecraft = { go, next: () => go(current + 1), previous: () => go(current - 1), get current() { return deck.slides[current]; } };
  document.getElementById('previous').onclick = window.slidecraft.previous;
  document.getElementById('next').onclick = window.slidecraft.next;
  document.getElementById('notes-toggle').onclick = () => { document.getElementById('notes').hidden = !document.getElementById('notes').hidden; };
  document.getElementById('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* browser may disallow fullscreen */ }
  };
  document.addEventListener('keydown', event => {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) { event.preventDefault(); go(current + 1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); go(current - 1); }
    if (event.key === 'Home') go(0);
    if (event.key === 'End') go(slides.length - 1);
    if (event.key.toLowerCase() === 'n') document.getElementById('notes-toggle').click();
    if (event.key.toLowerCase() === 'f') document.getElementById('fullscreen').click();
  });
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'slidecraft:go') go(event.data.id, true, false);
  });
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));
  window.addEventListener('resize', resize);
  window.addEventListener('beforeprint', () => document.getAnimations().forEach(a => a.finish()));
  if (deck.css) { const style = document.createElement('style'); style.textContent = deck.css; document.head.append(style); }
  resize();
  go(slides.some(s => s.id === location.hash.slice(1)) ? location.hash.slice(1) : 0);
  initialized = true;
  if (deck.script) { const script = document.createElement('script'); script.textContent = deck.script; document.body.append(script); }
})();
