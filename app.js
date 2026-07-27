/* =========================================================================
   app.js — screens, storage, and the daily lock.

   The scoring lives in scheduler.js so that tools/simulate.js can exercise
   exactly what ships here. This file is the part that touches the DOM.
   ========================================================================= */

import {
  pieces, poolFor, choosePair, mulberry32, hashSeed, todayISO, dayNumber,
} from './scheduler.js';

const OCCASIONS = [['office', 'Office'], ['date', 'Date'], ['salsa', 'Salsa'], ['out', 'Out']];
const TEMPS = [['cold', 'Cold'], ['mild', 'Mild'], ['warm', 'Warm']];
const KEY = { LOG: 'wardrobe:log', PICK: 'wardrobe:pick', PREFS: 'wardrobe:prefs' };
const RECENT_LINES = 6;

let data = null;
let outfitById = new Map();
let colours = new Map();

let log = [];
let prefs = { occasion: 'office', temp: 'mild' };
let pick = null;          // { date, occasion, temp, roll, ids }
let storageOK = true;
let notices = [];         // [{ id, text, action }]

const el = (id) => document.getElementById(id);
const hexOf = (name) => colours.get(name) || '#8E8B84';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =========================================================
   STORAGE — localStorage, but never fatal if it is missing
   ========================================================= */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (!storageOK) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageOK = false;
    addNotice('storage', 'History is not saving in this browser.');
    renderNotices();
  }
}

function probeStorage() {
  try {
    localStorage.setItem('wardrobe:probe', '1');
    localStorage.removeItem('wardrobe:probe');
    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   THE DAILY LOCK
   Same two outfits all day. The seed is the date, so even
   with storage unavailable a reload gives back the same pair.
   ========================================================= */
function currentPool() {
  return poolFor(data.outfits, prefs.occasion, prefs.temp);
}

function ensurePick({ reroll = false } = {}) {
  const date = todayISO();
  const sameContext = pick && pick.date === date
    && pick.occasion === prefs.occasion && pick.temp === prefs.temp;

  if (sameContext && !reroll) return;

  const roll = sameContext && reroll ? pick.roll + 1 : 0;
  const exclude = sameContext && reroll ? pick.ids : [];
  const random = mulberry32(hashSeed(`${date}|${prefs.occasion}|${prefs.temp}|${roll}`));
  const chosen = choosePair(currentPool(), log, date, random, exclude);

  pick = { date, occasion: prefs.occasion, temp: prefs.temp, roll, ids: chosen.map((o) => o.id) };
  write(KEY.PICK, pick);
}

/* Worn state is derived from the log, not stored on the pick — that way a
   reroll after tapping "Wear this" cannot leave the two disagreeing. */
const wornTodayId = () => {
  const date = todayISO();
  const entry = log.find((e) => e.date === date);
  return entry ? entry.outfitId : null;
};

function wear(id) {
  const date = todayISO();
  const outfit = outfitById.get(id);
  if (!outfit) return;

  const already = wornTodayId();
  log = log.filter((e) => e.date !== date);          // one entry per day
  if (already !== id) {
    log.push({ outfitId: id, garments: pieces(outfit), date });
    log.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  write(KEY.LOG, log);
  renderDeck();
  renderLog();
}

/* =========================================================
   RENDER — today
   ========================================================= */
function renderNotices() {
  el('notices').innerHTML = notices.map((n) => `
    <div class="notice">
      <span>${esc(n.text)}</span>
      ${n.action ? `<button data-notice="${esc(n.id)}">${esc(n.action)}</button>` : ''}
    </div>`).join('');
}

function addNotice(id, text, action) {
  if (notices.some((n) => n.id === id)) return;
  notices.push({ id, text, action });
}

function renderFilters() {
  el('occ-row').innerHTML = '<div class="tag rowlabel">Where you\'re going</div>' +
    OCCASIONS.map(([value, label]) =>
      `<button class="pill" data-occasion="${value}" aria-pressed="${prefs.occasion === value}">${label}</button>`).join('');
  el('temp-row').innerHTML = '<div class="tag rowlabel">Outside</div>' +
    TEMPS.map(([value, label]) =>
      `<button class="pill" data-temp="${value}" aria-pressed="${prefs.temp === value}">${label}</button>`).join('');
}

/* layer / top / bottom, or 45 / 55 when there is no layer */
function bands(outfit) {
  const rows = outfit.layer
    ? [[outfit.layer, 26], [outfit.top, 32], [outfit.bottom, 42]]
    : [[outfit.top, 45], [outfit.bottom, 55]];
  return rows.map(([name, share]) =>
    `<div class="band" style="flex:${share};background:${hexOf(name)}"></div>`).join('');
}

function card(outfit) {
  const worn = wornTodayId() === outfit.id;
  return `<article class="card">
    <div class="swatch" aria-hidden="true">${bands(outfit)}${outfit.layer ? '<span class="chip">Layered</span>' : ''}</div>
    <div class="body">
      ${outfit.layer ? `<p class="layerline">${esc(outfit.layer)} over</p>` : ''}
      <p class="top">${esc(outfit.top)}</p>
      <p class="bottom">${esc(outfit.bottom)}</p>
      ${outfit.note ? `<p class="note">${esc(outfit.note)}</p>` : ''}
      <div class="meta"><span>${esc(outfit.shoes)}</span><span>${esc(outfit.occasions.join(' · '))}</span></div>
    </div>
    <button class="wear${worn ? ' done' : ''}" data-wear="${outfit.id}"
      ${worn ? 'title="Tap again to undo" aria-label="Worn today — tap again to undo"' : ''}
      >${worn ? 'Worn today' : 'Wear this'}</button>
  </article>`;
}

function renderDeck() {
  const pool = currentPool();
  el('pool-count').textContent = `${pool.length} in play`;

  const deck = el('deck');
  const ids = pick ? pick.ids : [];

  if (!ids.length) {
    deck.classList.remove('solo');
    deck.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <strong>Nothing fits that combination.</strong>
      Try a different temperature, or a different occasion.</div>`;
    el('reroll').disabled = true;
    return;
  }

  deck.classList.toggle('solo', ids.length === 1);
  deck.innerHTML = ids.map((id) => card(outfitById.get(id))).join('') +
    (ids.length === 1
      ? '<p class="solo-note">Only one card — nothing else in this pool avoids repeating a garment.</p>'
      : '');
  el('reroll').disabled = pool.length <= 2;
}

function agoLabel(date) {
  const days = dayNumber(todayISO()) - dayNumber(date);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return `${days} days ago`;
}

function renderLog() {
  const recent = log.slice(-RECENT_LINES).reverse();
  el('log').innerHTML = recent.length
    ? recent.map((entry) => {
        const outfit = outfitById.get(entry.outfitId);
        const label = outfit ? `${outfit.top} · ${outfit.bottom}` : `Outfit ${entry.outfitId}`;
        return `<div class="logline"><span>${esc(label)}</span><span>${esc(agoLabel(entry.date))}</span></div>`;
      }).join('')
    : '<div class="logline"><span>Nothing logged yet. Tap “Wear this” and the picker starts working.</span><span></span></div>';
}

/* =========================================================
   RENDER — browse
   "What does this shirt go with", which is a different
   question from "what do I wear today".
   ========================================================= */
function highlight(text, query) {
  if (!query) return esc(text);
  const haystack = text.toLowerCase();
  let out = '';
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(query, from);
    if (at === -1) return out + esc(text.slice(from));
    out += esc(text.slice(from, at)) + '<mark>' + esc(text.slice(at, at + query.length)) + '</mark>';
    from = at + query.length;
  }
}

function renderBrowse() {
  const query = el('search').value.trim().toLowerCase();
  const hits = query
    ? data.outfits.filter((o) => pieces(o).some((p) => p.toLowerCase().includes(query)))
    : data.outfits;

  el('browse-count').textContent = query
    ? `${hits.length} outfit${hits.length === 1 ? '' : 's'} with “${query}”`
    : `${data.outfits.length} outfits`;

  el('browse-list').innerHTML = hits.map((o) => `
    <div class="row">
      <div class="minis" aria-hidden="true">${pieces(o).map((p) => `<span style="background:${hexOf(p)}"></span>`).join('')}</div>
      <div class="rowtext">
        <p class="rowtop">${o.layer ? highlight(o.layer, query) + ' + ' : ''}${highlight(o.top, query)}</p>
        <p class="rowbot">${highlight(o.bottom, query)} · ${esc(o.shoes)}</p>
      </div>
    </div>`).join('')
    || '<div class="empty"><strong>No match.</strong>Try a colour or a fabric — “olive”, “linen”, “polo”.</div>';
}

/* =========================================================
   EXPORT / IMPORT
   iOS can clear script-writable storage on sites it decides
   are dormant. This is the manual backup.
   ========================================================= */
async function exportLog() {
  const payload = JSON.stringify(
    { app: 'wardrobe', version: 1, exported: new Date().toISOString(), log }, null, 2);
  const filename = `wardrobe-log-${todayISO()}.json`;

  // Share sheet first: on an installed iOS PWA it is the only route that
  // reliably lands the file somewhere the user can find again.
  try {
    const file = new File([payload], filename, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Wardrobe log' });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled — not a failure
  }

  try {
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  } catch { /* fall through to the clipboard */ }

  try {
    await navigator.clipboard.writeText(payload);
    addNotice('exported', `${log.length} entries copied to the clipboard.`, 'Dismiss');
    renderNotices();
  } catch {
    addNotice('exportfail', 'Could not export the log on this browser.', 'Dismiss');
    renderNotices();
  }
}

function parseLog(text) {
  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? parsed : parsed?.log;
  if (!Array.isArray(entries)) throw new Error('no log array in that file');

  const clean = [];
  for (const entry of entries) {
    if (typeof entry?.outfitId !== 'number') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date ?? '')) continue;
    if (!outfitById.has(entry.outfitId)) continue;
    clean.push({
      outfitId: entry.outfitId,
      garments: Array.isArray(entry.garments) && entry.garments.length
        ? entry.garments.filter((g) => typeof g === 'string')
        : pieces(outfitById.get(entry.outfitId)),
      date: entry.date,
    });
  }
  if (!clean.length) throw new Error('no usable entries');
  return clean;
}

function importLog(text) {
  let incoming;
  try {
    incoming = parseLog(text);
  } catch (err) {
    addNotice('importfail', `Could not read that file — ${err.message}.`, 'Dismiss');
    renderNotices();
    return;
  }

  // Union by date; the file being restored wins any collision.
  const byDate = new Map(log.map((e) => [e.date, e]));
  for (const entry of incoming) byDate.set(entry.date, entry);
  log = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  write(KEY.LOG, log);
  const n = incoming.length;
  addNotice('imported', `Imported ${n} ${n === 1 ? 'entry' : 'entries'} — ${log.length} days on record.`, 'Dismiss');
  renderNotices();
  renderDeck();
  renderLog();
}

/* =========================================================
   EVENTS
   ========================================================= */
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  if (button.dataset.occasion) {
    prefs.occasion = button.dataset.occasion;
    write(KEY.PREFS, prefs);
    renderFilters();
    ensurePick();
    renderDeck();
    return;
  }

  if (button.dataset.temp) {
    prefs.temp = button.dataset.temp;
    write(KEY.PREFS, prefs);
    renderFilters();
    ensurePick();
    renderDeck();
    return;
  }

  if (button.dataset.wear !== undefined) {
    wear(Number(button.dataset.wear));
    return;
  }

  if (button.dataset.notice) {
    const notice = notices.find((n) => n.id === button.dataset.notice);
    if (notice?.id === 'update') { location.reload(); return; }
    notices = notices.filter((n) => n.id !== button.dataset.notice);
    renderNotices();
    return;
  }

  switch (button.id) {
    case 'reroll':
      ensurePick({ reroll: true });
      renderDeck();
      break;

    case 'export':
      exportLog();
      break;

    case 'import':
      el('importfile').click();
      break;

    case 'clearlog':
      if (!log.length) break;
      if (!confirm(`Delete all ${log.length} logged days? Export first if you want a copy.`)) break;
      log = [];
      write(KEY.LOG, log);
      renderDeck();
      renderLog();
      break;

    case 'v-today':
    case 'v-browse': {
      const today = button.id === 'v-today';
      el('v-today').setAttribute('aria-pressed', String(today));
      el('v-browse').setAttribute('aria-pressed', String(!today));
      el('view-today').hidden = !today;
      el('view-browse').hidden = today;
      if (!today) renderBrowse();
      break;
    }
  }
});

el('search').addEventListener('input', renderBrowse);

el('importfile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  importLog(await file.text());
  event.target.value = ''; // let the same file be picked again
});

/* A day can roll over while the app sits open on the home screen. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !pick) return;
  if (pick.date !== todayISO()) {
    ensurePick();
    renderDeck();
    renderLog();
    el('dateline').textContent = dateline();
  }
});

/* =========================================================
   SERVICE WORKER
   ========================================================= */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline install is best-effort */ });

  navigator.serviceWorker.addEventListener('message', (event) => {
    const type = event.data?.type;
    if (type === 'outfits-updated') {
      addNotice('update', 'outfits.json has changed.', 'Reload');
      renderNotices();
    } else if (type === 'app-updated') {
      addNotice('update', 'A new version is ready.', 'Reload');
      renderNotices();
    }
  });
}

/* =========================================================
   BOOT
   ========================================================= */
const dateline = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

async function boot() {
  el('dateline').textContent = dateline();

  try {
    const response = await fetch('./outfits.json');
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch {
    el('deck').innerHTML = `<div class="empty" style="grid-column:1/-1">
      <strong>Could not load outfits.json.</strong>
      Check the file is next to index.html and is valid JSON.</div>`;
    return;
  }

  outfitById = new Map(data.outfits.map((o) => [o.id, o]));
  colours = new Map(data.garments.map((g) => [g.name, g.hex]));

  storageOK = probeStorage();
  if (!storageOK) addNotice('storage', 'History is not saving in this browser.');

  log = read(KEY.LOG, []);
  if (!Array.isArray(log)) log = [];
  prefs = { ...prefs, ...read(KEY.PREFS, {}) };
  if (!OCCASIONS.some(([v]) => v === prefs.occasion)) prefs.occasion = 'office';
  if (!TEMPS.some(([v]) => v === prefs.temp)) prefs.temp = 'mild';

  const saved = read(KEY.PICK, null);
  if (saved?.date === todayISO()) pick = saved;

  renderNotices();
  renderFilters();
  ensurePick();
  renderDeck();
  renderLog();
  registerServiceWorker();
}

boot();
