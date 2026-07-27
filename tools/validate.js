/* =========================================================================
   tools/validate.js — the assertions outfits.json has to keep passing.

   Run this after editing the data, and after any script that adds or prunes
   combinations. The coverage floor is the one that matters: every garment in
   at least 2 outfits, or the picker can strand a piece.

     node tools/validate.js
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pieces, poolFor } from '../scheduler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'outfits.json'), 'utf8'));

const FLOOR = data.meta.coverage_floor ?? 2;
const problems = [];
const fail = (msg) => problems.push(msg);

const garments = new Map(data.garments.map((g) => [g.name, g]));
const outerwear = new Set(data.outerwear.map((g) => g.name));
const shoes = new Set(data.meta.shoes);
const occasions = new Set(data.meta.occasions);
const temps = new Set(data.meta.temps);

/* ---------- garments ---------------------------------------------------- */
const seenNames = new Set();
for (const g of data.garments) {
  if (seenNames.has(g.name)) fail(`duplicate garment name: ${g.name}`);
  seenNames.add(g.name);
  if (!/^#[0-9a-fA-F]{6}$/.test(g.hex)) fail(`garment "${g.name}" has a bad hex: ${g.hex}`);
}
for (const g of data.outerwear) {
  if (garments.has(g.name)) fail(`"${g.name}" is listed as both a garment and outerwear`);
}

/* ---------- outfits ----------------------------------------------------- */
const wearCount = new Map(data.garments.map((g) => [g.name, 0]));
const combos = new Map();

data.outfits.forEach((o, index) => {
  const where = `outfit ${o.id}`;
  if (o.id !== index) fail(`${where} is out of order — ids must run 0..n-1 in file order`);
  if (!o.top || !o.bottom) fail(`${where} is missing a top or a bottom`);

  for (const piece of pieces(o)) {
    if (outerwear.has(piece)) fail(`${where} uses outerwear "${piece}" — jackets stay out of the engine`);
    else if (!garments.has(piece)) fail(`${where} references unknown garment "${piece}"`);
    else wearCount.set(piece, wearCount.get(piece) + 1);
  }

  if (!shoes.has(o.shoes)) fail(`${where} has unknown shoes "${o.shoes}"`);
  if (!o.occasions?.length) fail(`${where} has no occasions`);
  if (!o.temps?.length) fail(`${where} has no temperatures`);
  for (const x of o.occasions ?? []) if (!occasions.has(x)) fail(`${where} has unknown occasion "${x}"`);
  for (const x of o.temps ?? []) if (!temps.has(x)) fail(`${where} has unknown temperature "${x}"`);

  const key = [o.layer, o.top, o.bottom, o.shoes].join(' | ');
  if (combos.has(key)) fail(`${where} duplicates outfit ${combos.get(key)}: ${key}`);
  combos.set(key, o.id);
});

/* ---------- the coverage floor ------------------------------------------ */
const below = [...wearCount].filter(([, n]) => n < FLOOR);
for (const [name, n] of below) {
  fail(`"${name}" appears in ${n} outfit${n === 1 ? '' : 's'} — the floor is ${FLOOR}`);
}

/* ---------- meta counts ------------------------------------------------- */
if (data.meta.outfit_count !== data.outfits.length) {
  fail(`meta.outfit_count says ${data.meta.outfit_count}, file has ${data.outfits.length}`);
}
if (data.meta.garment_count !== data.garments.length) {
  fail(`meta.garment_count says ${data.meta.garment_count}, file has ${data.garments.length}`);
}

/* ---------- every filter reachable -------------------------------------- */
const thin = [];
for (const occasion of data.meta.occasions) {
  for (const temp of data.meta.temps) {
    const n = poolFor(data.outfits, occasion, temp).length;
    if (n === 0) fail(`no outfits at all for ${occasion}/${temp}`);
    else if (n < 8) thin.push(`${occasion}/${temp}: ${n}`);
  }
}

/* ---------- report ------------------------------------------------------ */
const histogram = {};
for (const [, n] of wearCount) histogram[n] = (histogram[n] || 0) + 1;

console.log(`${data.outfits.length} outfits, ${data.garments.length} garments, ${data.outerwear.length} outerwear (excluded).`);
console.log(`Garments by number of outfits: ${
  Object.keys(histogram).map(Number).sort((a, b) => a - b).map((k) => `${k}→${histogram[k]}`).join('  ')
}`);
if (thin.length) console.log(`Thin pools (fine, but worth knowing): ${thin.join(', ')}`);

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`\nAll checks passed. Coverage floor of ${FLOOR} holds.`);
