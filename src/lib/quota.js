// @ts-check

/**
 * Modelo normalizado que todo adaptador devuelve.
 *
 * @typedef {Object} Meter
 * @property {string} id            Identificador estable dentro de la plataforma.
 * @property {string} label         Etiqueta ya localizada.
 * @property {number|null} usedPct  0–100, o null si solo hay conteo restante.
 * @property {number|null} resetsAt Epoch ms del próximo reset, o null si se desconoce.
 * @property {number|null} [remaining] Unidades restantes (medidores de conteo).
 * @property {number|null} [total]     Total de unidades (si la plataforma lo expone).
 * @property {number|null} [used]      Unidades consumidas (conteo local, sin total conocido).
 * @property {string} [detail]         Texto adicional ya formateado (p. ej. monto en dinero).
 *
 * @typedef {Object} Snapshot
 * @property {string} platformId
 * @property {boolean} ok
 * @property {'auth'|'http'|'network'|'parse'} [error]
 * @property {boolean} [approx]     true si los valores son conteo local, no dato de la plataforma.
 * @property {string} [plan]        Nombre legible del plan, si la plataforma lo expone.
 * @property {Meter[]} meters
 * @property {number} fetchedAt     Epoch ms.
 */

/**
 * Porcentaje usado a partir de un conteo restante/total.
 * @param {number} remaining
 * @param {number} total
 * @returns {number|null}
 */
export function pctFromCounts(remaining, total) {
  if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) return null;
  const pct = (1 - remaining / total) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Peor porcentaje usado de un conjunto de snapshots (para el badge),
 * ignorando los medidores que el usuario ocultó.
 * @param {Snapshot[]} snaps
 * @param {Set<string>} [hidden] claves `${platformId}/${meterId}`
 * @returns {number|null}
 */
export function worstPct(snaps, hidden = new Set()) {
  let worst = null;
  for (const s of snaps) {
    if (!s.ok) continue;
    for (const m of s.meters) {
      if (hidden.has(`${s.platformId}/${m.id}`)) continue;
      if (m.usedPct === null || m.usedPct === undefined) continue;
      if (worst === null || m.usedPct > worst) worst = m.usedPct;
    }
  }
  return worst;
}
