// @ts-check
// Comparación de ritmo entre ventanas: "¿voy más rápido que la vuelta pasada?".
//
// Lo que NO se puede hacer es comparar el consumo total de la ventana en curso
// (incompleta) con el de la anterior (completa): daría siempre "vas más lento".
// La comparación honesta es a la misma altura de la ventana — cuánto habías
// consumido la vez pasada cuando llevabas el mismo tiempo que ahora.
//
// Módulo puro, como forecast.js, y con la misma regla: ante la duda, null.

import { RESET_DROP } from './forecast.js';

const MIN_ELAPSED_MS = 3600 * 1000; // una ventana más joven que esto no dice nada

/**
 * @typedef {{ t: number, v: number }} Point
 * @typedef {Object} Pace
 * @property {number} currentConsumed   puntos de % consumidos en la ventana actual
 * @property {number} previousConsumed  los que llevaba la anterior a esta misma altura
 * @property {number} changePct         variación relativa, redondeada (+ más rápido)
 * @property {number} elapsedMs         tiempo transcurrido de la ventana actual
 */

/**
 * Parte la serie en ventanas, cortando donde el % cae (un reinicio).
 * @param {Point[]|null|undefined} points
 * @returns {Point[][]}
 */
export function splitRuns(points) {
  if (!Array.isArray(points)) return [];
  const pts = points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return [];

  /** @type {Point[][]} */
  const runs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v < pts[i - 1].v - RESET_DROP) runs.push([pts[i]]);
    else runs[runs.length - 1].push(pts[i]);
  }
  return runs;
}

/**
 * Valor de la serie en un instante: el último punto que no lo pasa.
 * No interpola a propósito — con la serie plegada a una muestra por hora,
 * interpolar daría una precisión que los datos no tienen.
 * @param {Point[]} run
 * @param {number} t
 * @returns {Point|null}
 */
function valueAt(run, t) {
  let found = null;
  for (const p of run) {
    if (p.t > t) break;
    found = p;
  }
  return found;
}

/**
 * Ritmo de la ventana actual contra el de la anterior, a la misma altura.
 * @param {Point[]|null|undefined} points
 * @param {number} [now]
 * @returns {Pace|null}
 */
export function paceComparison(points, now = Date.now()) {
  const runs = splitRuns(points);
  if (runs.length < 2) return null;

  const current = runs[runs.length - 1];
  const previous = runs[runs.length - 2];

  // Se compara el tramo que las dos ventanas alcanzaron. Pedir que la anterior
  // cubra exactamente la edad de la actual suena más riguroso, pero en la
  // práctica no se cumple nunca: la serie tiene huecos cada vez que el
  // navegador estuvo cerrado, así que la ventana anterior casi siempre termina
  // unos minutos antes y la comparación no aparecería jamás.
  const elapsed = now - current[0].t;
  const prevSpan = previous[previous.length - 1].t - previous[0].t;
  const common = Math.min(elapsed, prevSpan);
  if (!(common >= MIN_ELAPSED_MS)) return null;

  // Pero si la anterior es mucho más corta, el tramo común ya no describe el
  // estado actual: comparar las primeras dos horas cuando la ventana lleva
  // ochenta no informa nada.
  if (common < elapsed / 2) return null;

  const currentMark = valueAt(current, current[0].t + common);
  const previousMark = valueAt(previous, previous[0].t + common);
  if (!currentMark || !previousMark) return null;

  const currentConsumed = currentMark.v - current[0].v;
  const previousConsumed = previousMark.v - previous[0].v;
  if (previousConsumed <= 0) return null;

  return {
    currentConsumed,
    previousConsumed,
    changePct: Math.round(((currentConsumed - previousConsumed) / previousConsumed) * 100),
    elapsedMs: common,
  };
}
