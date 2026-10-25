import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMessage, decodeFields, timestampMs, numberAt, bytesAt } from '../src/lib/grpcweb.js';

// Usamos el catálogo real: así los tests comprueban el texto que se ve.
const messages = JSON.parse(
  readFileSync(new URL('../_locales/es/messages.json', import.meta.url), 'utf8'),
);
globalThis.chrome = { i18n: { getMessage: (key) => messages[key]?.message ?? key } };
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

test('el desglose nombra los productos del enum, de mayor a menor', () => {
  const [m] = parseCredits(fixture('grok-credits-6pct'));
  assert.equal(m.detail, 'Apps 5% · Chat 1%');
});

test('con un solo producto no hay desglose: repetiría el total', () => {
  const [m] = parseCredits(fixture('grok-credits-1pct'));
  assert.equal(m.detail, undefined);
});

/* Construcción de payloads a mano, para los casos que no tenemos capturados. */
const f32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, n, true);
  return b;
};
const join = (...chunks) => Uint8Array.from(chunks.flatMap((c) => [...c]));
/** Un desglose {1: id, 2: porcentaje} dentro del campo 7. */
const part = (id, pct) => {
  const body = join([0x08, id], [0x15], f32(pct));
  return join([0x3a, body.length], body);
};
/** Mensaje con el total en el campo 1 y sus desgloses. */
const credits = (total, parts) => [
  { field: 1, wire: 2, value: join([0x0d], f32(total), ...parts) },
];

test('nombra los dos mayores y agrupa el resto, sin perder porcentaje', () => {
  const [m] = parseCredits(credits(30, [
    part(7, 12), part(4, 8), part(5, 6), part(6, 3), part(1, 1),
  ]));
  assert.equal(m.usedPct, 30);
  assert.equal(m.detail, 'Apps 12% · Chat 8% · otros 10%'); // 6 + 3 + 1 = 10
  const suma = [...m.detail.matchAll(/(\d+)%/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(suma, m.usedPct);
});

test('un producto que no conocemos cae en "otros" y el desglose sigue cerrando', () => {
  // 99 no está en el enum: igual no puede desaparecer de la cuenta.
  const [m] = parseCredits(credits(10, [part(4, 6), part(99, 4)]));
  assert.equal(m.detail, 'Chat 6% · otros 4%');
  const suma = [...m.detail.matchAll(/(\d+)%/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(suma, m.usedPct, 'el desglose debe sumar el total');
});

test('los desgloses en cero no ensucian la línea', () => {
  const [m] = parseCredits(credits(5, [part(4, 5), part(5, 0), part(6, 0)]));
  assert.equal(m.detail, undefined); // queda un solo producto con consumo
});

/** Codifica un entero como varint (para construir timestamps a mano). */
const varint = (n) => {
  const out = [];
  while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Uint8Array.from(out);
};
/** google.protobuf.Timestamp dentro del campo `field`. */
const stamp = (field, secs) => {
  const body = join([0x08], varint(secs));
  return join([field * 8 + 2, body.length], body);
};

test('pool recién reiniciado: 0% usado no es un error', () => {
  // proto3 no serializa los campos en su valor por defecto, así que con el
  // pool en cero el porcentaje no viene en el mensaje. Hay ventana: la
  // respuesta es válida y el uso es 0, no "no se pudo leer".
  const fin = 1793490266;
  const msg = [{
    field: 1, wire: 2,
    value: join(stamp(4, fin - 604800), stamp(5, fin)),
  }];
  const [m] = parseCredits(msg);
  assert.equal(m.usedPct, 0);
  assert.equal(m.resetsAt, fin * 1000);
  assert.equal(m.detail, undefined);
});

test('una respuesta sin nada reconocible sigue siendo un fallo de parseo', () => {
  assert.throws(() => parseCredits([{ field: 1, wire: 2, value: new Uint8Array(0) }]),
    { name: 'ParseError' });
});
