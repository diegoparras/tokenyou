// @ts-check
// Mundo ISOLATED: recibe la señal vacía del interceptor y registra solo
// {timestamp, nombre del modelo visible}. Nada más sale de la página.
const EVENTS_KEY = 'gemini.events';
const RETENTION_MS = 8 * 24 * 3600 * 1000;

document.addEventListener('tokenyou:gemini-send', () => {
  const model =
    document.querySelector('bard-mode-switcher button')?.textContent?.trim() || null;
  void chrome.storage.local.get(EVENTS_KEY).then((stored) => {
    /** @type {{t: number, model: string|null}[]} */
    const events = Array.isArray(stored[EVENTS_KEY]) ? stored[EVENTS_KEY] : [];
    const cutoff = Date.now() - RETENTION_MS;
    const next = events.filter((e) => e && e.t > cutoff);
    next.push({ t: Date.now(), model });
    void chrome.storage.local.set({ [EVENTS_KEY]: next });
  });
});
