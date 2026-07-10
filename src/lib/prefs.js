// @ts-check

const HIDDEN_KEY = 'prefs.hiddenMeters';

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
