import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory, toJson, toCsv, fileStem } from '../src/lib/export.js';

const NOW = 1_700_000_000_000;

const store = {
  'hist.pts.claude/session': [{ t: NOW - 7200000, v: 10 }, { t: NOW, v: 30 }],
  'hist.pts.grok/weekly': [{ t: NOW, v: 90 }],
  'hist.act.claude/session': { 472150: 2.5 },
  'snap.claude': { platformId: 'claude', ok: true, plan: 'Ultra', meters: [], fetchedAt: NOW },
  'prefs.pins': ['claude/session'],
  'custom.services': [{ id: 'x', url: 'https://interno.example/api' }],
};

test('reúne las series y la actividad por medidor', () => {
  const out = collectHistory(store);
  assert.deepEqual(Object.keys(out).sort(), ['claude/session', 'grok/weekly']);
  assert.equal(out['claude/session'].platform, 'claude');
  assert.equal(out['claude/session'].meter, 'session');
  assert.equal(out['claude/session'].points.length, 2);
  assert.deepEqual(out['claude/session'].activity, { 472150: 2.5 });
});

test('un medidor con actividad pero sin serie también aparece', () => {
  const out = collectHistory({ 'hist.act.a/b': { 1: 1 } });
  assert.deepEqual(out['a/b'].points, []);
});

test('los ids con barras en el nombre del medidor no se parten mal', () => {
  const out = collectHistory({ 'hist.pts.custom-x/week/all': [{ t: NOW, v: 1 }] });
  const entry = out['custom-x/week/all'];
  assert.equal(entry.platform, 'custom-x');
  assert.equal(entry.meter, 'week/all');
});

test('el JSON exportado es válido y lleva metadatos', () => {
  const parsed = JSON.parse(toJson(store, { version: '0.4.0', now: NOW }));
  assert.equal(parsed.app, 'TokenYou');
  assert.equal(parsed.version, '0.4.0');
  assert.equal(parsed.exportedAt, new Date(NOW).toISOString());
  assert.ok(Array.isArray(parsed.meters));
  assert.equal(parsed.meters.length, 2);
});

test('el export no se lleva la configuración de servicios personalizados', () => {
  // Pueden contener URLs internas: no son datos de uso y no salen del navegador.
  const text = toJson(store, { version: '0.4.0', now: NOW });
  assert.ok(!text.includes('interno.example'), 'se filtró una URL de configuración');
  assert.ok(!text.includes('custom.services'));
});

test('el CSV tiene una fila por punto, con cabecera', () => {
  const rows = toCsv(store).trim().split('\n');
  assert.equal(rows[0], 'platform,meter,timestamp,iso,used_pct');
  assert.equal(rows.length, 4); // cabecera + 3 puntos
  assert.ok(rows[1].startsWith('claude,session,'));
});

test('el CSV ordena por medidor y después por tiempo', () => {
  const rows = toCsv(store).trim().split('\n').slice(1);
  const times = rows.filter((r) => r.startsWith('claude,')).map((r) => Number(r.split(',')[2]));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('el CSV entrecomilla los campos con coma o comilla', () => {
  const csv = toCsv({ 'hist.pts.p/un,medidor "raro"': [{ t: NOW, v: 5 }] });
  const row = csv.trim().split('\n')[1];
  assert.ok(row.includes('"un,medidor ""raro"""'), row);
});

test('sin historial el CSV es solo la cabecera y el JSON no rompe', () => {
  assert.equal(toCsv({}).trim(), 'platform,meter,timestamp,iso,used_pct');
  assert.deepEqual(JSON.parse(toJson({}, { version: '0.4.0', now: NOW })).meters, []);
});

test('el nombre de archivo lleva la fecha, sin caracteres raros', () => {
  assert.equal(fileStem(NOW), 'tokenyou-2023-11-14');
  assert.ok(/^[a-z0-9-]+$/.test(fileStem(NOW)));
});
