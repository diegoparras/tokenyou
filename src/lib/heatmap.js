// @ts-check
// Convierte los buckets de actividad por hora epoch (de history.js) en las
// grillas que dibuja la vista de historial: semana (7 días × 24 h) o mes
// (últimos ~30 días). No accede a storage; recibe los buckets ya leídos.

/**
 * @typedef {Object} HeatCell
 * @property {number} value      Consumo acumulado en la franja.
 * @property {string} label      Etiqueta legible (para tooltip).
 *
 * @typedef {Object} HeatGrid
 * @property {HeatCell[][]} rows  Filas (días) × columnas (franjas).
 * @property {string[]} rowLabels
 * @property {string[]} colLabels Etiqueta por columna (vacía si no se rotula).
 * @property {number} max         Valor máximo, para normalizar la intensidad.
 * @property {number} total       Consumo total del período.
 * @property {string|null} peak   Descripción de la franja pico, o null.
 */

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Grilla semanal: 7 filas (Lun→Dom de los últimos 7 días) × 12 columnas (bloques de 2 h).
 * @param {Record<number, number>} buckets  hora-epoch → consumo
 * @param {number} now  epoch ms (referencia; pasar Date.now() desde el llamador)
 * @returns {HeatGrid}
 */
export function weekGrid(buckets, now) {
  const BLOCKS = 12; // bloques de 2 h
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const start = startOfToday.getTime() - 6 * 86400000; // hace 6 días, medianoche

  /** @type {HeatCell[][]} */
  const rows = [];
  const rowLabels = [];
  let max = 0, total = 0;
  let peakVal = 0, peakDay = -1, peakBlock = -1;

  for (let d = 0; d < 7; d++) {
    const dayStart = start + d * 86400000;
    rowLabels.push(DAYS_ES[new Date(dayStart).getDay()]);
    /** @type {HeatCell[]} */
    const row = [];
    for (let b = 0; b < BLOCKS; b++) {
      const from = dayStart + b * 2 * 3600000;
      let v = 0;
      for (let h = 0; h < 2; h++) {
        const hourKey = Math.floor((from + h * 3600000) / 3600000);
        v += buckets[hourKey] || 0;
      }
      v = Math.round(v);
      total += v;
      if (v > max) max = v;
      if (v > peakVal) { peakVal = v; peakDay = d; peakBlock = b; }
      row.push({ value: v, label: `${rowLabels[d]} ${b * 2}–${b * 2 + 2} h · ${v}` });
    }
    rows.push(row);
  }

  const colLabels = Array.from({ length: BLOCKS }, (_, b) => (b % 2 === 0 ? String(b * 2) : ''));
  const peak =
    peakVal > 0 && peakDay >= 0
      ? `${DAYS_ES[new Date(start + peakDay * 86400000).getDay()]} ${peakBlock * 2}–${peakBlock * 2 + 2} h`
      : null;

  return { rows, rowLabels, colLabels, max, total: Math.round(total), peak };
}

/**
 * Grilla mensual: filas = semanas, columnas = días (Lun→Dom), de ~5 semanas.
 * @param {Record<number, number>} buckets
 * @param {number} now
 * @returns {HeatGrid}
 */
export function monthGrid(buckets, now) {
  const dayTotals = new Map();
  for (const [hourKey, v] of Object.entries(buckets)) {
    const dayKey = Math.floor((Number(hourKey) * 3600000) / 86400000);
    dayTotals.set(dayKey, (dayTotals.get(dayKey) || 0) + v);
  }
  const todayKey = Math.floor(now / 86400000);
  const WEEKS = 5;
  const startDayKey = todayKey - (WEEKS * 7 - 1);

  /** @type {HeatCell[][]} */
  const rows = [];
  let max = 0, total = 0;
  for (let w = 0; w < WEEKS; w++) {
    /** @type {HeatCell[]} */
    const row = [];
    for (let d = 0; d < 7; d++) {
      const dayKey = startDayKey + w * 7 + d;
      const v = Math.round(dayTotals.get(dayKey) || 0);
      total += v;
      if (v > max) max = v;
      const date = new Date(dayKey * 86400000);
      row.push({ value: v, label: `${date.getDate()}/${date.getMonth() + 1} · ${v}` });
    }
    rows.push(row);
  }
  return {
    rows,
    rowLabels: rows.map((_, w) => `S${w + 1}`),
    colLabels: DAYS_ES.slice(1).concat(DAYS_ES[0]).map((d) => d[0]),
    max,
    total: Math.round(total),
    peak: null,
  };
}
