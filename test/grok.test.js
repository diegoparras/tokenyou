import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMessage, decodeFields, timestampMs, numberAt, bytesAt } from '../src/lib/grpcweb.js';

globalThis.chrome = { i18n: { getMessage: (key) => key } };
const { parseCredits } = await import('../src/adapters/grok.js');

/** Carga una respuesta gRPC-Web real capturada del navegador. */
const fixture = (name) => {
  const b64 = readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8').trim();
  return decodeFields(readMessage(Uint8Array.from(Buffer.from(b64, 'base64'))));
};

// La pantalla de Uso mostraba exactamente estos valores cuando se capturaron.
test('captura real: la UI marcaba 1% usado', () => {
  const meters = parseCredits(fixture('grok-credits-1pct'));
  assert.equal(meters.length, 1);
  assert.equal(meters[0].usedPct, 1);
  assert.equal(meters[0].id, 'weekly');
});

test('captura real: la UI marcaba 6% usado', () => {
  const [m] = parseCredits(fixture('grok-credits-6pct'));
  assert.equal(m.usedPct, 6);
});

test('el reinicio coincide con el que anuncia la pantalla de Uso', () => {
  const [m] = parseCredits(fixture('grok-credits-6pct'));
  // "Se restablece 24 de octubre de 2026 a las 20:44" (UTC-3) = 23:44 UTC.
  assert.equal(new Date(m.resetsAt).toISOString(), '2026-10-24T23:44:26.000Z');
});

test('la ventana del pool dura exactamente siete días', () => {
  const config = decodeFields(bytesAt(fixture('grok-credits-6pct'), 1));
  const from = timestampMs(bytesAt(config, 4));
  const to = timestampMs(bytesAt(config, 5));
  assert.equal((to - from) / 86400000, 7);
});

test('el desglose por categoría suma el total', () => {
  // 6% = Creador de apps 5% + Chat 1%, tal como lo desglosa la pantalla.
  const config = decodeFields(bytesAt(fixture('grok-credits-6pct'), 1));
  const parts = config
    .filter((f) => f.field === 7 && f.value instanceof Uint8Array)
    .map((f) => numberAt(decodeFields(f.value), 2));
  assert.deepEqual(parts, [5, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), numberAt(config, 1));
});

test('un mensaje sin configuración es un fallo de parseo', () => {
  assert.throws(() => parseCredits([]), { name: 'ParseError' });
});

test('un trailer con grpc-status distinto de cero no se toma como dato', () => {
  // Respuesta real del servicio cuando su medidor está caído (status 14).
  const trailer = new TextEncoder().encode('grpc-status:14\r\n');
  const buf = new Uint8Array(5 + trailer.length);
  buf[0] = 0x80;
  buf[4] = trailer.length;
  buf.set(trailer, 5);
  assert.throws(() => readMessage(buf), { name: 'GrpcError' });
});

test('un grpc-status 16 se trata como sesión caída', () => {
  const trailer = new TextEncoder().encode('grpc-status:16\r\n');
  const buf = new Uint8Array(5 + trailer.length);
  buf[0] = 0x80;
  buf[4] = trailer.length;
  buf.set(trailer, 5);
  assert.throws(() => readMessage(buf), { name: 'AuthError' });
});

test('los varint grandes no se desbordan (timestamps de 32+ bits)', () => {
  const config = decodeFields(bytesAt(fixture('grok-credits-1pct'), 1));
  const secs = numberAt(decodeFields(bytesAt(config, 5)), 1);
  assert.equal(secs, 1792885466);
});
