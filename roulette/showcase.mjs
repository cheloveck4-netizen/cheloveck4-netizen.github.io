const media = document.querySelector('.roulette-mini-media');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const photos = media && JSON.parse(media.dataset.photos);

if (photos?.length > 1 && 'IntersectionObserver' in window && 'animate' in Element.prototype) {
  const frames = [...media.querySelectorAll('img')];
  let active = 0;
  let current = 0;
  let visible = false;
  let firstChange = true;
  let timer, animation, controller;

  const allowed = () => visible && !document.hidden && !motion.matches;

  function start() {
    if (!allowed() || controller) return;
    controller = new AbortController();
    cycle(controller.signal, performance.now() + (firstChange ? 1500 : 2500));
  }

  function stop() {
    controller?.abort();
    controller = undefined;
    clearTimeout(timer);
    animation?.cancel();
    animation = undefined;
    frames[1 - active].hidden = true;
  }

  async function cycle(signal, deadline) {
    let next = (current + 1) % photos.length;
    const incoming = frames[1 - active];
    while (next !== current && !signal.aborted) {
      const { src, focus } = photos[next];
      incoming.src = src;
      incoming.style.objectPosition = focus.map(value => value + '%').join(' ');
      try {
        await incoming.decode();
        break;
      } catch {
        next = (next + 1) % photos.length;
      }
    }
    if (signal.aborted || next === current) return;
    timer = setTimeout(() => {
      if (signal.aborted || !allowed()) return;
      const switched = performance.now();
      incoming.hidden = false;
      incoming.style.zIndex = '1';
      const fade = incoming.animate([{ opacity:0 }, { opacity:1 }], {
        duration:400, easing:'ease-in-out', fill:'backwards',
      });
      animation = fade;
      fade.onfinish = () => {
        if (signal.aborted) return;
        frames[active].hidden = true;
        incoming.style.zIndex = '';
        active = 1 - active;
        current = next;
        firstChange = false;
        animation = undefined;
        cycle(signal, switched + 2500);
      };
    }, Math.max(0, deadline - performance.now()));
  }

  function reconcile() {
    if (allowed()) start();
    else stop();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    reconcile();
  });
  observer.observe(media);
  motion.addEventListener('change', reconcile);
  document.addEventListener('visibilitychange', reconcile);
}

// Gloss and photo rotation share the same visibility and reduced-motion policy.
const card = document.querySelector('.roulette-mini');
if (card && 'IntersectionObserver' in window) {
  let cardVisible = false;
  const syncGloss = () => {
    const allowed = cardVisible && !document.hidden && !motion.matches;
    if (allowed) card.dataset.motion = 'on';
    else delete card.dataset.motion;
  };
  new IntersectionObserver(([entry]) => {
    cardVisible = entry.isIntersecting;
    syncGloss();
  }).observe(card);
  motion.addEventListener('change', syncGloss);
  document.addEventListener('visibilitychange', syncGloss);
}
