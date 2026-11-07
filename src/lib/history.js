// @ts-check
// Persistencia del historial de uso, eficiente en storage.local.
//
// Por cada medidor con porcentaje guardamos dos cosas, en claves separadas:
//  - Serie de puntos {t, v} → alimenta los sparklines y la proyección.
//  - Buckets de actividad por hora epoch → alimentan el heatmap. La "actividad"
//    es el consumo real (delta positivo de %); los resets (delta negativo) se
//    ignoran, así una ventana que se reinicia no cuenta como uso.
//
// La serie usa dos resoluciones. Las últimas 24 h se guardan tal cual, porque
// el sparkline las dibuja. Más atrás se pliega a un punto por hora: alcanza
// para proyectar una ventana semanal o mensual sin que la serie crezca sin
// techo. Sin esto, proyectar el límite semanal de Claude significaba extrapolar
// siete días desde un día de datos.

const PTS = (/** @type {string} */ id) => `hist.pts.${id}`;
const ACT = (/** @type {string} */ id) => `hist.act.${id}`;

const H = 3600 * 1000;
export const FINE_RETAIN_MS = 24 * H;           // resolución completa (sparkline)
export const POINTS_RETAIN_MS = 31 * 24 * H;    // retención total de la serie
const ACT_RETAIN_MS = 31 * 24 * H;              // 31 días de buckets para el heatmap

/**
 * Recorta y pliega una serie: fina en las últimas 24 h, una muestra por hora
 * más atrás, nada más viejo que la retención.
 *
 * Al plegar una hora se conserva su **último** punto, no el primero ni un
 * promedio: la serie es un nivel acumulado, así que el último valor es el que
 * describe el estado del medidor al cerrar esa hora. Promediar borraría los
 * resets, y forecast.js los necesita para recortar la serie al tramo vigente.
 *
 * @param {{t:number,v:number}[]|null|undefined} points
 * @param {number} now
 * @returns {{t:number,v:number}[]}
 */
export function compactPoints(points, now) {
  if (!Array.isArray(points)) return [];
  const cutoff = now - POINTS_RETAIN_MS;
  const fineFrom = now - FINE_RETAIN_MS;

  const valid = points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= cutoff)
    .sort((a, b) => a.t - b.t);

  /** @type {{t:number,v:number}[]} */
  const out = [];
  /** @type {number|null} */
  let lastHour = null;
  for (const p of valid) {
    if (p.t >= fineFrom) {
      out.push(p);
      continue;
    }
    const hour = Math.floor(p.t / H);
    // Dentro de la misma hora, el punto nuevo reemplaza al anterior.
    if (hour === lastHour) out[out.length - 1] = p;
    else out.push(p);
    lastHour = hour;
  }
  return out;
}

/** `${platformId}/${meterId}` para los medidores con % de un snapshot. */
function meterIds(/** @type {import('./quota.js').Snapshot} */ snap) {
  return snap.meters
    .filter((m) => typeof m.usedPct === 'number')
    .map((m) => ({ id: `${snap.platformId}/${m.id}`, pct: /** @type {number} */ (m.usedPct) }));
}

/**
 * Registra un snapshot en el historial. Llamado tras cada refresh exitoso.
 * @param {import('./quota.js').Snapshot} snap
 */
export async function recordSnapshot(snap) {
  if (!snap.ok) return;
  const now = snap.fetchedAt || Date.now();
  const ids = meterIds(snap);
  if (!ids.length) return;

  const keys = ids.flatMap(({ id }) => [PTS(id), ACT(id)]);
  const store = await chrome.storage.local.get(keys);
  /** @type {Record<string, any>} */
  const updates = {};

  for (const { id, pct } of ids) {
    const pts = Array.isArray(store[PTS(id)]) ? store[PTS(id)] : [];
    const prev = pts.length ? pts[pts.length - 1] : null;

    pts.push({ t: now, v: Math.round(pct) });
    // Plegar en cada escritura es idempotente: la zona ya plegada se mantiene
    // y la fina se va comprimiendo sola a medida que envejece.
    updates[PTS(id)] = compactPoints(pts, now);

    // Actividad = consumo positivo desde el punto anterior.
    if (prev && typeof prev.v === 'number') {
      const delta = pct - prev.v;
      if (delta > 0.5) {
        const act = store[ACT(id)] && typeof store[ACT(id)] === 'object' ? store[ACT(id)] : {};
        const hour = Math.floor(now / 3600000);
        act[hour] = (act[hour] || 0) + delta;
        const hourCut = Math.floor((now - ACT_RETAIN_MS) / 3600000);
        for (const k of Object.keys(act)) if (Number(k) < hourCut) delete act[k];
        updates[ACT(id)] = act;
      }
    }
  }

  await chrome.storage.local.set(updates);
}

/**
 * Series de puntos para varios medidores (para los sparklines del popup).
 * @param {string[]} ids  claves `${platformId}/${meterId}`
 * @returns {Promise<Record<string, {t:number,v:number}[]>>}
 */
export async function getSeries(ids) {
  if (!ids.length) return {};
  const store = await chrome.storage.local.get(ids.map(PTS));
  /** @type {Record<string, {t:number,v:number}[]>} */
  const out = {};
  for (const id of ids) {
    const s = store[PTS(id)];
    if (Array.isArray(s) && s.length) out[id] = s;
  }
  return out;
}

/**
 * Buckets de actividad por hora epoch para un medidor (para el heatmap).
 * @param {string} id
 * @returns {Promise<Record<number, number>>}
 */
export async function getActivity(id) {
  const store = await chrome.storage.local.get(ACT(id));
  const a = store[ACT(id)];
  return a && typeof a === 'object' ? a : {};
}

/** Borra todo el historial (para el botón "limpiar historial" de opciones). */
export async function clearHistory() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('hist.pts.') || k.startsWith('hist.act.'));
  if (keys.length) await chrome.storage.local.remove(keys);
}
