// @ts-check
// Corre en el mundo MAIN de gemini.google.com (no hay endpoint de cuota, así
// que contamos envíos). Restricción deliberada: este script NO lee ni reenvía
// ningún dato de la página ni de la red — solo emite un evento vacío cuando
// detecta un request de envío de prompt (StreamGenerate). El payload nunca se toca.
(() => {
  const MARK = 'tokenyou:gemini-send';
  const isSend = (/** @type {unknown} */ url) =>
    typeof url === 'string' && url.includes('StreamGenerate');
  const signal = () => document.dispatchEvent(new CustomEvent(MARK));

  const origFetch = window.fetch;
  window.fetch = (...args) => {
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (isSend(url)) signal();
    } catch { /* nunca interferir con la página */ }
    return origFetch.apply(window, args);
  };

  const pending = new WeakSet();
  const origOpen = XMLHttpRequest.prototype.open;
  /**
   * @this {XMLHttpRequest}
   * @param {...any} args
   */
  XMLHttpRequest.prototype.open = function (...args) {
    try {
      if (isSend(args[1])) pending.add(this);
    } catch { /* idem */ }
    return origOpen.apply(this, /** @type {any} */ (args));
  };
  const origSend = XMLHttpRequest.prototype.send;
  /**
   * @this {XMLHttpRequest}
   * @param {Document | XMLHttpRequestBodyInit | null} [body]
   */
  XMLHttpRequest.prototype.send = function (body = null) {
    try {
      if (pending.has(this)) signal();
    } catch { /* idem */ }
    return origSend.call(this, body);
  };
})();
