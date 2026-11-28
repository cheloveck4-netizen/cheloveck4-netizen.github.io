import { goal, startMetrics } from './metrics.mjs?v=12.3';
import { recipes } from './data.mjs?v=15';
import { displayNutritionValue, formatNutritionValue, filterRecipes, ingredientLine, portions } from './catalog.mjs?v=13.2';
import {
  wrap, spinEase, dragTarget, settleEase, clamp, SPIN_MS,
  ringCount, ringOffset, ringStyle, nativeTracks, prepareReel, drawUnseen, spinTo,
} from './core.mjs?v=12.3';

const $ = id => document.getElementById(id);
const stage = $('stage'), cards = $('cards'), spin = $('spin'), open = $('open'), dialog = $('recipe');
const tabs = [...document.querySelectorAll('[data-cat]')];
document.querySelector('.benefit-filter').onclick = () => {
  $('filters').open = true;
  $('products-filter').focus();
};
const filters = Object.fromEntries(
  ['time', 'family', 'meatless', 'favorites', 'products', 'kcal', 'protein']
    .map(key => [key, $(key + '-filter')])
);
const remembered = new Map(), drawHistory = new Map();
let drawKey = '', pendingDraw = null;
const storageKey = 'natalya-roulette-favorites-v1';
const params = new URLSearchParams(location.search);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const diagnostic = params.get('perf') === '1';
const nodes = new Map();
let category = 'lunch', pool = [], list = [], position = 0, stepPx = 160, busy = false;
let ring = [], gesture = null, frame = 0, dragFrame = 0, nativeRun = null, perfFrame = 0;
let perf = null, generation = 0, filterTimer;
let opened = null, servings = 0;
let favorites = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (Array.isArray(saved)) favorites = new Set(saved.filter(id => typeof id === 'string'));
} catch { /* The wheel also works with storage disabled. */ }

const current = () => list[wrap(Math.round(position), list.length)];
function el(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
}

function picture(row, decorative = false, priority = 'auto') {
  const image = el('img');
  image.alt = decorative ? '' : row.image.alt;
  image.draggable = false;
  image.decoding = 'async';
  image.width = row.image.width || 480;
  image.height = row.image.height || 320;
  image.fetchPriority = priority;
  image.src = row.image.src;
  return image;
}

function reveal(node, priority) {
  const food = node.querySelector('.food');
  if (food.querySelector('img') || food.dataset.failed) return;
  const photo = node.recipe.image;
  const image = picture(node.recipe, true, priority);
  if (photo.frame) food.dataset.frame = photo.frame;
  if (photo.focus) image.style.objectPosition = photo.focus.map(value => value + '%').join(' ');
  image.addEventListener('error', () => {
    image.remove();
    food.dataset.failed = 'true';
  }, { once: true });
  food.prepend(image);
}

function makeCard(row, withPhoto) {
  const card = el('article', 'card');
  card.setAttribute('aria-hidden', 'true');
  updateCard(card, row, withPhoto);
  return card;
}

function updateCard(card, row, withPhoto) {
  card.recipe = row;
  card.dataset.dish = row.id;
  const food = el('div', 'food');
  const label = row.image.placeholder ? 'Фото готовится' : row.image.origin === 'synthetic' ? 'Иллюстрация' : row.status === 'demo' ? 'Пример блюда' : 'Ваш рецепт';
  food.append(el('span', 'tag', label));
  const body = el('div', 'card-body');
  const meta = el('div', 'meta');
  const time = row.timing ? row.timing.total + ' мин' : (row.prep + row.cook) + ' мин · оценка';
  meta.append(el('span', '', time), el('span', '', portions(row.servings)));
  body.append(el('h2', '', row.title), meta);
  card.replaceChildren(food, body);
  if (withPhoto) reveal(card);
}

function measure() {
  stepPx = $('step-size').getBoundingClientRect().width || 160;
}

function poseCard(node, offset, selected) {
  const style = ringStyle(offset, stepPx);
  node.style.transform = style.transform;
  node.style.opacity = style.opacity;
  if (node.dataset.center !== String(selected)) {
    node.dataset.center = String(selected);
    node.setAttribute('aria-hidden', String(!selected));
  }
}

function paint({ photos = false, photoIds, photoRadius = 2.6 } = {}) {
  if (!list.length) return;
  const center = Math.round(position);
  if (ring.length) {
    for (let i = 0; i < ring.length; i++) {
      const offset = ringOffset(i, position, ring.length);
      poseCard(ring[i], offset, i === wrap(center, ring.length));
    }
    return;
  }
  const radius = list.length === 1 ? 0 : 4;
  const low = center - radius, high = center + radius;
  const recycled = [];
  for (const [slot, node] of nodes) {
    if (slot < low || slot > high) {
      nodes.delete(slot);
      recycled.push(node);
    }
  }
  for (let slot = low; slot <= high; slot++) {
    const offset = slot - position;
    let node = nodes.get(slot);
    if (!node) {
      const row = list[wrap(slot,list.length)];
      node = recycled.pop();
      if (node) updateCard(node,row,false);
      else {
        node = makeCard(row,false);
        cards.append(node);
      }
      nodes.set(slot,node);
    }
    if (photos && Math.abs(offset) < photoRadius && (!photoIds || photoIds.has(node.recipe.id))) {
      reveal(node, slot === center && !busy ? 'high' : 'auto');
    }
    poseCard(node, offset, slot === center);
  }
  recycled.forEach(node=>node.remove());
}

function setBusy(value) {
  busy = value;
  spin.disabled = value || pool.length < 2;
  open.disabled = value || !list.length;
  tabs.forEach(button => { button.disabled = value; });
  Object.values(filters).forEach(input => { input.disabled = value; });
  $('filter-reset').disabled = value;
  stage.setAttribute('aria-busy', String(value));
}

function announce() {
  const row = current();
  $('status').textContent = row ? 'Выбрано: ' + row.title : 'По этим условиям блюд нет.';
  if (row) remembered.set(category,row.id);
  $('browse-count').textContent = row ? (wrap(Math.round(position),list.length)+1) + ' из ' + list.length : '0 блюд';
  $('reaction-cuisine').textContent = row?.displayCuisine || '';
  $('reaction-ingredients').textContent = row ? row.keyIngredients.join(', ') : 'По этим условиям блюд нет.';
}

function stopPerf() {
  cancelAnimationFrame(perfFrame);
  if (!perf) return;
  const samples = perf.samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor((samples.length - 1) * .95)] || 0;
  $('diagnostics').classList.remove('sr');
  $('diagnostics').textContent = 'Кадры JS: p95 ' + p95.toFixed(1) + ' мс · >25 мс: ' +
    samples.filter(x => x > 25).length + '/' + samples.length;
  perf = null;
}

function startPerf() {
  if (!diagnostic) return;
  perf = { samples: [], previous: null };
  function sample(t) {
    if (!perf) return;
    if (perf.previous !== null) perf.samples.push(t - perf.previous);
    perf.previous = t;
    perfFrame = requestAnimationFrame(sample);
  }
  perfFrame = requestAnimationFrame(sample);
}

function stopAnimation() {
  pendingDraw = null;
  generation++;
  cancelAnimationFrame(frame);
  cancelAnimationFrame(dragFrame);
  frame = dragFrame = 0;
  if (nativeRun) {
    const run = nativeRun;
    nativeRun = null;
    const t = clamp(Number(run.animations[0].currentTime ?? 0) / SPIN_MS, 0, 1);
    position = run.from + (run.to - run.from) * spinEase(t);
    paint();
    run.animations.forEach(animation => animation.cancel());
  }
  stopPerf();
}

function complete(target, playful) {
  position = list.length ? wrap(target,list.length) : 0;
  // A small native ring may repeat items over a multiple of the catalogue.
  if (ring.length) position = wrap(target,ring.length);
  paint({ photos: true });
  if (pendingDraw && current()?.id === pendingDraw.row.id) {
    const seen = pendingDraw.reset ? new Set() : (drawHistory.get(drawKey) || new Set());
    seen.add(pendingDraw.row.id);
    drawHistory.delete(drawKey);
    drawHistory.set(drawKey,seen);
    if (drawHistory.size>48) drawHistory.delete(drawHistory.keys().next().value);
  }
  pendingDraw = null;
  stopPerf();
  setBusy(false);
  announce();
}

function nativeSpin(target) {
  if (!ring.length || typeof ring[0].animate !== 'function') return false;
  const from = position;
  const animations = [];
  try {
    const tracks = nativeTracks(ring.length, from, target, stepPx);
    const start = document.timeline.currentTime;
    for (let i = 0; i < ring.length; i++) {
      const animation = ring[i].animate(tracks[i], { duration: SPIN_MS, fill: 'both' });
      animations.push(animation);
      if (start !== null) animation.startTime = start;
    }
  } catch {
    animations.forEach(animation => { animation.finished.catch(() => {}); animation.cancel(); });
    return false;
  }
  const run = { from, to: target, animations };
  nativeRun = run;
  const settle = () => {
    if (nativeRun !== run) return;
    nativeRun = null;
    complete(target, true);
    animations.forEach(animation => animation.cancel());
  };
  Promise.all(animations.map(animation => animation.finished)).then(settle, settle);
  return true;
}

function animate(target, ms, ease, playful = false, draw = null) {
  stopAnimation();
  pendingDraw = draw;
  const ticket = generation, from = position;
  setBusy(true);
  if (motion.matches || ms <= 0) {
    complete(target, playful);
    return;
  }
  if (ease === spinEase) {
    startPerf();
    if (nativeSpin(target)) return;
  }
  // Load photos around the starting and landing positions. During the fast
  // middle phase the moving cards retain their actual titles and metadata.
  const photoIds = draw ? new Set(
    [Math.round(from) + 3, target - 3].flatMap(center =>
      Array.from({ length: 13 }, (_, i) => list[wrap(center + i - 6, list.length)].id))
  ) : undefined;
  let start;
  function tick(now) {
    if (ticket !== generation) return;
    start ??= now;
    const t = clamp((now - start) / ms, 0, 1);
    if (t === 1) {
      frame = 0;
      complete(target, playful);
      return;
    }
    position = from + (target - from) * ease(t);
    paint({ photos: true, photoIds });
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}

function roll() {
  if (busy || list.length < 2) return;
  goal('roulette_spin');
  const start = Math.round(position);
  const draw = drawUnseen(list,drawHistory.get(drawKey)||new Set(),current()?.id);
  if (!draw) return;
  const index = list.findIndex(row=>row.id===draw.row.id);
  animate(start+spinTo(list.length,start,index),SPIN_MS,spinEase,true,draw);
}

function select(cat, dish) {
  if (busy) return;
  stopAnimation();
  category = cat;
  const maxKcal = Number(filters.kcal.value), minProtein = Number(filters.protein.value);
  $('nutrition-filter-note').hidden = !maxKcal && !minProtein;
  pool = filterRecipes(recipes, {
    maxKcal, minProtein,
    category, maxTime: Number(filters.time.value), family: filters.family.checked,
    meatless: filters.meatless.checked, favorites: filters.favorites.checked ? favorites : null,
    products: filters.products.value,
  });
  list = prepareReel(pool);
  drawKey = category + ':' + list.map(row=>row.id).join(',');
  position = Math.max(0,list.findIndex(row=>row.id===(dish||remembered.get(category))));
  tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cat === cat)));
  cards.replaceChildren();
  nodes.clear();
  ring = [];
  const count = list.length === 9 ? 9 : ringCount(list.length);
  for (let slot = 0; slot < count; slot++) {
    const node = makeCard(list[wrap(slot, list.length)], true);
    ring.push(node);
    cards.append(node);
  }
  $('result-count').textContent = 'Найдено блюд: ' + pool.length;
  if (!list.length) cards.append(el('p', 'empty', 'По этим условиям блюд нет. Измените подбор.'));
  measure();
  paint({ photos: true, photoRadius: stage.clientWidth <= 440 ? 1.6 : 2.6 });
  setBusy(false);
  announce();
}

function renderIngredients() {
  $('portion-count').value = String(servings);
  $('portion-less').disabled = servings === 1;
  $('portion-more').disabled = servings === 24;
  const note = $('nutrition-note');
  if (note) {
    const changed = servings !== opened.servings && opened.ingredients.some(item => item.scaling && item.amount !== null);
    const parts = ['Приблизительные значения'];
    if (changed) parts.push('для базовой рецептуры');
    if (opened.nutrition.excludesOptional && !opened.nutrition.excludedItems) parts.push('без необязательных добавок');
    note.textContent = parts.join(' · ');
  }
  const items = opened.ingredients.map((item, i) => ingredientItem(item, opened.ingredientFlags?.[i]));
  $('recipe-ingredients').replaceChildren(...items);
}

const allergens = {
  milk:'молоко', egg:'яйца', fish:'рыба', crustacean:'ракообразные', mollusc:'моллюски',
  peanut:'арахис', nuts:'орехи', soy:'соя', sesame:'кунжут', mustard:'горчица',
  celery:'сельдерей', gluten:'злаки с глютеном', lupin:'люпин',
};

function ingredientItem(item, flag) {
  const full = ingredientLine(item, opened.servings, servings);
  if (!flag?.codes.length && !flag?.checkLabel && !flag?.special) return el('li', '', full);
  const line = el('li', '', item.name);
  if (flag.codes.length) {
    const marker = el('sup', 'allergen-mark', '*');
    marker.setAttribute('aria-hidden', 'true');
    line.append(marker, el('span', 'sr', ' (содержит: ' + flag.codes.map(code => allergens[code]).join(', ') + ')'));
  }
  line.append(full.slice(item.name.length));
  if (flag.checkLabel || flag.special) {
    line.append(el('span', 'ingredient-label', flag.special ? 'Сверьте специальные указания на этикетке.' : 'Сверьте состав на этикетке.'));
  }
  return line;
}

function nutritionPanel(row) {
  const panel = el('section', 'nutrition-panel');
  panel.append(el('h3', '', 'Расчётная пищевая ценность на порцию'));
  if (!row.nutrition) {
    panel.append(el('p', '', 'Недостаточно данных для расчёта.'));
    return panel;
  }
  const grid = el('dl', 'nutrition-grid');
  const units = [['Калории','kcal','ккал'],['Белки','protein','г'],['Жиры','fat','г'],['Углеводы','carbs','г']];
  const num = new Intl.NumberFormat('ru-RU', {maximumFractionDigits:1, useGrouping:false});
  for (const [title,key,unit] of units) {
    const cell = el('div', 'nutrition-cell');
    cell.append(el('dt','',title), el('dd','',num.format(displayNutritionValue(key, row.nutrition[key])) + ' ' + unit));
    grid.append(cell);
  }
  const note = el('p', 'nutrition-note', 'Приблизительные значения');
  note.id = 'nutrition-note';
  panel.append(grid, note);
  if (row.nutrition.range) {
    const ranges = units.map(([label,key,unit]) =>
      label.toLowerCase() + ' ' + formatNutritionValue(row.nutrition, key, num) + '\u00a0' + unit);
    panel.append(el('p', 'nutrition-note', 'Расчётный диапазон · ' + ranges.join(' · ')));
  }
  if (row.nutrition.estimateNotes?.length) {
    const details = el('details', 'nutrition-note');
    details.append(el('summary', '', 'Основа расчёта'));
    const notes = el('ul');
    for (const text of row.nutrition.estimateNotes) notes.append(el('li', '', text));
    details.append(notes);
    panel.append(details);
  }
  if (row.nutrition.excludedItems?.length) panel.append(el('p', 'nutrition-note',
    'В расчёт не включены: ' + row.nutrition.excludedItems.join(', ') + '.'));
  if (row.nutrition.photoNote) panel.append(el('p', 'nutrition-note', row.nutrition.photoNote));
  if (row.nutrition.fiber !== undefined) panel.append(el('p','nutrition-note','Пищевые волокна — '+num.format(row.nutrition.fiber)+' г'));
  return panel;
}

function updateFavorite() {
  const saved = favorites.has(opened.id);
  const button = $('favorite');
  button.setAttribute('aria-pressed', String(saved));
  button.textContent = saved ? 'В избранном' : 'В избранное';
}

function creditLine(label, credit, url, license, licenseUrl, change = '') {
  const line = el('p', 'attribution', label + ': ');
  const source = el('a', '', credit);
  source.href = url;
  const terms = el('a', '', license);
  terms.href = licenseUrl;
  line.append(source, ' · ', terms, change);
  return line;
}

function openRecipe() {
  if (busy || !current()) return;
  opened = current();
  goal('roulette_recipe_open');
  const row = opened;
  servings = row.servings;
  $('recipeTitle').textContent = row.title;
  $('recipeBadge').textContent = row.status === 'demo' ? 'Тестовый рецепт' : '';
  if (row.image.origin === 'synthetic' || row.image.placeholder) {
    $('recipeBadge').textContent = [$('recipeBadge').textContent, row.image.placeholder ? 'Фото готовится' : 'Иллюстрация'].filter(Boolean).join(' · ');
  }
  $('recipeBadge').hidden = !$('recipeBadge').textContent;
  $('recipeCuisine').textContent = row.displayCuisine || row.cuisine || '';
  $('recipeCuisine').hidden = !$('recipeCuisine').textContent;
  const nativeName = $('recipeOriginalTitle');
  nativeName.textContent = row.originalTitle || '';
  nativeName.hidden = !row.originalTitle;
  $('recipeMeta').textContent = row.timing ? 'До готовности ' + row.timing.total + ' мин' +
    (row.timing.wait ? ' · из них ожидание ' + row.timing.wait + ' мин' : '') :
    'Время по источнику · требует проверки';
  $('shareStatus').textContent = '';
  const body = $('recipeBody');
  const photo = el('figure', 'recipe-photo');
  photo.append(picture(row));
  body.replaceChildren(photo,nutritionPanel(row));
  if (row.description) body.append(el('p','recipe-description',row.description));
  const ahead = row.timing?.ahead || row.rest;
  if (ahead) body.append(el('p', 'recipe-note', ahead));
  if (row.handling) body.append(el('p', 'recipe-note', row.handling));
  const servingControls = document.querySelector('#serving-template').content.cloneNode(true);
  body.append(servingControls, el('h3', '', 'Ингредиенты'));
  const ingredients = el('ul'); ingredients.id = 'recipe-ingredients'; body.append(ingredients);
  renderIngredients();
  if (row.ingredientFlags?.some(item => item.codes.length)) body.append(el('p','allergen-note',
    '* — ингредиенты, содержащие распространённые пищевые аллергены. Проверяйте состав готовых продуктов.'));
  $('portion-less').onclick = () => { servings--; renderIngredients(); };
  $('portion-more').onclick = () => { servings++; renderIngredients(); };
  body.append(el('h3', '', 'Как приготовить'));
  if (row.editorialHold) {
    body.append(el('p', 'recipe-note', row.editorialHold));
  } else {
    const steps = el('ol');
    steps.append(...row.steps.map(step => el('li', '', step)));
    body.append(steps);
  }
  if (row.comment) body.append(el('h3', '', 'Комментарий нутрициолога'), el('p', '', row.comment.text), el('p', '', row.comment.by));

  const credits = el('details', 'recipe-credits');
  credits.append(el('summary', '', 'Источники и изображение'));
  if (row.nutrition) {
    const link = el('a', '', 'Данные о составе продуктов');
    link.href = row.nutrition.source;
    credits.append(el('p', 'attribution', row.nutrition.method), link);
  }
  if (row.cuisineSource) {
    const link = el('a','','Справка о кухне');
    link.href = row.cuisineSource;
    credits.append(link);
  }
  if (row.source.credit) credits.append(creditLine('Рецепт', row.source.credit, row.source.url,
    row.source.license, row.source.licenseUrl));
  if (row.image.credit) credits.append(creditLine(row.image.review === 'pending-original-review' ? 'Фото (сведения из прежнего каталога)' : 'Фото', row.image.credit, row.image.creditUrl,
    row.image.license, row.image.licenseUrl, ' · уменьшено для сайта'));
  if (row.image.note) credits.append(el('p', '', row.image.note));
  if (row.image.origin === 'synthetic') credits.append(el('p', '', 'Изображение сгенерировано как иллюстрация блюда.'));
  if (credits.childElementCount > 1) body.append(credits);
  const journalLink = $('source');
  journalLink.hidden = row.source.type !== 'journal';
  if (journalLink.hidden) journalLink.removeAttribute('href');
  else journalLink.href = row.source.path;
  updateFavorite();
  dialog.showModal();
  $('recipeScroll').scrollTop = 0;
}

$('favorite').onclick = () => {
  goal('roulette_favorite');
  if (favorites.has(opened.id)) favorites.delete(opened.id);
  else favorites.add(opened.id);
  try { localStorage.setItem(storageKey, JSON.stringify([...favorites])); }
  catch { $('shareStatus').textContent = 'Избранное сохранено до закрытия страницы.'; }
  updateFavorite();
};
$('close').onclick = () => dialog.close();
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { if (filters.favorites.checked) select(category, current()?.id); });
$('share').onclick = async () => {
  const url = new URL('/roulette/', location.origin);
  url.searchParams.set('dish', opened.id);
  try {
    if (navigator.share) {
      await navigator.share({ title: opened.title, url: url.href });
      goal('roulette_share');
      return;
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url.href);
      goal('roulette_share');
      $('shareStatus').textContent = 'Ссылка скопирована.';
      return;
    }
  } catch (error) { if (error.name === 'AbortError') return; }
  const link = el('a', '', url.href);
  link.href = url.href;
  $('shareStatus').replaceChildren(link);
};
open.onclick = openRecipe;
spin.onclick = roll;
tabs.forEach(button => { button.onclick = () => select(button.dataset.cat); });
for (const filter of Object.values(filters)) {
  filter.addEventListener(filter.type === 'search' ? 'input' : 'change', () => {
    goal('roulette_filter');
    clearTimeout(filterTimer);
    if (filter.type === 'search') filterTimer = setTimeout(() => select(category, current()?.id), 120);
    else select(category, current()?.id);
  });
}
$('filter-reset').onclick = () => {
  goal('roulette_filter');
  Object.values(filters).forEach(input => {
    if (input.type === 'checkbox') input.checked = false;
    else input.value = '';
  });
  select(category, current()?.id);
};

stage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || list.length < 2) return;
  stopAnimation();
  setBusy(true);
  gesture = { id: event.pointerId, x: event.clientX, start: position, last: position, time: performance.now(), velocity: 0 };
  stage.classList.add('dragging');
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const now = performance.now(), next = gesture.start + (gesture.x - event.clientX) / stepPx;
  const delta = Math.max(1, now - gesture.time);
  gesture.velocity = .55 * gesture.velocity + .45 * (next - gesture.last) / delta;
  gesture.last = next;
  gesture.time = now;
  position = next;
  if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; paint({ photos: true }); });
});
function finish(event, cancel = false) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const drag = gesture;
  gesture = null;
  stage.classList.remove('dragging');
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  const moved = Math.abs(event.clientX - drag.x) > 5;
  const velocity = cancel || performance.now() - drag.time > 100 ? 0 : drag.velocity;
  const target = cancel || !moved ? Math.round(position) : dragTarget(position, velocity, drag.start);
  animate(target, clamp(260 + Math.abs(target - position) * 115, 260, 1500), settleEase, moved);
}
stage.addEventListener('pointerup', event => finish(event));
stage.addEventListener('pointercancel', event => finish(event, true));
stage.addEventListener('lostpointercapture', event => finish(event, true));
stage.addEventListener('keydown', event => {
  if (event.key === 'Escape' && busy && !gesture) {
    event.preventDefault();
    stopAnimation();
    complete(Math.round(position), false);
  }
  if (busy || list.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  animate(Math.round(position) + (event.key === 'ArrowLeft' ? 1 : -1), 280, settleEase, true);
});
window.addEventListener('resize', () => {
  const before = stepPx;
  measure();
  if (Math.abs(before - stepPx) < .5) return;
  if (nativeRun) {
    stopAnimation();
    animate(Math.round(position), 200, settleEase);
  } else paint({ photos: !busy });
}, { passive: true });

const requested = recipes.find(row => row.id === params.get('dish'));
select(requested?.cat || 'dinner', requested?.id);

$('roulette-services').addEventListener('click', () => goal('roulette_services'));
startMetrics();
