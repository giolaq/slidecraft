# Motion authoring

Built-in motion uses the browser Web Animations API. Elements with `data-reveal`
animate automatically on slide entry over 650 ms, staggered by 85 ms (maximum
delay 680 ms). Motion is canceled and replayed on navigation. The renderer
respects `prefers-reduced-motion`; custom code must do the same.

| Preset | Behavior |
| --- | --- |
| rise | Opacity + 32 px upward entrance |
| fade | Opacity only |
| zoom | Opacity + 0.94 → 1 scale |
| slide | Opacity + 45 px horizontal entrance |
| none | Immediate appearance |

Do not animate the `.slide` transform: it scales the stage to the viewport.
Animate a child element. Native printing finishes animations and exposes all
slides; do not rely on perpetual movement to communicate critical information.

For a custom diagram, add an ID to a child in `html`, choose `motion: "none"`
for full timing control, and put JavaScript like this in the deck `script`:

```js
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function animate() {
    if (window.slidecraft.current.id !== 'feedback-loop') return;
    const diagram = document.querySelector('#feedback-loop svg');
    if (!diagram || reduced.matches) return;
    diagram.animate(
      [{ opacity: 0, transform: 'translateY(16px)' },
       { opacity: 1, transform: 'translateY(0)' }],
      { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
    );
  }
  window.addEventListener('slidechange', animate);
  animate();
})();
```

Keep animations finite so print can finish them. Avoid global keyboard handlers
that steal the presentation's arrow keys. For custom interactive controls use
real buttons, visible focus, accessible labels, and static final states.
