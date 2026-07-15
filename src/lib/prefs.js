// @ts-check

const HIDDEN_KEY = 'prefs.hiddenMeters';
const HIDDEN_PLATFORMS_KEY = 'prefs.hiddenPlatforms';
const REFRESH_KEY = 'prefs.refreshMinutes';
const PINS_KEY = 'prefs.pins';
const COLLAPSED_KEY = 'prefs.collapsed';
const ORDER_KEY = 'prefs.order';

export const MAX_PINS = 3;

// Cadena para serializar las lecturas-modificaciones-escrituras sobre storage.
let writeChain = /** @type {Promise<any>} */ (Promise.resolve());
/**
 * Serializa una operación de lectura-modificación-escritura sobre storage.
 * Sin esto, dos toggles casi simultáneos (p. ej. ocultar varias plataformas
 * seguidas) se pisan: ambos leen el mismo estado previo y la segunda escritura
 * borra la primera. La cadena garantiza que corran una después de la otra.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
function serialize(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Medidores fijados: claves `${platformId}/${meterId}`, en orden, máx 3.
 * El primero manda el badge del ícono; los tres alimentan los anillos del header.
 * @returns {Promise<string[]>}
 */
export async function getPins() {
  const stored = await chrome.storage.local.get(PINS_KEY);
  const list = Array.isArray(stored[PINS_KEY]) ? stored[PINS_KEY] : [];
  return list.filter((k) => typeof k === 'string').slice(0, MAX_PINS);
}

/** @param {string} key `${platformId}/${meterId}` @returns {Promise<string[]>} */
export function togglePin(key) {
  return serialize(async () => {
    const pins = await getPins();
    const i = pins.indexOf(key);
    if (i >= 0) pins.splice(i, 1);
    else {
      pins.push(key);
      while (pins.length > MAX_PINS) pins.shift();
    }
    await chrome.storage.local.set({ [PINS_KEY]: pins });
    return pins;
  });
}

/** Quita todos los pins de una plataforma (al ocultarla o quitarla). @param {string} platformId */
export function unpinPlatform(platformId) {
  return serialize(async () => {
    const pins = await getPins();
    const next = pins.filter((k) => k.split('/')[0] !== platformId);
    if (next.length !== pins.length) await chrome.storage.local.set({ [PINS_KEY]: next });
    return next;
  });
}

/**
 * Plataformas ocultas del popup. Mantienen el permiso y se siguen midiendo en
 * segundo plano (para el historial); solo no se muestran ni cuentan para el badge.
 * @returns {Promise<Set<string>>}
 */
export async function getHiddenPlatforms() {
  const stored = await chrome.storage.local.get(HIDDEN_PLATFORMS_KEY);
  const list = Array.isArray(stored[HIDDEN_PLATFORMS_KEY]) ? stored[HIDDEN_PLATFORMS_KEY] : [];
  return new Set(list.filter((k) => typeof k === 'string'));
}

/** @param {string} platformId @param {boolean} hidden @returns {Promise<Set<string>>} */
export function setPlatformHidden(platformId, hidden) {
  return serialize(async () => {
    const set = await getHiddenPlatforms();
    if (hidden) set.add(platformId); else set.delete(platformId);
    await chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: [...set] });
    return set;
  });
}

/** Plataformas colapsadas (una sola línea en el popup). @returns {Promise<Set<string>>} */
export async function getCollapsed() {
  const stored = await chrome.storage.local.get(COLLAPSED_KEY);
  const list = Array.isArray(stored[COLLAPSED_KEY]) ? stored[COLLAPSED_KEY] : [];
  return new Set(list.filter((k) => typeof k === 'string'));
}

/** @param {string} platformId @returns {Promise<Set<string>>} */
export function toggleCollapsed(platformId) {
  return serialize(async () => {
    const set = await getCollapsed();
    if (set.has(platformId)) set.delete(platformId);
    else set.add(platformId);
    await chrome.storage.local.set({ [COLLAPSED_KEY]: [...set] });
    return set;
  });
}

/** Orden manual de plataformas (ids). Las no listadas van al final en su orden natural. */
export async function getOrder() {
  const stored = await chrome.storage.local.get(ORDER_KEY);
  return Array.isArray(stored[ORDER_KEY]) ? stored[ORDER_KEY].filter((k) => typeof k === 'string') : [];
}

/** @param {string[]} order */
export async function setOrder(order) {
  await chrome.storage.local.set({ [ORDER_KEY]: order });
}

export const DEFAULT_REFRESH_MIN = 5;
export const REFRESH_CHOICES = [1, 5, 10];

/** @returns {Promise<Record<string, number>>} minutos de refresco por platformId */
export async function getRefreshMinutes() {
  const stored = await chrome.storage.local.get(REFRESH_KEY);
  const v = stored[REFRESH_KEY];
  return v && typeof v === 'object' ? v : {};
}

/** @param {Record<string, number>} prefs @param {string} id */
export function refreshMinutesFor(prefs, id) {
  const m = prefs[id];
  return REFRESH_CHOICES.includes(m) ? m : DEFAULT_REFRESH_MIN;
}

/** @param {string} id @param {number} minutes */
export function setRefreshForPlatform(id, minutes) {
  return serialize(async () => {
    const prefs = await getRefreshMinutes();
    if (minutes === DEFAULT_REFRESH_MIN) delete prefs[id];
    else prefs[id] = minutes;
    await chrome.storage.local.set({ [REFRESH_KEY]: prefs });
  });
}

/** @returns {Promise<Set<string>>} claves `${platformId}/${meterId}` ocultas */
export async function getHiddenMeters() {
  const stored = await chrome.storage.local.get(HIDDEN_KEY);
  const list = Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY] : [];
  return new Set(list.filter((k) => typeof k === 'string'));
}

/**
 * @param {string} key `${platformId}/${meterId}`
 * @returns {Promise<Set<string>>} el set actualizado
 */
export function toggleHiddenMeter(key) {
  return serialize(async () => {
    const hidden = await getHiddenMeters();
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    await chrome.storage.local.set({ [HIDDEN_KEY]: [...hidden] });
    return hidden;
  });
}
