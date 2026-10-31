// Mock de las APIs de Chrome para el preview de diseño (dev/preview.html).
// Solo para desarrollo: nunca se incluye en el paquete de la extensión.
(() => {
  // --- i18n: carga sincrónica del catálogo (es por defecto, en con ?lang=en) ---
  const lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es';
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/_locales/' + lang + '/messages.json', false);
  xhr.send();
  const messages = JSON.parse(xhr.responseText);

  // Traducción de las etiquetas de los fixtures cuando el preview corre en inglés.
  const EN = {
    'Sesión (5 h)': 'Session (5 h)',
    'Semana · todos los modelos': 'Week · all models',
    'Semana · Fable': 'Week · Fable',
    'Uso extra (mes)': 'Extra usage (month)',
    'US$ 21,84 · quedan US$ 78,16': 'US$ 21.84 · US$ 78.16 left',
    'Ventana de 5 h': '5 h window',
    'Semanal': 'Weekly',
    'Solicitudes premium': 'Premium requests',
    'Puntos de cómputo': 'Compute points',
  };
  const tr = (s) => (lang === 'en' && s in EN ? EN[s] : s);

  const now = Date.now();
  const H = 3600 * 1000;

  // --- fixtures: snapshots realistas ---
  const store = {
    'snap.claude': {
      platformId: 'claude',
      ok: true,
      plan: 'Ultra',
      meters: [
        { id: 'session', label: 'Sesión (5 h)', usedPct: 33, resetsAt: now + 2 * H + 5 * 60000 },
        { id: 'weekly_all', label: 'Semana · todos los modelos', usedPct: 32, resetsAt: now + 3 * 24 * H },
        { id: 'weekly_scoped', label: 'Semana · Fable', usedPct: 64, resetsAt: now + 3 * 24 * H },
        { id: 'extra_usage', label: 'Uso extra (mes)', usedPct: 22, resetsAt: null, detail: 'US$ 21,84 · quedan US$ 78,16' },
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
        { id: 'weekly', label: 'Semanal', usedPct: 90, resetsAt: now + 3 * 24 * H, detail: 'Apps 62% · Chat 28%' },
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
    'snap.copilot': {
      platformId: 'copilot',
      ok: true,
      meters: [
        { id: 'premium', label: 'Solicitudes premium', usedPct: 0, resetsAt: null, remaining: 7000, total: 7000 },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'snap.abacus': {
      platformId: 'abacus',
      ok: true,
      plan: 'Pro',
      meters: [
        { id: 'compute', label: 'Puntos de cómputo', usedPct: 64, resetsAt: now + 11 * 24 * H, remaining: 14101, total: 39170 },
      ],
      fetchedAt: now - 40 * 1000,
    },
    'prefs.hiddenMeters': [],
    'prefs.notify': { reset: true, threshold: 85 },
    'prefs.pins': ['claude/session', 'chatgpt/primary', 'grok/weekly'],
    'prefs.collapsed': ['gemini', 'grok', 'perplexity', 'custom-cursor', 'abacus'],
    'prefs.order': [],
  };

  // En modo inglés, traducir labels/detail de los snapshots y servicios.
  if (lang === 'en') {
    for (const [k, v] of Object.entries(store)) {
      if (v && Array.isArray(v.meters)) {
        for (const m of v.meters) { if (m.label) m.label = tr(m.label); if (m.detail) m.detail = tr(m.detail); }
      }
    }
    for (const s of store['custom.services'] || []) {
      for (const m of s.meters || []) if (m.label) m.label = tr(m.label);
    }
  }

  // Series sintéticas de historial: alimentan los sparklines y la proyección.
  // Terminan en el mismo % que el snapshot (como hace recordSnapshot en producción);
  // si terminaran en otro valor, forecast.js leería la diferencia como un reset.
  // 30 puntos cada 30 min = 15 h de historial.
  const mkSeries = (end, resetAt) => {
    const n = 30;
    const out = [];
    for (let i = 0; i < n; i++) {
      let v;
      if (resetAt != null && i < resetAt) {
        v = 55 + (i / resetAt) * 35;            // ventana anterior, ya avanzada
      } else {
        const from = resetAt != null ? resetAt : 0;
        const span = n - 1 - from;
        const p = span > 0 ? (i - from) / span : 1;
        v = end * 0.3 + end * 0.7 * p;          // rampa hasta el valor actual
      }
      v += (((i * 7) % 5) - 2) * 0.3;           // ruido leve
      out.push({ t: now - (n - i) * 30 * 60000, v: Math.max(0, Math.min(100, Math.round(v))) });
    }
    return out;
  };
  store['hist.pts.claude/session'] = mkSeries(33);
  store['hist.pts.claude/weekly_all'] = mkSeries(32);
  store['hist.pts.claude/weekly_scoped'] = mkSeries(64);
  store['hist.pts.claude/extra_usage'] = mkSeries(22);
  store['hist.pts.chatgpt/primary'] = mkSeries(11);
  store['hist.pts.chatgpt/secondary'] = mkSeries(2);
  store['hist.pts.gemini/session'] = mkSeries(0);
  store['hist.pts.gemini/weekly'] = mkSeries(1);
  store['hist.pts.grok/weekly'] = mkSeries(90);
  store['hist.pts.custom-cursor/premium'] = mkSeries(46);

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
  store['hist.act.grok/weekly'] = mkActivity(5);

  const changeListeners = [];
  const grantedOrigins = [
    'https://claude.ai/*',
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://grok.com/*',
    'https://www.perplexity.ai/*',
    'https://cursor.com/*',
    'https://github.com/*',
    'https://apps.abacus.ai/*',
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
      async contains(q) { return (q?.origins || []).every((o) => grantedOrigins.includes(o)); },
      async request(q) {
        for (const o of q?.origins || []) if (!grantedOrigins.includes(o)) grantedOrigins.push(o);
        return true;
      },
      async remove(q) {
        for (const o of q?.origins || []) {
          const i = grantedOrigins.indexOf(o);
          if (i >= 0) grantedOrigins.splice(i, 1);
        }
        return true;
      },
    },
    runtime: {
      async sendMessage() { return { ok: true }; },
      openOptionsPage() { window.open('/src/options/options.html', '_blank'); },
      getURL(p) { return '/' + p.replace(/^\//, ''); },
    },
  };
})();
