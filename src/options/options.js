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

  await initNotifications();
  await initIconAndRefresh();

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

/** Ícono (qué plataforma muestra el badge) + frecuencia de actualización por plataforma. */
async function initIconAndRefresh() {
  setText('prefs-title', t('prefsTitle'));
  setText('refresh-intro', t('refreshIntro'));

  const [granted, adapters, refresh] = await Promise.all([
    chrome.permissions.getAll(),
    getAllAdapters(),
    getRefreshMinutes(),
  ]);
  const origins = granted.origins ?? [];
  const enabled = adapters.filter((a) => origins.includes(a.origin));

  // Frecuencia por plataforma.
  const $list = /** @type {HTMLElement} */ (document.getElementById('refresh-list'));
  $list.replaceChildren(
    ...enabled.map((a) => {
      const row = document.createElement('div');
      row.className = 'refresh-row';
      const left = document.createElement('span');
      left.className = 'rp';
      const dot = document.createElement('i');
      dot.style.setProperty('--pc', PLATFORM_COLORS[/** @type {keyof typeof PLATFORM_COLORS} */ (a.id)] ?? '#7B8A96');
      left.append(dot, document.createTextNode(a.name));
      const sel = document.createElement('select');
      sel.className = 'mini-sel';
      for (const m of REFRESH_CHOICES) {
        const o = document.createElement('option');
        o.value = String(m);
        o.textContent = t('minutes', String(m));
        sel.append(o);
      }
      sel.value = String(refreshMinutesFor(refresh, a.id));
      sel.addEventListener('change', () => void setRefreshForPlatform(a.id, Number(sel.value)));
      row.append(left, sel);
      return row;
    })
  );
}

/** @param {string} id @param {string} text */
function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}
