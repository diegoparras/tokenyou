import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// El adapter localiza etiquetas con chrome.i18n; fuera del navegador devolvemos
// la clave (con su argumento) para poder afirmar sobre ella.
globalThis.chrome = {
  i18n: { getMessage: (key, args) => (args && args.length ? `${key}:${args[0]}` : key) },
};
const { parseUsage } = await import('../src/adapters/claude.js');

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('plan gratuito: responde 200 con todo en null y no es un fallo nuestro', () => {
  // Payload real de una cuenta gratuita (2026-10): limits vacío, todo null.
  assert.throws(
    () => parseUsage(fixture('claude-usage-free')),
    { name: 'UnsupportedPlanError' },
    'debe distinguirse de un error de parseo: la API respondió bien',
  );
});

test('una respuesta irreconocible sí es un fallo de parseo', () => {
  assert.throws(() => parseUsage({}), { name: 'ParseError' });
  assert.throws(() => parseUsage({ algo: 'raro' }), { name: 'ParseError' });
  assert.throws(() => parseUsage(null), { name: 'ParseError' });
});

test('plan pago: arma un medidor por límite del array limits[]', () => {
  const meters = parseUsage({
    limits: [
      { kind: 'session', percent: 33.4, resets_at: '2026-10-05T18:00:00Z' },
      { kind: 'weekly_all', percent: 32, resets_at: '2026-10-08T00:00:00Z' },
      {
        kind: 'weekly_scoped',
        percent: 64,
        resets_at: '2026-10-08T00:00:00Z',
        scope: { model: { display_name: 'Fable' } },
      },
    ],
  });
  assert.equal(meters.length, 3);
  assert.deepEqual(meters.map((m) => m.label), ['meterSession', 'meterWeekAll', 'meterWeekModel:Fable']);
  assert.deepEqual(meters.map((m) => m.usedPct), [33, 32, 64]);
  assert.equal(meters[0].resetsAt, Date.parse('2026-10-05T18:00:00Z'));
});

test('cae a los campos legacy cuando limits[] viene vacío pero hay ventanas', () => {
  const meters = parseUsage({
    limits: [],
    five_hour: { utilization: 45, resets_at: '2026-10-05T18:00:00Z' },
    seven_day: { utilization: 12, resets_at: '2026-10-08T00:00:00Z' },
    seven_day_opus: null,
  });
  assert.deepEqual(meters.map((m) => m.id), ['five_hour', 'seven_day']);
  assert.deepEqual(meters.map((m) => m.usedPct), [45, 12]);
});

test('suma el uso extra solo cuando está habilitado', () => {
  const base = { limits: [{ kind: 'session', percent: 10, resets_at: null }] };
  const sin = parseUsage({ ...base, extra_usage: { is_enabled: false, utilization: 22 } });
  assert.equal(sin.length, 1);

  const con = parseUsage({
    ...base,
    extra_usage: {
      is_enabled: true, utilization: 22,
      used_credits: 2184, monthly_limit: 10000, currency: 'USD', decimal_places: 2,
    },
  });
  assert.equal(con.length, 2);
  assert.equal(con[1].id, 'extra_usage');
  assert.equal(con[1].usedPct, 22);
  assert.match(con[1].detail, /21[.,]84/);  // gastado, formateado según locale
  assert.match(con[1].detail, /78[.,]16/);  // restante
});

test('ignora límites sin porcentaje en vez de romper', () => {
  const meters = parseUsage({
    limits: [
      { kind: 'session', percent: 50, resets_at: null },
      { kind: 'weekly_all', percent: null },
      { kind: 'otro' },
    ],
  });
  assert.equal(meters.length, 1);
});
