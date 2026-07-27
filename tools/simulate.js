/* =========================================================================
   tools/simulate.js — proves the coverage claim.

   Runs 200 synthetic days against every occasion/temperature filter, wearing
   one card a day, and asserts:

     1. every outfit in the pool got worn at least once
     2. the wear-count distribution is roughly flat (max/min within 2x)

   If this fails, raise W_COVER in scheduler.js.

     node tools/simulate.js
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WEIGHTS, pieces, poolFor, choosePair, mulberry32, hashSeed, dayNumber,
} from '../scheduler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'outfits.json'), 'utf8'));

const DAYS = 200;
const START = '2026-01-01';
const MAX_SPREAD = 2.0; // max wears / min wears must stay under this

const isoFromDayNumber = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

/* ---------- one run -----------------------------------------------------
   `secondCardOdds` is how often the simulated wearer taps the right-hand
   card instead of the left. 0 is the strict test of the top-ranked pick. */
function run(pool, seed, secondCardOdds) {
  const random = mulberry32(hashSeed(seed));
  const log = [];
  const day0 = dayNumber(START);
  let singleCardDays = 0;
  let overlapDays = 0;

  for (let d = 0; d < DAYS; d++) {
    const today = isoFromDayNumber(day0 + d);
    const cards = choosePair(pool, log, today, random);
    if (!cards.length) break;
    if (cards.length === 1) singleCardDays++;
    else {
      const a = new Set(pieces(cards[0]));
      if (pieces(cards[1]).some((p) => a.has(p))) overlapDays++;
    }

    const chosen = cards.length > 1 && random() < secondCardOdds ? cards[1] : cards[0];
    log.push({ outfitId: chosen.id, garments: pieces(chosen), date: today });
  }

  const wears = new Map(pool.map((o) => [o.id, 0]));
  for (const entry of log) wears.set(entry.outfitId, wears.get(entry.outfitId) + 1);

  const counts = [...wears.values()];
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length);

  /* Garment-level coverage: every garment reachable in this pool should also
     have been worn, which is the thing the coverage floor of 2 is protecting. */
  const reachable = new Set();
  for (const o of pool) for (const p of pieces(o)) reachable.add(p);
  const wornGarments = new Set();
  for (const entry of log) for (const g of entry.garments) wornGarments.add(g);
  const missedGarments = [...reachable].filter((g) => !wornGarments.has(g));

  return {
    size: pool.length,
    min, max, mean, cv: mean ? sd / mean : 0,
    spread: min === 0 ? Infinity : max / min,
    unworn: [...wears].filter(([, c]) => c === 0).map(([id]) => id),
    missedGarments,
    singleCardDays,
    overlapDays,
  };
}

/* ---------- report ------------------------------------------------------ */
const modes = [
  { label: 'always the left card', odds: 0 },
  { label: 'either card, 50/50  ', odds: 0.5 },
];

console.log(`Coverage simulation — ${DAYS} days per filter, from ${START}`);
console.log(`Weights: COVER ${WEIGHTS.COVER}  RECENT ${WEIGHTS.RECENT}  GARMENT ${WEIGHTS.GARMENT}  JITTER ${WEIGHTS.JITTER}\n`);

let failures = 0;
let overlapTotal = 0;
let singleTotal = 0;

for (const mode of modes) {
  console.log(`── wearer picks ${mode.label} ──────────────────────────────────`);
  console.log('filter              pool   min   max   mean    cv   spread   result');

  for (const occasion of data.meta.occasions) {
    for (const temp of data.meta.temps) {
      const pool = poolFor(data.outfits, occasion, temp);
      if (!pool.length) {
        console.log(`${`${occasion}/${temp}`.padEnd(18)}      0     —     —      —     —        — empty pool`);
        continue;
      }
      const r = run(pool, `${occasion}|${temp}|${mode.odds}`, mode.odds);
      overlapTotal += r.overlapDays;
      singleTotal += r.singleCardDays;

      const problems = [];
      if (r.unworn.length) problems.push(`${r.unworn.length} never worn (${r.unworn.slice(0, 6).join(', ')})`);
      if (r.spread > MAX_SPREAD) problems.push(`spread ${r.spread.toFixed(2)} > ${MAX_SPREAD}`);
      if (r.missedGarments.length) problems.push(`${r.missedGarments.length} garments never worn`);
      if (problems.length) failures++;

      console.log(
        `${`${occasion}/${temp}`.padEnd(18)}` +
        `${String(r.size).padStart(5)}` +
        `${String(r.min).padStart(6)}` +
        `${String(r.max).padStart(6)}` +
        `${r.mean.toFixed(1).padStart(7)}` +
        `${r.cv.toFixed(2).padStart(6)}` +
        `${(r.spread === Infinity ? '∞' : r.spread.toFixed(2)).padStart(9)}` +
        `   ${problems.length ? 'FAIL — ' + problems.join('; ') : 'ok'}`
      );
    }
  }
  console.log('');
}

console.log(`Days where no garment-disjoint second card existed: ${singleTotal}`);
console.log(`Days where the two cards shared a garment:          ${overlapTotal}`);

if (failures) {
  console.error(`\n${failures} filter(s) failed. Raise W_COVER in scheduler.js and re-run.`);
  process.exit(1);
}
console.log('\nAll filters covered every outfit, and stayed within the flatness bound.');
