// @ts-check
import { claude } from './claude.js';
import { chatgpt } from './chatgpt.js';
import { gemini } from './gemini.js';
import { grok } from './grok.js';
import { perplexity } from './perplexity.js';
import { getCustomServices, customToAdapter } from './custom.js';

/**
 * @typedef {Object} Adapter
 * @property {string} id
 * @property {string} name
 * @property {string} origin
 * @property {string} home
 * @property {() => Promise<import('../lib/quota.js').Snapshot>} fetchSnapshot
 * @property {object[]} [contentScripts] Solo plataformas sin endpoint (script en la página).
 * @property {boolean} [custom]          Servicio definido por el usuario.
 */

/**
 * Registro de plataformas nativas. Cada adaptador es independiente: si su API
 * interna cambia, solo esa plataforma se degrada ("no disponible"), el resto sigue.
 * @type {Adapter[]}
 */
export const builtinAdapters = [claude, chatgpt, gemini, grok, perplexity];

/**
 * Nativas + servicios personalizados definidos por el usuario.
 * @returns {Promise<Adapter[]>}
 */
export async function getAllAdapters() {
  const custom = await getCustomServices();
  return [...builtinAdapters, ...custom.map(customToAdapter)];
}
