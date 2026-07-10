// Mock de las APIs de Chrome para el preview de diseño (dev/preview.html).
// Solo para desarrollo: nunca se incluye en el paquete de la extensión.
(() => {
  // --- i18n: carga sincrónica del catálogo español ---
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/_locales/es/messages.json', false);
  xhr.send();
  const messages = JSON.parse(xhr.responseText);

  const now = Date.now();
  const H = 3600 * 1000;

  // --- fixtures: snapshots realistas ---
  const store = {
    'snap.claude': {
      platformId: 'claude',
      ok: true,
      plan: 'Max 20x',
      meters: [
        { id: 'session', label: 'Sesión (5 h)', usedPct: 33, resetsAt: now + 2 * H + 5 * 60000 },
        { id: 'weekly_all', label: 'Semana · todos los modelos', usedPct: 32, resetsAt: now + 3 * 24 * H },
        { id: 'weekly_scoped', label: 'Semana · Fable', usedPct: 64, resetsAt: now + 3 * 24 * H },
        { id: 'extra_usage', label: 'Uso extra (mes)', usedPct: 22, resetsAt: null, detail: 'US$ 21,84 / US$ 100,00' },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.chatgpt': {
      platformId: 'chatgpt',
      ok: true,
      plan: 'Plus',
      meters: [
        { id: 'primary', label: 'Ventana de 5 h', usedPct: 11, resetsAt: now + 4 * H },
        { id: 'secondary', label: 'Semanal', usedPct: 2, resetsAt: now + 6.9 * 24 * H },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.gemini': {
      platformId: 'gemini',
      ok: true,
      approx: true,
      meters: [
        { id: 'window5h', label: 'Ventana de 5 h', usedPct: null, resetsAt: null, used: 3 },
        { id: 'week', label: 'Semanal', usedPct: null, resetsAt: null, used: 27 },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.grok': {
      platformId: 'grok',
      ok: true,
      meters: [
        { id: 'default', label: 'Ventana de 4 h', usedPct: 90, resetsAt: null, remaining: 1, total: 10 },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.perplexity': {
      platformId: 'perplexity',
      ok: false,
      error: 'auth',
      meters: [],
      fetchedAt: now - 40 * 1000,
    },
    'custom.services': [
      {
        id: 'cursor',
        name: 'Cursor',
        origin: 'https://cursor.com/*',
        url: 'https://cursor.com/api/usage',
        method: 'GET',
        meters: [
          { id: 'premium', label: 'Premium requests', usedPath: 'gpt-4.numRequests', totalPath: 'gpt-4.maxRequestUsage' },
        ],
      },
    ],
    'snap.custom-cursor': {
      platformId: 'custom-cursor',
      ok: true,
      meters: [
        { id: 'premium', label: 'Premium requests', usedPct: 46, resetsAt: null, remaining: 268, total: 500 },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'prefs.hiddenMeters': [],
  };

  const changeListeners = [];
  const grantedOrigins = [
    'https://claude.ai/*',
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://grok.com/*',
    'https://www.perplexity.ai/*',
    'https://cursor.com/*',
  ];

  window.chrome = {
    i18n: {
      getMessage(key, args) {
        const entry = messages[key];
        if (!entry) return '';
        let text = entry.message;
        const list = Array.isArray(args) ? args : args !== undefined ? [args] : [];
        list.forEach((arg, i) => {
          text = text.split(`$${i + 1}`).join(String(arg));
        });
        return text;
      },
    },
    storage: {
      local: {
        async get(keys) {
          const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          changeListeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
          changeListeners.forEach((fn) => fn({}, 'local'));
        },
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } },
    },
    permissions: {
      async getAll() { return { origins: [...grantedOrigins], permissions: ['storage', 'alarms'] }; },
      async contains() { return true; },
      async request() { return true; },
      async remove() { return true; },
    },
    runtime: {
      async sendMessage() { return { ok: true }; },
      openOptionsPage() { window.open('/src/options/options.html', '_blank'); },
    },
  };
})();
