// @ts-check
// Persistencia del historial de uso, eficiente en storage.local.
//
// Por cada medidor con porcentaje guardamos dos cosas, en claves separadas:
//  - Serie de puntos {t, v} de las últimas 24 h → alimenta los sparklines.
//  - Buckets de actividad por hora epoch → alimentan el heatmap. La "actividad"
//    es el consumo real (delta positivo de %); los resets (delta negativo) se
//    ignoran, así una ventana que se reinicia no cuenta como uso.

const PTS = (/** @type {string} */ id) => `hist.pts.${id}`;
const ACT = (/** @type {string} */ id) => `hist.act.${id}`;

const POINTS_RETAIN_MS = 24 * 3600 * 1000;      // 24 h de puntos para el sparkline
const ACT_RETAIN_MS = 31 * 24 * 3600 * 1000;    // 31 días de buckets para el heatmap

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
    const cutoff = now - POINTS_RETAIN_MS;
    updates[PTS(id)] = pts.filter((/** @type {{t:number}} */ p) => p && p.t >= cutoff);

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
