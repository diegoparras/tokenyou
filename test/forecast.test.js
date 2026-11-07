import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, currentRun, exhaustionWarning } from '../src/lib/forecast.js';

const H = 3600 * 1000;
const MIN = 60 * 1000;
const NOW = 1_700_000_000_000;

/** Serie lineal terminando justo antes de `NOW`. */
const at = (hoursAgo, v) => ({ t: NOW - hoursAgo * H, v });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('currentRun recorta la serie al tramo posterior al último reset', () => {
  const run = currentRun([at(4, 80), at(3, 90), at(2, 5), at(1, 15)]);
  assert.deepEqual(run.map((p) => p.v), [5, 15]);
});

test('currentRun ordena por tiempo y descarta puntos corruptos', () => {
  const run = currentRun([at(1, 20), at(3, 10), { t: NaN, v: 5 }, at(2, 15)]);
  assert.deepEqual(run.map((p) => p.v), [10, 15, 20]);
});

test('sin ventana de reinicio no hay proyección', () => {
  const pts = [at(2, 10), at(1.5, 15), at(1, 20), at(0.5, 25)];
  assert.equal(forecast(pts, { usedPct: 30, resetsAt: null, now: NOW }), null);
});

test('una ventana ya vencida no se proyecta', () => {
  const pts = [at(2, 10), at(1.5, 15), at(1, 20), at(0.5, 25)];
  assert.equal(forecast(pts, { usedPct: 30, resetsAt: NOW - H, now: NOW }), null);
});

test('con menos de tres puntos no hay proyección', () => {
  assert.equal(forecast([at(1, 20)], { usedPct: 30, resetsAt: NOW + 2 * H, now: NOW }), null);
});

test('ventana corta: menos de 45 min de datos no alcanza', () => {
  const pts = [at(0.5, 20), at(0.4, 22), at(0.2, 26)];
  assert.equal(forecast(pts, { usedPct: 30, resetsAt: NOW + 2 * H, now: NOW }), null);
});

test('consumo plano no produce proyección', () => {
  const pts = [at(2, 50), at(1.5, 50), at(1, 50), at(0.5, 50)];
  assert.equal(forecast(pts, { usedPct: 50, resetsAt: NOW + 2 * H, now: NOW }), null);
});

test('ventana de 5 h: proyecta al ritmo de la serie y no se agota', () => {
  const pts = [at(2, 10), at(1.5, 15), at(1, 20), at(0.5, 25)];
  const fc = forecast(pts, { usedPct: 30, resetsAt: NOW + 2 * H, now: NOW });
  assert.ok(fc);
  near(fc.ratePerHour, 10);
  assert.equal(fc.projectedPct, 50); // 30 + 10 %/h × 2 h
  assert.equal(fc.exhaustsAt, null);
});

test('cuando la proyección pasa 100 informa cuándo se agota', () => {
  const pts = [at(2, 40), at(1.5, 45), at(1, 50), at(0.5, 55)];
  const fc = forecast(pts, { usedPct: 60, resetsAt: NOW + 5 * H, now: NOW });
  assert.ok(fc);
  near(fc.ratePerHour, 10);
  assert.equal(fc.projectedPct, 110);          // 60 + 10 %/h × 5 h
  assert.equal(fc.exhaustsAt, NOW + 4 * H);    // (100 − 60) / 10 %/h
});

test('un reset en el medio no aplana la pendiente', () => {
  const pts = [at(4, 80), at(3, 90), at(2, 5), at(1, 15)];
  const fc = forecast(pts, { usedPct: 25, resetsAt: NOW + 3 * H, now: NOW });
  assert.ok(fc);
  near(fc.ratePerHour, 10);      // usa 5 → 15 → 25, no el salto de 90 a 5
  assert.equal(fc.projectedPct, 55);
});

test('ventana mensual: 2 h de datos no bastan para extrapolar 30 días', () => {
  const pts = [at(2, 4), at(1.5, 5), at(1, 6), at(0.5, 7)];
  assert.equal(forecast(pts, { usedPct: 8, resetsAt: NOW + 30 * 24 * H, now: NOW }), null);
});

test('ventana mensual: con 8 h de datos sí proyecta', () => {
  const pts = [at(8, 2), at(6, 4), at(4, 6), at(2, 8)];
  const fc = forecast(pts, { usedPct: 10, resetsAt: NOW + 30 * 24 * H, now: NOW });
  assert.ok(fc);
  near(fc.ratePerHour, 1);
  assert.equal(fc.projectedPct, 730);           // 10 + 1 %/h × 720 h
  assert.equal(fc.exhaustsAt, NOW + 90 * H);    // (100 − 10) / 1 %/h
});

test('si el medidor ya está al 100 se agota ahora', () => {
  const pts = [at(2, 80), at(1.5, 85), at(1, 90), at(0.5, 95)];
  const fc = forecast(pts, { usedPct: 100, resetsAt: NOW + 2 * H, now: NOW });
  assert.ok(fc);
  assert.equal(fc.exhaustsAt, NOW);
});

test('un reset recién ocurrido deja demasiado poco historial', () => {
  // La serie venía alta y el snapshot actual cayó: arranca una ventana nueva.
  const pts = [at(2, 70), at(1.5, 80), at(1, 90), at(0.5, 95)];
  assert.equal(forecast(pts, { usedPct: 3, resetsAt: NOW + 5 * H, now: NOW }), null);
});

test('los puntos con fecha futura se descartan', () => {
  const pts = [at(2, 10), at(1.5, 15), at(1, 20), at(0.5, 25), at(-5, 90)];
  const fc = forecast(pts, { usedPct: 30, resetsAt: NOW + 2 * H, now: NOW });
  assert.ok(fc);
  assert.equal(fc.projectedPct, 50);
});

test('tolera minutos, no solo horas, en el span mínimo', () => {
  const pts = [
    { t: NOW - 50 * MIN, v: 10 },
    { t: NOW - 30 * MIN, v: 14 },
    { t: NOW - 10 * MIN, v: 18 },
  ];
  const fc = forecast(pts, { usedPct: 20, resetsAt: NOW + H, now: NOW });
  assert.ok(fc, 'con 50 min de datos y ventana corta debería proyectar');
});

// --- Aviso de agotamiento -----------------------------------------------
// Decide si una proyección merece una notificación. El riesgo acá es el falso
// positivo: avisar "se te agota" por ruido de redondeo quema la confianza en
// el aviso y el usuario lo apaga.

test('aviso: proyección que pasa 100 con holgura y margen de tiempo', () => {
  // 8 %/h sostenido, 84 % ahora y 6 h hasta el reinicio: proyecta 132 % y se
  // agota a las dos horas. Caso de libro.
  const pts = [at(8, 20), at(6, 36), at(4, 52), at(2, 68)];
  const w = exhaustionWarning(pts, { usedPct: 84, resetsAt: NOW + 6 * H, now: NOW });
  assert.ok(w, 'debería avisar');
  assert.ok(w.exhaustsAt > NOW + MIN, 'el agotamiento es futuro');
  assert.ok(w.exhaustsAt < NOW + 6 * H, 'y cae antes del reinicio');
});

test('aviso: un 101% proyectado es empate técnico, no se avisa', () => {
  // Pendiente mínima: cruza el 100 por decimales. Avisar acá sería ruido.
  const pts = [at(8, 96), at(6, 96), at(4, 97), at(2, 97)];
  const w = exhaustionWarning(pts, { usedPct: 97, resetsAt: NOW + 6 * H, now: NOW });
  assert.equal(w, null);
});

test('aviso: si la proyección no llega a 100 no hay nada que avisar', () => {
  const pts = [at(8, 10), at(6, 14), at(4, 18), at(2, 22)];
  assert.equal(exhaustionWarning(pts, { usedPct: 26, resetsAt: NOW + 4 * H, now: NOW }), null);
});

test('aviso: un medidor ya agotado no genera aviso de proyección', () => {
  // Ya está al 100: el aviso de umbral es el que corresponde, no este.
  const pts = [at(8, 70), at(6, 80), at(4, 90), at(2, 97)];
  assert.equal(exhaustionWarning(pts, { usedPct: 100, resetsAt: NOW + 4 * H, now: NOW }), null);
});

test('aviso: sin proyección posible no hay aviso', () => {
  assert.equal(exhaustionWarning([], { usedPct: 50, resetsAt: NOW + 4 * H, now: NOW }), null);
  assert.equal(exhaustionWarning([at(2, 10)], { usedPct: 50, resetsAt: null, now: NOW }), null);
});

test('aviso: un agotamiento inminente no se avisa, llega tarde', () => {
  // Se agota en pocos minutos: el aviso no le sirve a nadie.
  const pts = [at(8, 30), at(6, 50), at(4, 70), at(2, 90)];
  const w = exhaustionWarning(pts, { usedPct: 99.5, resetsAt: NOW + 4 * H, now: NOW });
  assert.equal(w, null);
});
