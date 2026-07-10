// @ts-check

/** Error de sesión ausente/expirada — la UI lo traduce a "iniciá sesión". */
export class AuthError extends Error {
  constructor(/** @type {string} */ detail) {
    super(detail);
    this.name = 'AuthError';
  }
}

/**
 * GET/POST JSON same-origin con la sesión del navegador.
 * La cookie la adjunta el navegador; la extensión nunca la lee.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function fetchJSON(url, init = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { accept: 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) throw new AuthError(`HTTP ${res.status}`);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.name = 'HttpError';
    throw err;
  }
  return res.json();
}
