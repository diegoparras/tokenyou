// @ts-check
// Proyección de consumo: "a este ritmo, ¿llegás al reinicio de la ventana?"
//
// Módulo puro a propósito: entra la serie histórica del medidor y su reset,
// sale la proyección. No toca red, storage ni DOM — por eso se puede testear.
//
// La regla que gobierna todo el archivo: ante la duda, devolver null. Es
// preferible no mostrar nada a mostrar una proyección inventada.

const MIN_POINTS = 3;
export const RESET_DROP = 2;                        // caída de % que leemos como reinicio de ventana
const SHORT_HORIZON_MS = 12 * 3600 * 1000;
const MIN_SPAN_SHORT_MS = 45 * 60 * 1000;    // ventana corta (5 h): con 45 min de datos alcanza
const MIN_SPAN_LONG_MS = 6 * 3600 * 1000;    // ventana larga (semanal/mensual): pedimos 6 h

/**
 * @typedef {{ t: number, v: number }} Point
 * @typedef {{ projectedPct: number, ratePerHour: number, exhaustsAt: number|null }} Forecast
 */

/**
 * Recorta la serie al tramo posterior al último reinicio de la ventana.
 * Sin esto, el salto que deja un reset (de 90% a 5%) aplanaría la pendiente
 * y la proyección diría que no consumís nada.
 * @param {Point[]} points
 * @returns {Point[]}
 */
export function currentRun(points) {
  const pts = points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v < pts[i - 1].v - RESET_DROP) start = i;
  }
  return pts.slice(start);
}

/**
 * Pendiente por mínimos cuadrados, en % por milisegundo. Más estable que
 * (último - primero) cuando la serie tiene ruido de redondeo.
 * @param {Point[]} pts
 * @returns {number}
 */
function slopePerMs(pts) {
  const n = pts.length;
  const meanT = pts.reduce((s, p) => s + p.t, 0) / n;
  const meanV = pts.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dt = p.t - meanT;
    num += dt * (p.v - meanV);
    den += dt * dt;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Proyecta el consumo del medidor hasta que su ventana se reinicie.
 *
 * Devuelve null cuando no hay base para una proyección honesta: sin ventana,
 * sin historial suficiente para el horizonte que hay que cubrir, o sin consumo.
 *
 * @param {Point[]} points serie del medidor (la de 24 h que guarda history.js)
 * @param {{ usedPct: number, resetsAt: number|null|undefined, now?: number }} opts
 * @returns {Forecast|null}
 */
export function forecast(points, opts) {
  const now = opts.now ?? Date.now();
  const usedPct = opts.usedPct;
  const resetsAt = opts.resetsAt;

  if (!Number.isFinite(usedPct)) return null;
  if (!resetsAt || !Number.isFinite(resetsAt) || resetsAt <= now) return null;
  if (!Array.isArray(points)) return null;

  // El snapshot es más fresco que el último punto guardado: lo usamos como
  // último dato de la serie.
  const past = points.filter((p) => p && Number.isFinite(p.t) && p.t < now);
  const run = currentRun([...past, { t: now, v: usedPct }]);
  if (run.length < MIN_POINTS) return null;

  const horizon = resetsAt - now;
  const span = run[run.length - 1].t - run[0].t;
  // Extrapolar una ventana mensual desde 40 minutos de datos sería adivinar.
  const minSpan = horizon <= SHORT_HORIZON_MS ? MIN_SPAN_SHORT_MS : MIN_SPAN_LONG_MS;
  if (span < minSpan) return null;

  const rate = slopePerMs(run);
  if (!(rate > 0)) return null; // sin consumo: no hay nada que proyectar

  const projectedPct = usedPct + rate * horizon;
  const exhaustsAt =
    projectedPct < 100 ? null
      : usedPct >= 100 ? now
        : now + (100 - usedPct) / rate;

  return {
    projectedPct: Math.round(projectedPct),
    ratePerHour: rate * 3600 * 1000,
    exhaustsAt: exhaustsAt === null ? null : Math.round(exhaustsAt),
  };
}

const WARN_MARGIN_PCT = 105;          // margen sobre 100: por debajo es empate técnico
const MIN_LEAD_MS = 10 * 60 * 1000;   // un aviso con menos margen que esto llega tarde

/**
 * Proyección que merece una notificación, o null.
 *
 * Es más exigente que `forecast` a propósito. Un aviso que se dispara por ruido
 * de redondeo se apaga a la semana, así que acá pedimos tres cosas: que la
 * proyección cruce el 100% con holgura (no por decimales), que el agotamiento
 * caiga antes del reinicio, y que falte tiempo suficiente para que avisar sirva
 * de algo. Un medidor que ya está al límite no entra: de eso avisa el umbral.
 *
 * @param {Point[]} points
 * @param {{ usedPct: number, resetsAt: number|null|undefined, now?: number }} opts
 * @returns {Forecast|null}
 */
export function exhaustionWarning(points, opts) {
  const now = opts.now ?? Date.now();
  const fc = forecast(points, opts);
  if (!fc || fc.exhaustsAt === null) return null;
  if (fc.projectedPct < WARN_MARGIN_PCT) return null;
  if (fc.exhaustsAt - now < MIN_LEAD_MS) return null;
  return fc;
}
