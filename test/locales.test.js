// Los catálogos se editan a mano y de a uno. Sin esta red, agregar una clave
// en español y olvidarla en inglés no rompe nada visible: chrome.i18n devuelve
// cadena vacía y el texto simplemente desaparece de la interfaz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES_URL = new URL('../_locales/', import.meta.url);
const langs = readdirSync(LOCALES_URL);
const catalog = (lang) =>
  JSON.parse(readFileSync(new URL(`${lang}/messages.json`, LOCALES_URL), 'utf8'));
const cats = Object.fromEntries(langs.map((l) => [l, catalog(l)]));

const DEFAULT = 'en'; // el default_locale del manifiesto

test('hay al menos el idioma por defecto más una traducción', () => {
  assert.ok(langs.includes(DEFAULT), `falta _locales/${DEFAULT}`);
  assert.ok(langs.length >= 2, `solo hay ${langs.join(', ')}`);
});

for (const lang of langs) {
  if (lang === DEFAULT) continue;

  test(`${lang}: tiene exactamente las mismas claves que ${DEFAULT}`, () => {
    const base = new Set(Object.keys(cats[DEFAULT]));
    const other = new Set(Object.keys(cats[lang]));
    assert.deepEqual([...base].filter((k) => !other.has(k)), [], 'claves sin traducir');
    assert.deepEqual([...other].filter((k) => !base.has(k)), [], `claves que no existen en ${DEFAULT}`);
  });

  test(`${lang}: cada mensaje declara los mismos placeholders`, () => {
    for (const key of Object.keys(cats[DEFAULT])) {
      const a = Object.keys(cats[DEFAULT][key].placeholders ?? {}).sort();
      const b = Object.keys(cats[lang][key]?.placeholders ?? {}).sort();
      assert.deepEqual(b, a, `${key}: placeholders distintos`);
    }
  });

  test(`${lang}: ningún mensaje quedó vacío`, () => {
    for (const [key, entry] of Object.entries(cats[lang])) {
      assert.ok(typeof entry.message === 'string' && entry.message.trim(), `${key} vacío`);
    }
  });
}

test('todo $PLACEHOLDER$ usado en un mensaje está declarado', () => {
  for (const [lang, data] of Object.entries(cats)) {
    for (const [key, entry] of Object.entries(data)) {
      const declared = new Set(Object.keys(entry.placeholders ?? {}).map((p) => p.toLowerCase()));
      const used = [...entry.message.matchAll(/\$([A-Za-z_]\w*)\$/g)].map((m) => m[1].toLowerCase());
      for (const name of used) {
        assert.ok(declared.has(name), `${lang}.${key}: $${name}$ sin declarar`);
      }
    }
  }
});
