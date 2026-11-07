import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRuns, paceComparison } from '../src/lib/trend.js';

const H = 3600 * 1000;
const NOW = 1_700_000_000_000;
const at = (hoursAgo, v) => ({ t: NOW - hoursAgo * H, v });

test('splitRuns corta la serie en cada reinicio', () => {
  const runs = splitRuns([at(10, 40), at(9, 70), at(8, 5), at(7, 20)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].map((p) => p.v), [40, 70]);
  assert.deepEqual(runs[1].map((p) => p.v), [5, 20]);
});

test('splitRuns no confunde el ruido de redondeo con un reinicio', () => {
  // Una caída de un punto es redondeo, no un reset.
  const runs = splitRuns([at(4, 50), at(3, 49), at(2, 51)]);
  assert.equal(runs.length, 1);
});

test('splitRuns ordena y descarta puntos corruptos', () => {
  const runs = splitRuns([at(2, 30), { t: NaN, v: 9 }, at(4, 10), null]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((p) => p.v), [10, 30]);
});

test('sin una ventana anterior no hay comparación', () => {
  assert.equal(paceComparison([at(5, 10), at(3, 20), at(1, 30)], NOW), null);
});

test('compara el consumo a la misma altura de la ventana', () => {
  // Ventana anterior: 10 h de duración, consumió 20 puntos en sus primeras 5 h.
  // Ventana actual: 5 h de vida, consumió 30 puntos. Va 50 % más rápido.
  const pts = [
    at(15, 0), at(10, 20), at(5.5, 40),   // ventana anterior (0 → 40)
    at(5, 0), at(2.5, 15), at(0.5, 30),   // ventana actual (0 → 30)
  ];
  const c = paceComparison(pts, NOW);
  assert.ok(c, 'debería comparar');
  assert.equal(c.currentConsumed, 30);
  assert.equal(c.previousConsumed, 20);
  assert.equal(c.changePct, 50);
});

test('un ritmo más lento da un cambio negativo', () => {
  const pts = [
    at(15, 0), at(10, 40), at(5.5, 60),
    at(5, 0), at(2.5, 10), at(0.5, 20),
  ];
  const c = paceComparison(pts, NOW);
  assert.equal(c.previousConsumed, 40);
  assert.equal(c.currentConsumed, 20);
  assert.equal(c.changePct, -50);
});

test('si la ventana anterior no llegó a esta altura no se compara', () => {
  // La anterior duró 2 h; la actual ya tiene 5 h. Comparar sería inventar.
  const pts = [at(8, 0), at(7, 10), at(6, 20), at(5, 0), at(2, 15), at(0.5, 30)];
  assert.equal(paceComparison(pts, NOW), null);
});

test('si la ventana anterior no consumió nada no hay porcentaje de cambio', () => {
  // La anterior se quedó quieta en 5 %: dividir por cero no informa nada.
  const pts = [at(15, 5), at(10, 5), at(5.5, 5), at(5, 0), at(2, 10), at(0.5, 20)];
  assert.equal(paceComparison(pts, NOW), null);
});

test('una ventana demasiado joven no se compara todavía', () => {
  // 20 minutos de vida: cualquier cifra sería ruido.
  const pts = [at(15, 0), at(10, 20), at(5, 40), at(0.33, 0), at(0.2, 3), at(0.1, 5)];
  assert.equal(paceComparison(pts, NOW), null);
});

test('toma la ventana anterior, no la primera de la serie', () => {
  const pts = [
    at(30, 0), at(29, 90),                // ventana vieja: consumió 90
    at(20, 0), at(15, 25), at(10, 50),    // ventana anterior: 25 en sus primeras 5 h
    at(5, 0), at(2.5, 12), at(0.5, 20),   // ventana actual: 20 en 5 h
  ];
  const c = paceComparison(pts, NOW);
  assert.ok(c);
  assert.equal(c.previousConsumed, 25, 'tiene que ser la penúltima, no la primera');
  assert.equal(c.changePct, -20);
});

test('una serie vacía no rompe', () => {
  assert.equal(paceComparison([], NOW), null);
  assert.equal(paceComparison(null, NOW), null);
  assert.deepEqual(splitRuns(null), []);
});

test('una ventana anterior que termina poco antes igual se compara', () => {
  // Caso que apareció en el preview: la serie real tiene huecos, así que la
  // ventana anterior casi nunca llega al minuto exacto de la edad actual.
  // Exigir una cobertura exacta hacía que la comparación no saliera nunca.
  const pts = [
    at(20, 0), at(15, 20), at(10.2, 40),  // anterior: 9,8 h de duración
    at(10, 0), at(5, 15), at(0.2, 30),    // actual: 10 h de edad
  ];
  const c = paceComparison(pts, NOW);
  assert.ok(c, 'una diferencia de minutos no puede anular la comparación');
  assert.equal(c.previousConsumed, 40);
  assert.equal(c.currentConsumed, 30);
});

test('una ventana anterior mucho más corta no sirve de referencia', () => {
  // Duró 2 h y la actual ya lleva 10: el tramo común no describe el presente.
  const pts = [at(20, 0), at(19, 10), at(18, 20), at(10, 0), at(5, 15), at(0.2, 30)];
  assert.equal(paceComparison(pts, NOW), null);
});
