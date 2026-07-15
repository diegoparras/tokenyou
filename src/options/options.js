// @ts-check
import {
  getCustomServices,
  setCustomServices,
  validateService,
  customToAdapter,
} from '../adapters/custom.js';
import { getNotifyPrefs, setNotifyPrefs } from '../lib/notify.js';
import {
  getRefreshMinutes, refreshMinutesFor, setRefreshForPlatform, REFRESH_CHOICES,
  getHiddenPlatforms, setPlatformHidden, unpinPlatform,
} from '../lib/prefs.js';
import { getAllAdapters } from '../adapters/index.js';

const PLATFORM_COLORS = {
  claude: '#D97757', chatgpt: '#10A37F', gemini: '#4E8CF9', grok: '#8A93A6',
  perplexity: '#26B8CE', copilot: '#6E40C9', abacus: '#EF6C3A',
};

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

const $editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
const $result = /** @type {HTMLPreElement} */ (document.getElementById('result'));

const CURSOR_TEMPLATE = {
  id: 'cursor',
  name: 'Cursor',
  origin: 'https://cursor.com/*',
  url: 'https://cursor.com/api/usage',
  method: 'GET',
  meters: [
    {
      id: 'premium',
      label: 'Premium requests',
      usedPath: 'gpt-4.numRequests',
      totalPath: 'gpt-4.maxRequestUsage',
    },
  ],
};

init();

async function init() {
  document.title = t('optTitle');
  setText('title', t('optTitle'));
  setText('custom-title', t('optTitle'));
  setText('intro', t('optIntro'));
  setText('security-note', t('optSecurityNote'));
  setText('template-btn', t('optTemplate'));
  setText('test-btn', t('optTest'));
  setText('save-btn', t('optSave'));

  await initPlatforms();
  await initNotifications();

  const services = await getCustomServices();
  $editor.value = JSON.stringify(services, null, 2);

  document.getElementById('template-btn')?.addEventListener('click', () => {
    const current = parseEditor();
    if (!Array.isArray(current)) return;
    if (!current.some((s) => s?.id === CURSOR_TEMPLATE.id)) current.push(CURSOR_TEMPLATE);
    $editor.value = JSON.stringify(current, null, 2);
  });

  document.getElementById('save-btn')?.addEventListener('click', () => void save());
  document.getElementById('test-btn')?.addEventListener('click', () => void testAll());
}

/** @returns {any[]|null} */
function parseEditor() {
  try {
    const parsed = JSON.parse($editor.value || '[]');
    if (!Array.isArray(parsed)) {
      showResult('err', t('optNotArray'));
      return null;
    }
    return parsed;
  } catch (e) {
    showResult('err', `JSON: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Valida todas las definiciones; null si hay errores. @returns {any[]|null} */
function validateEditor() {
  const parsed = parseEditor();
  if (!parsed) return null;
  const allErrors = [];
  const seen = new Set();
  for (const def of parsed) {
    const errors = validateService(def);
    if (def?.id && seen.has(def.id)) errors.push(`id "${def.id}": duplicated`);
    if (def?.id) seen.add(def.id);
    if (errors.length) allErrors.push(`[${def?.id ?? '?'}] ${errors.join(' · ')}`);
  }
  if (allErrors.length) {
    showResult('err', allErrors.join('\n'));
    return null;
  }
  return parsed;
}

async function save() {
  const services = validateEditor();
  if (!services) return;
  await setCustomServices(services);
  await chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  showResult('ok', t('optSaved'));
}

/** Prueba cada servicio del editor: pide el permiso y muestra los medidores leídos. */
async function testAll() {
  const services = validateEditor();
  if (!services || !services.length) return;

  const lines = [];
  for (const def of services) {
    const granted = await chrome.permissions
      .request({ origins: [def.origin] })
      .catch(() => false);
    if (!granted) {
      lines.push(`✗ ${def.name}: ${t('optNoPermission')}`);
      continue;
    }
    try {
      const snap = await customToAdapter(def).fetchSnapshot();
      const meters = snap.meters
        .map((m) => {
          const val =
            m.usedPct != null
              ? `${m.usedPct}%`
              : m.remaining != null
                ? `remaining ${m.remaining}${m.total != null ? `/${m.total}` : ''}`
                : `used ${m.used}`;
          return `  · ${m.label}: ${val}`;
        })
        .join('\n');
      lines.push(`✓ ${def.name}${snap.plan ? ` (${snap.plan})` : ''}\n${meters}`);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      lines.push(
        `✗ ${def.name}: ${name === 'AuthError' ? t('optAuthFail') : name === 'ParseError' ? t('optParseFail') : String(e)}`
      );
    }
  }
  showResult(lines.some((l) => l.startsWith('✗')) ? 'err' : 'ok', lines.join('\n\n'));
}

/** @param {'ok'|'err'} kind @param {string} text */
function showResult(kind, text) {
  $result.hidden = false;
  $result.className = kind;
  $result.textContent = text;
}

/** Sección de notificaciones: permiso opcional + preferencias. */
async function initNotifications() {
  setText('notif-title', t('notifTitle'));
  setText('notif-intro', t('notifIntro'));
  setText('notif-enable-lbl', t('notifEnable'));
  setText('notif-reset-lbl', t('notifOnReset'));
  setText('notif-th-lbl', t('notifOnThreshold'));

  const $enable = /** @type {HTMLInputElement} */ (document.getElementById('notif-enable'));
  const $reset = /** @type {HTMLInputElement} */ (document.getElementById('notif-reset'));
  const $th = /** @type {HTMLInputElement} */ (document.getElementById('notif-th'));
  const $opts = document.getElementById('notif-opts');

  const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
  const prefs = await getNotifyPrefs();
  $enable.checked = granted;
  $reset.checked = prefs.reset;
  $th.checked = prefs.threshold !== null;
  $opts?.classList.toggle('off', !granted);

  $enable.addEventListener('change', async () => {
    if ($enable.checked) {
      const ok = await chrome.permissions.request({ permissions: ['notifications'] });
      if (!ok) { $enable.checked = false; return; }
      $reset.checked = true;
      $th.checked = true;
      await setNotifyPrefs({ reset: true, threshold: 85 });
      $opts?.classList.remove('off');
    } else {
      await chrome.permissions.remove({ permissions: ['notifications'] });
      await setNotifyPrefs({ reset: false, threshold: null });
      $reset.checked = false;
      $th.checked = false;
      $opts?.classList.add('off');
    }
  });
  const save = () => setNotifyPrefs({ reset: $reset.checked, threshold: $th.checked ? 85 : null });
  $reset.addEventListener('change', save);
  $th.addEventListener('change', save);
}

/**
 * Panel central de plataformas: activar / mostrar-ocultar / frecuencia / quitar.
 * Es el lugar único para elegir qué se ve en el popup (así el popup queda mínimo).
 */
async function initPlatforms() {
  setText('platforms-title', t('platformsTitle'));
  setText('platforms-intro', t('platformsIntro'));
  await renderPlatforms();
}

async function renderPlatforms() {
  const [granted, adapters, refresh, hiddenPlatforms] = await Promise.all([
    chrome.permissions.getAll(),
    getAllAdapters(),
    getRefreshMinutes(),
    getHiddenPlatforms(),
  ]);
  const origins = granted.origins ?? [];
  const $list = /** @type {HTMLElement} */ (document.getElementById('platforms-list'));
  $list.replaceChildren(
    ...adapters.map((a) => platformRow(a, origins.includes(a.origin), refresh, hiddenPlatforms)),
  );
}

/**
 * @param {import('../adapters/index.js').Adapter} a
 * @param {boolean} enabled permiso de host concedido
 * @param {Record<string, number>} refresh
 * @param {Set<string>} hiddenPlatforms
 */
function platformRow(a, enabled, refresh, hiddenPlatforms) {
  const row = el('div', 'pf-row' + (enabled ? '' : ' off'));

  const idw = el('span', 'pf-id');
  const dot = el('i', 'pf-dot');
  dot.style.setProperty('--pc', PLATFORM_COLORS[/** @type {keyof typeof PLATFORM_COLORS} */ (a.id)] ?? '#7B8A96');
  idw.append(dot, el('b', 'pf-name', a.name));
  idw.append(el('span', 'pf-host', a.origin.replace(/^https:\/\/|\/\*$/g, '')));
  if (a.custom) idw.append(el('span', 'pf-chip', t('customChip')));
  row.append(idw);

  const ctrl = el('span', 'pf-controls');
  if (enabled) {
    // Visible en el popup (mantiene el permiso; sigue midiendo para el historial).
    const vis = el('label', 'pf-vis');
    const cb = /** @type {HTMLInputElement} */ (document.createElement('input'));
    cb.type = 'checkbox';
    cb.checked = !hiddenPlatforms.has(a.id);
    cb.addEventListener('change', async () => {
      await setPlatformHidden(a.id, !cb.checked);
      if (!cb.checked) await unpinPlatform(a.id);
      row.classList.toggle('hiddenp', !cb.checked);
    });
    vis.append(cb, el('span', '', t('platformVisible')));
    row.classList.toggle('hiddenp', hiddenPlatforms.has(a.id));

    // Frecuencia de actualización.
    const sel = /** @type {HTMLSelectElement} */ (document.createElement('select'));
    sel.className = 'mini-sel';
    sel.title = t('refreshIntro');
    for (const m of REFRESH_CHOICES) {
      const o = document.createElement('option');
      o.value = String(m);
      o.textContent = t('minutes', String(m));
      sel.append(o);
    }
    sel.value = String(refreshMinutesFor(refresh, a.id));
    sel.addEventListener('change', () => void setRefreshForPlatform(a.id, Number(sel.value)));

    // Quitar (revoca el permiso de host).
    const rm = /** @type {HTMLButtonElement} */ (el('button', 'pf-btn danger', t('remove')));
    rm.addEventListener('click', async () => {
      await unpinPlatform(a.id);
      await setPlatformHidden(a.id, false);
      await chrome.permissions.remove({ origins: [a.origin] });
      await renderPlatforms();
    });

    ctrl.append(vis, sel, rm);
  } else {
    const en = /** @type {HTMLButtonElement} */ (el('button', 'pf-btn primary', t('enable')));
    en.addEventListener('click', async () => {
      const ok = await chrome.permissions.request({ origins: [a.origin] }).catch(() => false);
      if (ok) await renderPlatforms();
    });
    ctrl.append(en);
  }
  row.append(ctrl);
  return row;
}

/** @param {string} tag @param {string} className @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} id @param {string} text */
function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}
