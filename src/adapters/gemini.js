// @ts-check

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Gemini no expone endpoint de cuota (límites de cómputo con refresh de 5 h
 * + tope semanal, sin contador visible). Este adaptador no toca la red:
 * computa conteos desde los eventos locales que registra el content script.
 */
export const gemini = {
  id: 'gemini',
  name: 'Gemini',
  origin: 'https://gemini.google.com/*',
  home: 'https://gemini.google.com',
  contentScripts: [
    {
      id: 'gemini-main',
      matches: ['https://gemini.google.com/*'],
      js: ['src/content/gemini-main.js'],
      world: /** @type {'MAIN'} */ ('MAIN'),
      runAt: /** @type {'document_start'} */ ('document_start'),
      persistAcrossSessions: true,
    },
    {
      id: 'gemini-bridge',
      matches: ['https://gemini.google.com/*'],
      js: ['src/content/gemini-bridge.js'],
      runAt: /** @type {'document_idle'} */ ('document_idle'),
      persistAcrossSessions: true,
    },
  ],

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const stored = await chrome.storage.local.get('gemini.events');
    /** @type {{t: number, model: string|null}[]} */
    const events = Array.isArray(stored['gemini.events']) ? stored['gemini.events'] : [];
    const now = Date.now();
    const in5h = events.filter((e) => now - e.t < 5 * 3600 * 1000).length;
    const in7d = events.filter((e) => now - e.t < 7 * 24 * 3600 * 1000).length;

    return {
      platformId: 'gemini',
      ok: true,
      approx: true,
      meters: [
        { id: 'window5h', label: t('meterWindowHours', '5'), usedPct: null, resetsAt: null, used: in5h },
        { id: 'week', label: t('meterWeek'), usedPct: null, resetsAt: null, used: in7d },
      ],
      fetchedAt: now,
    };
  },
};
