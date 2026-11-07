import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPoints, FINE_RETAIN_MS, POINTS_RETAIN_MS } from '../src/lib/history.js';

const MIN = 60 * 1000;
const H = 3600 * 1000;
const D = 24 * H;
const NOW = 1_700_000_000_000;

const at = (msAgo, v) => ({ t: NOW - msAgo, v });
// Comienzo exacto de la hora epoch de hace `hoursAgo` horas. El plegado agrupa
// por hora epoch, así que los tests que lo ejercitan tienen que anclarse al
// borde: offsets en minutos sobre un instante cualquiera cruzan de hora.
const hourStart = (hoursAgo) => (Math.floor(NOW / H) - hoursAgo) * H;

test('las últimas 24 h conservan todos los puntos', () => {
  const pts = [at(10 * MIN, 10), at(5 * MIN, 11), at(1 * MIN, 12)];
  assert.deepEqual(compactPoints(pts, NOW).map((p) => p.v), [10, 11, 12]);
});

test('más allá de 24 h queda un punto por hora', () => {
  // Cuatro puntos dentro de la misma hora, hace tres días.
  const t0 = hourStart(72);
  const pts = [
    { t: t0, v: 40 }, { t: t0 + 10 * MIN, v: 41 },
    { t: t0 + 20 * MIN, v: 42 }, { t: t0 + 50 * MIN, v: 43 },
  ];
  assert.equal(compactPoints(pts, NOW).length, 1);
});

test('al plegar una hora se guarda su último punto, no el primero', () => {
  // El nivel al final de la hora es el que describe el estado del medidor.
  const t0 = hourStart(72);
  const pts = [{ t: t0, v: 40 }, { t: t0 + 50 * MIN, v: 43 }];
  const [p] = compactPoints(pts, NOW);
  assert.equal(p.v, 43);
  assert.equal(p.t, t0 + 50 * MIN);
});

test('horas distintas no se pisan entre sí', () => {
  const pts = [at(5 * D, 10), at(4 * D, 20), at(3 * D, 30)];
  assert.deepEqual(compactPoints(pts, NOW).map((p) => p.v), [10, 20, 30]);
});

test('los puntos más viejos que la retención se descartan', () => {
  const pts = [at(POINTS_RETAIN_MS + H, 5), at(2 * D, 50), at(MIN, 60)];
  assert.deepEqual(compactPoints(pts, NOW).map((p) => p.v), [50, 60]);
});

test('ordena por tiempo y descarta puntos corruptos', () => {
  const pts = [at(MIN, 30), { t: NaN, v: 1 }, at(10 * MIN, 20), null, { t: NOW, v: 'x' }];
  assert.deepEqual(compactPoints(pts, NOW).map((p) => p.v), [20, 30]);
});

test('el resultado siempre queda ordenado de más viejo a más nuevo', () => {
  const pts = [at(MIN, 90), at(10 * D, 10), at(3 * H, 70), at(5 * D, 30)];
  const out = compactPoints(pts, NOW);
  const times = out.map((p) => p.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('un reset sobrevive al plegado', () => {
  // Caída fuerte dentro de la zona plegada: debe seguir siendo visible,
  // porque forecast.js la usa para recortar la serie al tramo actual.
  const pts = [at(5 * D, 90), at(4 * D, 95), at(3 * D, 4), at(2 * D, 20)];
  const out = compactPoints(pts, NOW);
  const values = out.map((p) => p.v);
  assert.ok(values.some((v, i) => i > 0 && v < values[i - 1] - 2), `sin caída en ${values}`);
});

test('una serie larga de alta frecuencia se mantiene acotada', () => {
  // 31 días refrescando cada minuto: 44 640 puntos de entrada.
  const pts = [];
  for (let i = 31 * 24 * 60; i >= 0; i--) pts.push(at(i * MIN, i % 100));
  const out = compactPoints(pts, NOW);
  const fineHours = FINE_RETAIN_MS / H;
  const coarseHours = (POINTS_RETAIN_MS - FINE_RETAIN_MS) / H;
  // Resolución fina en las últimas 24 h + una por hora en el resto.
  assert.ok(out.length <= fineHours * 60 + coarseHours + 2, `${out.length} puntos`);
  assert.ok(out.length > coarseHours, `${out.length} puntos: se perdió demasiado`);
  // El punto más reciente nunca se pierde: es el valor actual del medidor.
  assert.equal(out[out.length - 1].t, NOW);
});

test('una serie vacía devuelve una serie vacía', () => {
  assert.deepEqual(compactPoints([], NOW), []);
  assert.deepEqual(compactPoints(null, NOW), []);
});
