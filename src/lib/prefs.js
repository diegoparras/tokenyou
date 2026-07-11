// @ts-check

const HIDDEN_KEY = 'prefs.hiddenMeters';
const BADGE_KEY = 'prefs.badgePlatform';
const REFRESH_KEY = 'prefs.refreshMinutes';

export const DEFAULT_REFRESH_MIN = 5;
export const REFRESH_CHOICES = [1, 5, 10];

/**
 * Plataforma cuyo peor medidor se muestra en el badge del ícono.
 * null = el peor medidor de todas (comportamiento por defecto).
 * @returns {Promise<string|null>}
 */
export async function getBadgePlatform() {
  const stored = await chrome.storage.local.get(BADGE_KEY);
  const v = stored[BADGE_KEY];
  return typeof v === 'string' && v ? v : null;
}

/** @param {string|null} platformId */
export async function setBadgePlatform(platformId) {
  if (platformId) await chrome.storage.local.set({ [BADGE_KEY]: platformId });
  else await chrome.storage.local.remove(BADGE_KEY);
}

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
export async function setRefreshForPlatform(id, minutes) {
  const prefs = await getRefreshMinutes();
  if (minutes === DEFAULT_REFRESH_MIN) delete prefs[id];
  else prefs[id] = minutes;
  await chrome.storage.local.set({ [REFRESH_KEY]: prefs });
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
export async function toggleHiddenMeter(key) {
  const hidden = await getHiddenMeters();
  if (hidden.has(key)) hidden.delete(key);
  else hidden.add(key);
  await chrome.storage.local.set({ [HIDDEN_KEY]: [...hidden] });
  return hidden;
}
