/* =========================================================================
   scheduler.js — the selection algorithm.

   Imported unchanged by both the app (browser) and tools/simulate.js (node),
   so the coverage simulation tests the code that actually ships. No DOM, no
   storage, no globals: everything comes in as arguments.

     score(outfit) =
         W_COVER   * (maxWears - wears[outfit])
       - W_RECENT  * recencyPenalty(outfit)
       - W_GARMENT * Σ garmentRecency(piece)
       + W_JITTER  * random()
   ========================================================================= */

export const WEIGHTS = { COVER: 30, RECENT: 1, GARMENT: 1, JITTER: 20 };

/* The three pieces that make up an outfit. Shoes are not scored — there are
   only three pairs, so cooling them down would just fight the real signal.
   Outerwear is not here by design, and must not be added. */
export const pieces = (outfit) => [outfit.layer, outfit.top, outfit.bottom].filter(Boolean);

/* Hard block on the last ~10 days, tapering out to a month. */
export function recencyPenalty(daysAgo) {
  if (daysAgo <= 7) return 150;
  if (daysAgo <= 14) return 70;
  if (daysAgo <= 28) return 25;
  return 0;
}

/* Stops a shirt reappearing on Tuesday inside a different combination. */
export function garmentRecency(daysAgo) {
  if (daysAgo <= 1) return 120;
  if (daysAgo <= 3) return 60;
  if (daysAgo <= 6) return 25;
  if (daysAgo <= 10) return 8;
  return 0;
}

/* ---------- dates -------------------------------------------------------
   Everything is a 'YYYY-MM-DD' string turned into a day index. Parsing via
   Date.UTC keeps the arithmetic clear of timezones and DST. */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function todayISO(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/* ---------- reading the log --------------------------------------------
   One pass over the whole log builds every lookup the scoring needs.
   Log entries are { outfitId, garments: [name], date: 'YYYY-MM-DD' }. */
export function summarise(log, today) {
  const now = dayNumber(today);
  const wears = new Map();       // outfitId -> lifetime count
  const lastOutfit = new Map();  // outfitId -> days since last worn
  const lastGarment = new Map(); // garment  -> days since last worn

  for (const entry of log) {
    const ago = now - dayNumber(entry.date);
    if (ago < 0) continue; // a clock change can leave entries in the future

    wears.set(entry.outfitId, (wears.get(entry.outfitId) || 0) + 1);

    const seenOutfit = lastOutfit.get(entry.outfitId);
    if (seenOutfit === undefined || ago < seenOutfit) lastOutfit.set(entry.outfitId, ago);

    for (const garment of entry.garments) {
      const seen = lastGarment.get(garment);
      if (seen === undefined || ago < seen) lastGarment.set(garment, ago);
    }
  }
  return { wears, lastOutfit, lastGarment };
}

/* ---------- scoring ----------------------------------------------------- */
export function scoreOutfit(outfit, stats, maxWears, random) {
  const wears = stats.wears.get(outfit.id) || 0;

  const outfitAgo = stats.lastOutfit.get(outfit.id);
  const recent = outfitAgo === undefined ? 0 : recencyPenalty(outfitAgo);

  let garment = 0;
  for (const piece of pieces(outfit)) {
    const ago = stats.lastGarment.get(piece);
    if (ago !== undefined) garment += garmentRecency(ago);
  }

  return WEIGHTS.COVER * (maxWears - wears)
       - WEIGHTS.RECENT * recent
       - WEIGHTS.GARMENT * garment
       + WEIGHTS.JITTER * random();
}

/* ---------- the pool ---------------------------------------------------- */
export const poolFor = (outfits, occasion, temp) =>
  outfits.filter((o) => o.occasions.includes(occasion) && o.temps.includes(temp));

/* ---------- the draw ----------------------------------------------------
   Top-scoring outfit, then the best second that shares no garment with it.
   `exclude` is what "Show me two others" passes in, so a reroll is actually
   two others rather than a reshuffle that can hand back the same pair. */
export function choosePair(pool, log, today, random, exclude = []) {
  if (!pool.length) return [];

  const skip = new Set(exclude);
  let candidates = pool.filter((o) => !skip.has(o.id));
  if (!candidates.length) candidates = pool; // pool too small to exclude anything

  const stats = summarise(log, today);
  let maxWears = 0;
  for (const outfit of candidates) {
    maxWears = Math.max(maxWears, stats.wears.get(outfit.id) || 0);
  }

  const scored = candidates
    .map((outfit) => ({ outfit, score: scoreOutfit(outfit, stats, maxWears, random) }))
    .sort((a, b) => b.score - a.score);

  const first = scored[0].outfit;
  const worn = new Set(pieces(first));
  const second = scored.slice(1).find((c) => !pieces(c.outfit).some((p) => worn.has(p)));

  /* No disjoint partner exists in this pool — one honest card beats two that
     are the same outfit wearing a different bottom. */
  return second ? [first, second.outfit] : [first];
}

/* ---------- deterministic randomness ------------------------------------
   Seeding on the date means the day's pick survives a reload even when
   localStorage is unavailable, and makes the simulation reproducible. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
