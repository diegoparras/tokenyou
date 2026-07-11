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
      account: 'diegoparras@gmail.com',
      meters: [
        { id: 'primary', label: 'Ventana de 5 h', usedPct: 11, resetsAt: now + 4 * H },
        { id: 'secondary', label: 'Semanal', usedPct: 2, resetsAt: now + 6.9 * 24 * H },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.gemini': {
      platformId: 'gemini',
      ok: true,
      meters: [
        { id: 'session', label: 'Sesión (5 h)', usedPct: 0, resetsAt: now + 4 * H },
        { id: 'weekly', label: 'Semanal', usedPct: 1, resetsAt: now + 4 * 24 * H },
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
    'prefs.notify': { reset: true, threshold: 85 },
  };

  // Series sintéticas de historial para ver los sparklines en el preview.
  const mkSeries = (base, up, resetAt) => {
    let v = base; const out = [];
    for (let i = 0; i < 30; i++) {
      v += up * (0.5 + ((i * 7) % 5) / 4);
      if (resetAt && i === resetAt) v = base * 0.3;
      v = Math.max(2, Math.min(100, v));
      out.push({ t: now - (30 - i) * 30 * 60000, v: Math.round(v) });
    }
    return out;
  };
  store['hist.pts.claude/session'] = mkSeries(8, 1.1, 16);
  store['hist.pts.claude/weekly_all'] = mkSeries(20, 1.0);
  store['hist.pts.claude/weekly_scoped'] = mkSeries(24, 1.2);
  store['hist.pts.claude/extra_usage'] = mkSeries(10, 0.5);
  store['hist.pts.chatgpt/primary'] = mkSeries(5, 0.4, 22);
  store['hist.pts.chatgpt/secondary'] = mkSeries(1, 0.1);
  store['hist.pts.gemini/session'] = mkSeries(1, 0.05);
  store['hist.pts.gemini/weekly'] = mkSeries(1, 0.1);
  store['hist.pts.grok/default'] = mkSeries(40, 2.0);
  store['hist.pts.custom-cursor/premium'] = mkSeries(20, 1.5);

  // Buckets de actividad sintéticos (para la vista de historial / heatmap).
  const mkActivity = (seed) => {
    const act = {};
    const nowHour = Math.floor(now / 3600000);
    for (let h = 0; h < 24 * 30; h++) {
      const hourKey = nowHour - h;
      const date = new Date(hourKey * 3600000);
      const hod = date.getHours();
      const dow = date.getDay();
      const work = hod >= 12 && hod <= 20 && dow >= 1 && dow <= 5 ? 1 : hod >= 8 && hod <= 22 && dow >= 1 && dow <= 5 ? 0.5 : 0.15;
      const wk = dow === 0 || dow === 6 ? 0.35 : 1;
      const noise = ((h * 13 + seed * 7) % 10) / 10;
      const v = Math.max(0, work * wk * (0.4 + noise) * 6 - (hod < 7 ? 3 : 0));
      if (v > 0.3) act[hourKey] = Math.round(v * 10) / 10;
    }
    return act;
  };
  store['hist.act.claude/weekly_all'] = mkActivity(1);
  store['hist.act.claude/session'] = mkActivity(2);
  store['hist.act.claude/weekly_scoped'] = mkActivity(3);
  store['hist.act.chatgpt/primary'] = mkActivity(4);
  store['hist.act.grok/default'] = mkActivity(5);

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
      // Reproduce el algoritmo real: $NOMBRE$ en el mensaje → placeholders[nombre].content ($1..$9 → args)
      getMessage(key, args) {
        const entry = messages[key];
        if (!entry) return '';
        let text = entry.message;
        const list = Array.isArray(args) ? args : args !== undefined ? [args] : [];
        for (const [name, ph] of Object.entries(entry.placeholders || {})) {
          const value = String(ph.content || '').replace(/\$(\d)/g, (_, d) => String(list[d - 1] ?? ''));
          text = text.replace(new RegExp('\\$' + name + '\\$', 'gi'), value);
        }
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
      getURL(p) { return '/' + p.replace(/^\//, ''); },
    },
  };
})();
