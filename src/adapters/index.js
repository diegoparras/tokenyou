// @ts-check
import { claude } from './claude.js';
import { chatgpt } from './chatgpt.js';
import { grok } from './grok.js';
import { perplexity } from './perplexity.js';

/**
 * Registro de plataformas. Cada adaptador es independiente: si su API interna
 * cambia, solo esa plataforma se degrada ("no disponible"), el resto sigue.
 */
export const adapters = [claude, chatgpt, grok, perplexity];

/** @param {string} id */
export function adapterById(id) {
  return adapters.find((a) => a.id === id) ?? null;
}
