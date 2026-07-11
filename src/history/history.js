// @ts-check
import { getAllAdapters } from '../adapters/index.js';
import { getActivity } from '../lib/history.js';
import { weekGrid, monthGrid } from '../lib/heatmap.js';

const t = (/** @type {string} */ key, /** @type {string[]|undefined} */ args = undefined) =>
  chrome.i18n.getMessage(key, args) || key;

/** Color de identidad por plataforma (igual que el popup). */
const PLATFORM_COLORS = {
  claude: '#D97757', chatgpt: '#10A37F', gemini: '#4E8CF9',
  grok: '#8A93A6', perplexity: '#26B8CE', copilot: '#6E40C9', abacus: '#EF6C3A',
};

const $sel = /** @type {HTMLSelectElement} */ (document.getElementById('meter-select'));
const $heat = /** @type {HTMLElement} */ (document.getElementById('heat'));
const $cols = /** @type {HTMLElement} */ (document.getElementById('cols'));
const $peak = /** @type {HTMLElement} */ (document.getElementById('peak'));
const $totals = /** @type {HTMLElement} */ (document.getElementById('totals'));
const $empty = /** @type {HTMLElement} */ (document.getElementById('empty'));
const $heatWrap = /** @type {HTMLElement} */ (document.getElementById('heat-wrap'));

let range = /** @type {'week'|'month'} */ ('week');

init();

async function init() {
  document.title = t('historyTitle');
  setText('title', t('historyTitle'));
  setText('seg-week', t('segWeek'));
  setText('seg-month', t('segMonth'));
  setText('leg-less', t('legendLess'));
  setText('leg-more', t('legendMore'));

  for (const btn of document.querySelectorAll('#range button')) {
    btn.addEventListener('click', () => {
      range = /** @type {'week'|'month'} */ (/** @type {HTMLElement} */ (btn).dataset.range);
      for (const b of document.querySelectorAll('#range button')) b.classList.toggle('on', b === btn);
      void draw();
    });
  }
  $sel.addEventListener('change', () => void draw());

  await buildOptions();
  await draw();
}

/** Puebla el selector con cada medidor con % de cada plataforma activa. */
async function buildOptions() {
  const [granted, adapters] = await Promise.all([chrome.permissions.getAll(), getAllAdapters()]);
  const origins = granted.origins ?? [];
  const enabled = adapters.filter((a) => origins.includes(a.origin));
  const stored = await chrome.storage.local.get(enabled.map((a) => `snap.${a.id}`));

  const opts = [];
  for (const a of enabled) {
    const snap = stored[`snap.${a.id}`];
    if (!snap?.ok) continue;
    for (const m of snap.meters) {
      if (typeof m.usedPct !== 'number') continue;
      opts.push({ key: `${snap.platformId}/${m.id}`, pid: snap.platformId, name: a.name, label: m.label });
    }
  }
  $sel.replaceChildren(
    ...opts.map((o) => {
      const el = document.createElement('option');
      el.value = o.key;
      el.textContent = `${o.name} · ${o.label}`;
      el.dataset.pid = o.pid;
      return el;
    })
  );
  $empty.hidden = opts.length > 0;
  $heatWrap.hidden = opts.length === 0;
  $totals.hidden = opts.length === 0;
  if (!opts.length) setText('empty', t('historyEmpty'));
}

async function draw() {
  const key = $sel.value;
  if (!key) return;
  const pid = $sel.selectedOptions[0]?.dataset.pid || '';
  const color = PLATFORM_COLORS[/** @type {keyof typeof PLATFORM_COLORS} */ (pid)] ?? '#0F766E';
  document.documentElement.style.setProperty('--pc', color);

  const buckets = await getActivity(key);
  const now = Date.now();
  const grid = range === 'week' ? weekGrid(buckets, now) : monthGrid(buckets, now);

  // Heatmap
  const cols = grid.rows[0]?.length ?? 0;
  $heat.style.gridTemplateColumns = `26px repeat(${cols}, 1fr)`;
  $cols.style.gridTemplateColumns = `26px repeat(${cols}, 1fr)`;
  const cells = [];
  for (let r = 0; r < grid.rows.length; r++) {
    const lab = document.createElement('span');
    lab.className = 'hlab';
    lab.textContent = grid.rowLabels[r];
    cells.push(lab);
    for (const cell of grid.rows[r]) {
      const div = document.createElement('div');
      div.className = 'cell';
      const intensity = grid.max > 0 ? cell.value / grid.max : 0;
      div.style.background =
        intensity < 0.04 ? 'var(--track)' : `color-mix(in srgb, ${color} ${Math.round(10 + intensity * 90)}%, var(--track))`;
      div.title = cell.label;
      cells.push(div);
    }
  }
  $heat.replaceChildren(...cells);
  $cols.replaceChildren(
    ...[document.createElement('span'), ...grid.colLabels.map((c) => {
      const s = document.createElement('span');
      s.textContent = c;
      return s;
    })]
  );

  // Leyenda
  const legend = document.getElementById('legend');
  if (legend) {
    legend.replaceChildren(
      ...[0.12, 0.35, 0.6, 0.85].map((i) => {
        const el = document.createElement('i');
        el.style.background = `color-mix(in srgb, ${color} ${i * 100}%, var(--track))`;
        return el;
      })
    );
  }

  // Pico
  if (grid.peak) {
    $peak.hidden = false;
    $peak.innerHTML = `◔ ${t('peakLabel')} <b>${grid.peak}</b>`;
  } else {
    $peak.hidden = true;
  }

  // Totales
  $totals.replaceChildren(
    tot(t('totalConsumed'), `${grid.total}`),
    tot(t('activeCells'), `${countActive(grid)}`)
  );
}

/** @param {import('../lib/heatmap.js').HeatGrid} grid */
function countActive(grid) {
  let n = 0;
  for (const row of grid.rows) for (const c of row) if (c.value > 0) n++;
  return n;
}

/** @param {string} k @param {string} v */
function tot(k, v) {
  const box = document.createElement('div');
  box.className = 'tot';
  const kEl = document.createElement('div');
  kEl.className = 'k';
  kEl.textContent = k;
  const vEl = document.createElement('div');
  vEl.className = 'v';
  vEl.textContent = v;
  box.append(kEl, vEl);
  return box;
}

/** @param {string} id @param {string} text */
function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}
