const hostname = 'xn--c1ajamhiblrj0b.online';
const counter = 106963668;
const events = new Set([
  'roulette_open', 'roulette_spin', 'roulette_recipe_open', 'roulette_favorite',
  'roulette_share', 'roulette_filter', 'roulette_services', 'roulette_from_home',
]);
const sources = new Set(['max','telegram','vk','ok','dzen','pinterest','youtube']);

export function analyticsPage(url) {
  const page = new URL('/roulette/', 'https://' + hostname);
  const source = url.searchParams.get('utm_source');
  if (sources.has(source) && url.searchParams.get('utm_medium') === 'social' &&
      ['editorial','roulette'].includes(url.searchParams.get('utm_campaign'))) {
    page.search = new URLSearchParams({
      utm_source: source, utm_medium:'social', utm_campaign:url.searchParams.get('utm_campaign'),
    });
  }
  return page.href;
}

export function startMetrics() {
  if (location.protocol !== 'https:' || location.hostname !== hostname ||
      document.body.dataset.rouletteMetrics !== '1') return;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  window.ym ??= function () { (window.ym.a ??= []).push(arguments); };
  window.ym.l ??= Date.now();
  document.head.append(script);
  window.ym(counter, 'init', {
    defer:true, clickmap:false, trackLinks:false, accurateTrackBounce:false, webvisor:false,
  });
  window.ym(counter, 'hit', analyticsPage(new URL(location.href)), { referer:'' });
  goal('roulette_open');
  if (['home', 'home-menu'].includes(new URLSearchParams(location.search).get('from'))) goal('roulette_from_home');
}

export function goal(event) {
  if (location.protocol === 'https:' && location.hostname === hostname &&
      document.body.dataset.rouletteMetrics === '1' &&
      events.has(event) && typeof window.ym === 'function') window.ym(counter, 'reachGoal', event);
}
