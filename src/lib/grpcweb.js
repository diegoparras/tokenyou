// @ts-check
// Cliente gRPC-Web mínimo y decodificador protobuf, sin dependencias.
//
// Algunas plataformas dejaron de publicar la cuota por JSON y la sirven como
// gRPC-Web binario (es el caso de Grok desde 2026-10). Esto lee lo justo:
// separa los marcos de la respuesta y decodifica los campos de un mensaje.
// No conoce esquemas: quien llama interpreta los números de campo.

import { AuthError } from './http.js';

/** @typedef {{ field: number, wire: number, value: number|Uint8Array }} Field */

/**
 * Lee un varint. Usa multiplicación en vez de corrimientos porque los
 * timestamps superan los 32 bits que admiten los operadores bit a bit de JS.
 * @param {Uint8Array} buf @param {number} i
 * @returns {[number, number]} valor y posición siguiente
 */
function varint(buf, i) {
  let value = 0;
  let mul = 1;
  while (i < buf.length) {
    const b = buf[i];
    i += 1;
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) break;
    mul *= 128;
    if (mul > Number.MAX_SAFE_INTEGER) break;
  }
  return [value, i];
}

/**
 * Decodifica los campos del nivel superior de un mensaje protobuf.
 * @param {Uint8Array} buf
 * @returns {Field[]}
 */
export function decodeFields(buf) {
  /** @type {Field[]} */
  const out = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  while (i < buf.length) {
    const [key, afterKey] = varint(buf, i);
    if (afterKey === i) break;
    i = afterKey;
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const [v, next] = varint(buf, i);
      i = next;
      out.push({ field, wire, value: v });
    } else if (wire === 2) {
      const [len, next] = varint(buf, i);
      i = next;
      out.push({ field, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 5) {
      if (i + 4 > buf.length) break;
      out.push({ field, wire, value: view.getFloat32(i, true) });
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > buf.length) break;
      out.push({ field, wire, value: view.getFloat64(i, true) });
      i += 8;
    } else {
      break; // grupos: obsoletos, no los usamos
    }
  }
  return out;
}

/** Primer campo numérico con ese número. @param {Field[]} fields @param {number} n */
export function numberAt(fields, n) {
  const f = fields.find((x) => x.field === n && typeof x.value === 'number');
  return f ? /** @type {number} */ (f.value) : null;
}

/** Primer bloque con ese número. @param {Field[]} fields @param {number} n */
export function bytesAt(fields, n) {
  const f = fields.find((x) => x.field === n && x.value instanceof Uint8Array);
  return f ? /** @type {Uint8Array} */ (f.value) : null;
}

/**
 * google.protobuf.Timestamp → epoch ms. @param {Uint8Array} blob
 * @returns {number|null}
 */
export function timestampMs(blob) {
  const secs = numberAt(decodeFields(blob), 1);
  return secs === null ? null : Math.round(secs * 1000);
}

/**
 * Separa los marcos de una respuesta gRPC-Web y devuelve el de datos.
 * Cada marco es: 1 byte de banderas, 4 de longitud (big endian) y el cuerpo.
 * El marco con el bit 0x80 es el trailer, que trae el `grpc-status` final.
 * @param {Uint8Array} buf
 * @returns {Uint8Array}
 */
export function readMessage(buf) {
  let i = 0;
  /** @type {Uint8Array|null} */
  let data = null;
  let status = '0';
  while (i + 5 <= buf.length) {
    const flags = buf[i];
    const len = buf[i + 1] * 0x1000000 + buf[i + 2] * 0x10000 + buf[i + 3] * 0x100 + buf[i + 4];
    const body = buf.subarray(i + 5, i + 5 + len);
    i += 5 + len;
    if (flags & 0x80) {
      const match = /grpc-status:\s*(\d+)/i.exec(new TextDecoder().decode(body));
      if (match) status = match[1];
    } else if (!data) {
      data = body;
    }
  }
  if (status !== '0') {
    // 16 = no autenticado; el resto son fallos del servicio (p. ej. 14, medidor caído).
    throw Object.assign(
      new Error(`grpc-status ${status}`),
      { name: status === '16' ? 'AuthError' : 'GrpcError' },
    );
  }
  if (!data || !data.length) throw Object.assign(new Error('sin datos'), { name: 'ParseError' });
  return data;
}

/**
 * Llamada unaria con mensaje vacío. La sesión la adjunta el navegador.
 * @param {string} url
 * @returns {Promise<Field[]>} campos del mensaje de respuesta
 */
export async function grpcWebUnary(url) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
    body: new Uint8Array(5), // marco vacío: banderas 0 + longitud 0
  });
  if (res.status === 401 || res.status === 403) throw new AuthError(`HTTP ${res.status}`);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { name: 'HttpError' });

  // Un fallo temprano llega como cabecera, sin cuerpo.
  const early = res.headers.get('grpc-status');
  if (early && early !== '0') {
    if (early === '16') throw new AuthError('grpc-status 16');
    throw Object.assign(new Error(`grpc-status ${early}`), { name: 'GrpcError' });
  }
  return decodeFields(readMessage(new Uint8Array(await res.arrayBuffer())));
}
