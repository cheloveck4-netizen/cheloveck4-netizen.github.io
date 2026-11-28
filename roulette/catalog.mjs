export const categories = ['breakfast', 'lunch', 'dinner'];
const number = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const artifact = /[\p{Cf}\uFFFD]|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|<[^>]+>|&(?:#x?[a-f\d]+|[a-z]+);|\b(?:null|undefined)\b|\.(?:jpe?g|png|webp)\b/iu;
const cleanText = value => text(value) && !artifact.test(value);
const nameCredit = value => cleanText(value) && value.length <= 64 &&
  !/creative commons|\blicen[cs](?:e|ed|ing)\b|machine-readable/i.test(value);
const array = (values, passes) => Array.isArray(values) && values.every(passes);
const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const https = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
};
const ALLERGEN_CODES = new Set(['milk','egg','fish','crustacean','mollusc','peanut','nuts','soy','sesame','mustard','celery','gluten','lupin']);
const safePath = /^\/articles\/[a-z0-9][a-z0-9-]*\.html$/;

export function validateCatalog(rows, { allowDemo = true } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Expected a recipe array');
  const ids = new Set();
  for (const row of rows) {
    const fail = field => { throw new Error('Invalid recipe ' + (row?.id || '?') + ': ' + field); };
    if (!row || !text(row.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || ids.has(row.id)) fail('id');
    ids.add(row.id);
    if (!categories.includes(row.cat) || !cleanText(row.title)) fail('category/title');
    if (row.cuisine !== undefined && (!cleanText(row.cuisine) || row.cuisine.length>80 ||
        !https(row.cuisineSource))) fail('cuisine attribution');
    if (row.description !== undefined && (!cleanText(row.description) || row.description.length>220)) fail('dish description');
    if (!['demo', 'approved'].includes(row.status) || (!allowDemo && row.status === 'demo')) fail('status');
    if (!within(row.prep, 0, 1440) || !within(row.cook, 0, 1440) ||
        row.prep + row.cook === 0 || !within(row.servings, 1, 24)) fail('time/servings');
    if (row.rest !== undefined && !cleanText(row.rest)) fail('rest time');
    if (row.editorialHold !== undefined && (row.status !== 'demo' || !cleanText(row.editorialHold))) fail('editorial hold');
    if (row.handling !== undefined && !cleanText(row.handling)) fail('food handling');
    if (!array(row.tags, item => ['family', 'meatless'].includes(item))) fail('tags');
    if (!row.source || !['demo', 'journal', 'external', 'original'].includes(row.source.type) ||
        (row.source.type === 'journal' && !safePath.test(row.source.path)) ||
        (row.source.type === 'external' && !https(row.source.url)) ||
        (row.source.type === 'original' && !text(row.source.author))) fail('source');
    if (row.source.credit && (!nameCredit(row.source.credit) || !https(row.source.url) ||
        !text(row.source.license) || !https(row.source.licenseUrl))) fail('source attribution');
    if (!row.allergens || typeof row.allergens.verified !== 'boolean' || !array(row.allergens.listed, text)) fail('allergens');
    if (!row.ingredients?.length || !array(row.ingredients, item => {
      if (!item || !cleanText(item.name) || (item.note !== undefined && !cleanText(item.note)) ||
          (item.scaling !== undefined && !['fixed', 'damped'].includes(item.scaling))) return false;
      if (item.amount === null) return item.unit === null && (row.status === 'demo' || text(item.note));
      const positive = value => number(value) && value > 0;
      const amount = item.amount;
      const range = array(amount, positive) && amount.length === 2 && amount[0] <= amount[1];
      return cleanText(item.unit) && (positive(amount) || range);
    })) fail('ingredients');
    if (!row.steps?.length || !array(row.steps, step => cleanText(step) && /[А-Яа-яЁё]/u.test(step))) fail('steps');
    const image = row.image;
    if (!image || !/^\/roulette\/[a-z0-9-]+\.webp$/.test(image.src) || !cleanText(image.alt) ||
        !['synthetic', 'original', 'licensed'].includes(image.origin) ||
        !['test-only', 'owned', 'licensed'].includes(image.rights) ||
        (image.rights === 'licensed' && (!https(image.creditUrl) || !nameCredit(image.credit) ||
          !text(image.license) || !https(image.licenseUrl))) ||
        (image.frame !== undefined && image.frame !== 'full') ||
        (image.focus !== undefined && (!array(image.focus, value => within(value, 0, 100)) ||
          image.focus.length !== 2 || image.frame === 'full')) ||
        (image.width !== undefined && (!within(image.width, 1, 2000) || !within(image.height, 1, 2000)))) fail('image');
    if (row.status === 'approved') {
      const date = row.review?.date;
      if (!text(row.review?.by) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
          !row.allergens.verified || row.source.type === 'demo' || image.rights === 'test-only') fail('editorial approval');
    }
    if (row.ingredientFlags !== undefined && (!array(row.ingredientFlags, flag => flag &&
        typeof flag.checkLabel === 'boolean' && [null, 'check'].includes(flag.special) &&
        array(flag.codes, code => ALLERGEN_CODES.has(code)) &&
        new Set(flag.codes).size === flag.codes.length) || row.ingredientFlags.length !== row.ingredients.length)) fail('ingredient allergens');
    if (row.timing && (!['active','heat','overlap','wait','total'].every(key => within(row.timing[key],0,1440)) ||
      row.timing.overlap > Math.min(row.timing.active,row.timing.heat) ||
      row.timing.total !== row.timing.active + row.timing.heat + row.timing.wait - row.timing.overlap ||
      typeof row.timing.ahead !== 'string' ||
      (row.timing.aheadRequired !== undefined && typeof row.timing.aheadRequired !== 'boolean') ||
      (row.timing.aheadRequired && !text(row.timing.ahead)))) fail('timing');
    if (row.nutrition && (!text(row.nutrition.method) || !https(row.nutrition.source) || row.nutrition.basisServings !== row.servings ||
        (row.nutrition.fiber !== undefined && (!number(row.nutrition.fiber) || row.nutrition.fiber < 0)) ||
        (row.nutrition.excludedItems !== undefined && (!array(row.nutrition.excludedItems, text) || !row.nutrition.excludedItems.length)) ||
        (row.nutrition.photoNote !== undefined && !text(row.nutrition.photoNote)) ||
        (row.nutrition.estimateNotes !== undefined && !array(row.nutrition.estimateNotes, text)) ||
        ['kcal', 'protein', 'fat', 'carbs'].some(key => {
          const value = row.nutrition[key];
          if (!number(value) || value < 0) return true;
          if (row.nutrition.range === undefined) return false;
          const span = row.nutrition.range?.[key];
          return !array(span, number) || span.length !== 2 || span[0] < 0 || span[0] > value || span[1] < value;
        }))) fail('nutrition');
    if (row.comment && (row.status !== 'approved' || !text(row.comment.text) || !text(row.comment.by))) fail('nutritionist comment');
  }
  return rows;
}

const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const plurals = new Intl.PluralRules('ru-RU');

export function displayNutritionValue(key, value) {
  const step = key === 'kcal' ? 5 : 1;
  return Math.round(value / step) * step;
}

export function formatNutritionValue(nutrition, key, formatter) {
  const span = nutrition.range?.[key];
  if (!span || span[1] - span[0] < 0.001001) {
    return formatter.format(displayNutritionValue(key, nutrition[key]));
  }
  const step = key === 'kcal' ? 5 : 1;
  return formatter.format(Math.floor(span[0] / step) * step) + '–' +
    formatter.format(Math.ceil(span[1] / step) * step);
}

export function portions(count) {
  return count + ' ' + ({ one: 'порция', few: 'порции' }[plurals.select(count)] || 'порций');
}

export function ingredientLine(item, base, servings) {
  if (item.amount === null) return item.name + ' — ' + (item.note || 'по вкусу');
  const ratio = servings / base;
  const coefficient = item.scaling === 'fixed' ? 1 : item.scaling === 'damped' ? Math.sqrt(ratio) : ratio;
  const scale = value => {
    const scaled = value * coefficient;
    if (coefficient === 1) return format.format(value);
    if (['шт.', 'зубч.', 'ломт.', 'веточ.', 'стеб.'].includes(item.unit) && scaled >= .5) {
      return format.format(Math.round(scaled * 2) / 2);
    }
    if (['г', 'мл'].includes(item.unit) && scaled >= 10) return format.format(Math.round(scaled));
    return format.format(scaled);
  };
  const amount = Array.isArray(item.amount) ? item.amount.map(scale).join('–') : scale(item.amount);
  return item.name + ' — ' + amount + ' ' + item.unit + (item.note ? ' (' + item.note + ')' : '');
}

export function filterRecipes(recipes, { category, maxTime, family, meatless, favorites, products, maxKcal, minProtein }) {
  const normalize = text => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const words = normalize(products || '').split(',').map(word => word.trim()).filter(Boolean);
  return recipes.filter(row => row.cat === category &&
    (!maxTime || (row.timing && !row.timing.aheadRequired && row.timing.total <= maxTime)) &&
    (!maxKcal || (row.nutrition && (row.nutrition.range?.kcal[1] ?? row.nutrition.kcal) <= maxKcal)) &&
    (!minProtein || (row.nutrition && (row.nutrition.range?.protein[0] ?? row.nutrition.protein) >= minProtein)) &&
    (!family || row.tags.includes('family')) && (!meatless || row.tags.includes('meatless')) &&
    (!favorites || favorites.has(row.id)) &&
    words.every(word => row.ingredients.some(item => normalize(item.name).includes(word))));
}
