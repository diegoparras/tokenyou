// Cobertura de parseo de los cinco adaptadores que faltaban.
//
// Los dos bugs reales que aparecieron en producción —el 0 % de Grok y el falso
// error de Claude en cuentas gratuitas— fueron de parseo, no de red. Estos
// tests fijan la forma de cada respuesta para que un cambio de API rompa acá
// en vez de mostrar un número equivocado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const messages = JSON.parse(
  readFileSync(new URL('../_locales/es/messages.json', import.meta.url), 'utf8'),
);
globalThis.chrome = {
  i18n: {
    getMessage: (key, args) => {
      const entry = messages[key];
      if (!entry) return key;
      let text = entry.message;
      const list = Array.isArray(args) ? args : args !== undefined ? [args] : [];
      for (const [name, ph] of Object.entries(entry.placeholders || {})) {
        const value = String(ph.content || '').replace(/\$(\d)/g, (_, d) => String(list[d - 1] ?? ''));
        text = text.replace(new RegExp('\\$' + name + '\\$', 'gi'), value);
      }
      return text;
    },
  },
};

const json = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const text = (name) =>
  readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');

const { parseUsage: chatgptUsage } = await import('../src/adapters/chatgpt.js');
const { parseUsage: geminiUsage } = await import('../src/adapters/gemini.js');
const { parseLimits } = await import('../src/adapters/perplexity.js');
const { parseCard, customerIdFrom } = await import('../src/adapters/copilot.js');
const { parseComputePoints, parseBilling } = await import('../src/adapters/abacus.js');

const throwsParse = (fn) => assert.throws(fn, (e) => e.name === 'ParseError');

// ─────────────────────────── ChatGPT ───────────────────────────

test('chatgpt free: la ventana de 30 días se etiqueta como mensual', () => {
  // El dato que descubrimos en vivo: en free la cuota es mensual, no semanal.
  const { meters, plan } = chatgptUsage(json('chatgpt-usage-free'));
  assert.equal(meters.length, 1);
  assert.equal(meters[0].label, 'Mensual');
  assert.equal(meters[0].usedPct, 42);
  assert.equal(plan, 'Free');
});

test('chatgpt free: secondary_window en null no genera un medidor fantasma', () => {
  const { meters } = chatgptUsage(json('chatgpt-usage-free'));
  assert.ok(!meters.some((m) => m.id === 'secondary'));
});

test('chatgpt plus: ventana de 5 h más la semanal', () => {
  const { meters, plan, account } = chatgptUsage(json('chatgpt-usage-plus'));
  assert.deepEqual(meters.map((m) => m.id), ['primary', 'secondary']);
  assert.equal(meters[0].label, 'Ventana de 5 h');
  assert.equal(meters[1].label, 'Semanal');
  assert.equal(plan, 'Plus');
  assert.equal(account, 'persona@example.com');
});

test('chatgpt: el reset llega en segundos y se guarda en milisegundos', () => {
  const { meters } = chatgptUsage(json('chatgpt-usage-plus'));
  assert.equal(meters[0].resetsAt, 1762000000 * 1000);
});

test('chatgpt: un reset ausente deja el medidor sin ventana, no lo rompe', () => {
  const { meters } = chatgptUsage({
    rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000 } },
  });
  assert.equal(meters[0].resetsAt, null);
});

test('chatgpt: sin porcentaje en ninguna ventana es un fallo de parseo', () => {
  throwsParse(() => chatgptUsage({ rate_limit: { primary_window: {} } }));
  throwsParse(() => chatgptUsage({}));
  throwsParse(() => chatgptUsage(null));
});

// ─────────────────────────── Gemini ───────────────────────────

test('gemini: lee las dos ventanas de la respuesta batchexecute', () => {
  const meters = geminiUsage(text('gemini-usage'));
  assert.deepEqual(meters.map((m) => m.id), ['session', 'weekly']);
  assert.equal(meters[0].usedPct, 33);
  assert.equal(meters[1].usedPct, 7);
  assert.equal(meters[0].resetsAt, 1762000000 * 1000);
});

test('gemini: la fracción 0..1 se convierte en porcentaje acotado', () => {
  const inner = JSON.stringify([null, [[0, 1.4, 1, [[1, 0]]], [0, -0.2, 2, [[1, 0]]]]]);
  const meters = geminiUsage(JSON.stringify([['wrb.fr', 'jSf9Qc', inner]]));
  assert.equal(meters[0].usedPct, 100);
  assert.equal(meters[1].usedPct, 0);
});

test('gemini: un tipo de ventana desconocido no se descarta ni se miente', () => {
  const inner = JSON.stringify([null, [[0, 0.5, 7, [[1, 0]]]]]);
  const meters = geminiUsage(JSON.stringify([['wrb.fr', 'jSf9Qc', inner]]));
  assert.equal(meters[0].id, 'window-7');
});

test('gemini: una respuesta sin la línea del RPC devuelve vacío', () => {
  assert.deepEqual(geminiUsage(")]}'\n\n[[\"di\",1]]"), []);
  assert.deepEqual(geminiUsage(''), []);
});

test('gemini: JSON corrupto devuelve vacío en vez de explotar', () => {
  assert.deepEqual(geminiUsage('[["wrb.fr","jSf9Qc","{roto"]]'), []);
});

// ───────────────────────── Perplexity ─────────────────────────

test('perplexity: un medidor por cada contador restante', () => {
  const meters = parseLimits(json('perplexity-limits'));
  assert.deepEqual(meters.map((m) => m.id), [
    'remaining_pro', 'remaining_research', 'remaining_agentic_research', 'remaining_labs',
  ]);
  assert.equal(meters[0].remaining, 287);
});

test('perplexity: sin totales no hay porcentaje, y eso es correcto', () => {
  // La API no publica el límite, solo lo que queda: inventar un % sería mentir.
  for (const m of parseLimits(json('perplexity-limits'))) {
    assert.equal(m.usedPct, null);
    assert.equal(m.total, null);
  }
});

test('perplexity: un cero restante es un dato válido, no un campo ausente', () => {
  const meters = parseLimits({ remaining_pro: 0 });
  assert.equal(meters.length, 1);
  assert.equal(meters[0].remaining, 0);
});

test('perplexity: una respuesta sin ningún contador es un fallo de parseo', () => {
  throwsParse(() => parseLimits({ foo: 'bar' }));
  throwsParse(() => parseLimits(null));
});

// ────────────────────────── Copilot ──────────────────────────

test('copilot: el customer id sale de la respuesta, no hardcodeado', () => {
  assert.equal(customerIdFrom(json('copilot-billing')), '1234567');
});

test('copilot: sin customer id es un fallo de parseo', () => {
  throwsParse(() => customerIdFrom({ payload: { customer: {} } }));
  throwsParse(() => customerIdFrom(null));
});

test('copilot: calcula el porcentaje sobre las solicitudes premium', () => {
  const [m] = parseCard(json('copilot-card'));
  assert.equal(m.total, 1500);
  assert.equal(m.remaining, 1128); // 1500 − 372,5 redondeado
  assert.equal(m.usedPct, 25);
});

test('copilot: una cuenta sin consumo da 0 %, no un error', () => {
  const [m] = parseCard({ userPremiumRequestEntitlement: 7000, netQuantity: 0 });
  assert.equal(m.usedPct, 0);
  assert.equal(m.remaining, 7000);
});

test('copilot: netQuantity ausente se cuenta como cero consumido', () => {
  const [m] = parseCard({ userPremiumRequestEntitlement: 300 });
  assert.equal(m.usedPct, 0);
});

test('copilot: un entitlement de cero no divide por cero', () => {
  const [m] = parseCard({ userPremiumRequestEntitlement: 0, netQuantity: 0 });
  assert.equal(m.usedPct, null);
});

test('copilot: pasarse del límite se corta en 100 %', () => {
  const [m] = parseCard({ userPremiumRequestEntitlement: 100, netQuantity: 150 });
  assert.equal(m.usedPct, 100);
});

test('copilot: sin entitlement es un fallo de parseo', () => {
  throwsParse(() => parseCard({ netQuantity: 5 }));
  throwsParse(() => parseCard(null));
});

// ─────────────────────────── Abacus ───────────────────────────

test('abacus: convierte puntos restantes en porcentaje usado', () => {
  const [m] = parseComputePoints(json('abacus-compute'));
  assert.equal(m.total, 39170);
  assert.equal(m.remaining, 14101);
  assert.equal(m.usedPct, 64); // 1 − 14101/39170
});

test('abacus: el reset del billing llega al medidor', () => {
  const { resetsAt, plan } = parseBilling(json('abacus-billing'));
  const [m] = parseComputePoints(json('abacus-compute'), resetsAt);
  assert.equal(m.resetsAt, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(plan, 'Pro');
});

test('abacus: un billing ilegible no tira abajo el medidor', () => {
  // El reset es opcional: perderlo no puede costar el dato principal.
  assert.deepEqual(parseBilling({ result: { nextBillingDate: 'ni idea' } }),
    { resetsAt: null, plan: undefined });
  assert.deepEqual(parseBilling(null), { resetsAt: null, plan: undefined });
  const [m] = parseComputePoints(json('abacus-compute'), null);
  assert.equal(m.usedPct, 64);
});

test('abacus: una respuesta sin compute points es un fallo de parseo', () => {
  throwsParse(() => parseComputePoints({ result: { computePointsLeft: 5 } }));
  throwsParse(() => parseComputePoints({}));
  throwsParse(() => parseComputePoints(null));
});
