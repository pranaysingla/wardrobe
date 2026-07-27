# Wardrobe

Phone-first outfit picker. Open it in the morning, see two outfits, tap one, done.

Static single-page PWA — no backend, no database, no accounts, no build step.
Vanilla HTML/CSS/JS with native ES modules; the files you edit are the files that ship.

```
index.html      shell
styles.css
app.js          screens, storage, the daily lock
scheduler.js    the selection algorithm (shared with the simulation)
outfits.json    the source of truth
manifest.json   installability
sw.js           offline
icons/          generated, see tools/make-icons.js
tools/          validate.js · simulate.js · make-icons.js
```

## Run it locally

```bash
python3 -m http.server 8123
```

Then open <http://localhost:8123>. It needs to be served over HTTP, not opened as a
`file://` path — ES modules and the service worker both require an origin.

## Deploy to GitHub Pages

The laptop is used once. After that the phone is the only device involved.

```bash
git init && git add -A && git commit -m "Wardrobe"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**. About a minute
later the site is live at `https://<you>.github.io/<repo>/`.

Every path in this project is relative, so it works from that subdirectory with no
configuration. `.nojekyll` keeps Pages from running the files through Jekyll.

## Install it on the iPhone

Open the Pages URL in **Safari** — only Safari can install PWAs on iOS — then
**Share → Add to Home Screen**.

That produces a real standalone app rather than a bookmark: `manifest.json` declares
`"display": "standalone"` with 192px and 512px icons, `index.html` carries
`apple-mobile-web-app-capable` and an `apple-touch-icon`, and the service worker
precaches the shell so it opens instantly with no signal. The layout respects
`env(safe-area-inset-*)`, so nothing hides under the notch in standalone mode.

## Using it

There is one screen you use daily and one you use occasionally.

**Today.** Set the two filter rows — where you're going, and what it's like outside.
Two cards appear. Read them as colour first: the bands are the layer, top and bottom in
their real proportions, which is faster than reading three garment names at arm's length.
The names sit underneath, then the shoes.

Tap **Wear this** on the one you're wearing. That is the only input the app ever needs —
it's what teaches the picker what to avoid. Tapped the wrong card? Tap the other one and
it replaces the entry; tap the green **Worn today** button again to undo it entirely.
Only one outfit is recorded per day.

The two cards **stay the same all day**. Close the app, reopen it after breakfast, same
two outfits — that's deliberate, so the decision stays made. **Show me two others**
rerolls when you genuinely don't fancy either, and it excludes the pair you were just
shown. Nothing reshuffles on its own.

Changing a filter draws a fresh pair for that pool, and that pair is then locked for the
day too.

**Browse** answers a different question: *what does this shirt go with?* Type `olive` and
you get every outfit containing an olive garment. Search runs over garment names, so
`linen`, `polo`, `cargo` and `navy` all work. Nothing here affects the picker.

Under Today, **Last worn** shows the recent history, with **Export log** / **Import log**
for backups (see below).

## Editing the wardrobe from the phone

`outfits.json` is a plain checked-in file — adding an outfit is one line in a text
editor, not a UI flow:

```json
{ "id": 127, "layer": null, "top": "Sage polo", "bottom": "Khaki chinos",
  "shoes": "New Balance 2002R", "occasions": ["office"], "temps": ["warm"], "note": null }
```

GitHub's mobile web editor can amend the file directly and the commit redeploys the
site, so this never needs a laptop either. `ids` must stay contiguous from 0.

The service worker treats `outfits.json` as **stale-while-revalidate** rather than
cache-first: you still get the cached copy instantly and offline, but a fresh copy is
fetched in the background and the app offers a **Reload** when the file has actually
changed. Cache-first would mean a phone edit never arrived.

> **Editing the code, not the data?** The shell is cache-first, so bump `VERSION` in
> `sw.js` in the same commit. Without that, installed phones keep serving the old
> `app.js` and `styles.css` from cache. Changing `outfits.json` alone needs no bump.

After editing, re-run the checks:

```bash
node tools/validate.js
```

It asserts referential integrity, contiguous ids, no duplicate combinations, that no
outerwear has leaked into an outfit, and **the coverage floor — every garment in at
least 2 outfits**.

## The selection algorithm

`scheduler.js`, imported unchanged by both the app and the simulation, so the test
exercises the code that actually ships.

```
score(outfit) =
    W_COVER   * (maxWears - wears[outfit])   // walks the whole closet
  - W_RECENT  * recencyPenalty(outfit)       // hard block on the last ~10 days
  - W_GARMENT * Σ garmentRecency(piece)      // no reusing a shirt in a new combination
  + W_JITTER  * random()                     // not a fixed rota
```

`W_COVER 30, W_RECENT 1, W_GARMENT 1, W_JITTER 20`. Top-scoring outfit first, then the
best-scoring second that **shares no garment** with it.

**The day's pick is locked to the day.** Reopening gives the same two outfits;
`Show me two others` rerolls deliberately and excludes the pair you were just shown.
The seed is the date, so the pick is stable across reloads even if `localStorage` is
unavailable. Nothing reshuffles on load.

Every `Wear this` logs `{ outfitId, garments[], date }` — one entry per day, and
tapping the other card the same day replaces it.

### Verifying the coverage claim

```bash
node tools/simulate.js
```

200 synthetic days against each of the 12 occasion/temperature filters, asserting every
eligible outfit gets worn at least once and the distribution stays roughly flat. Results
at the current weights:

| | |
|---|---|
| Outfits never worn | **0**, in every filter |
| Worst spread (max/min wears) | **1.67** — `out/mild`, min 3 max 5 at a mean of 4.0 |
| Coefficient of variation | 0.02 – 0.16 |
| Days with no garment-disjoint second card | **0** of 4,800 |

The worst spread is integer quantisation at a mean of 4, not skew. If a future data
change breaks this, the script fails and tells you to raise `W_COVER`.

### How strictly does it rotate?

Near-strictly, but not by guarantee. Measured from an empty log, days taken before every
outfit in a pool has been worn once, against the ideal (the pool size) and against what
uniform random drawing would cost:

| filter | pool | days to see all | ideal | random-draw baseline |
|---|---|---|---|---|
| `salsa/cold` | 8 | 8 | 8 | 22 |
| `date/cold` | 11 | 11 | 11 | 33 |
| `office/mild` | 24 | 27 | 24 | 91 |
| `out/warm` | 47 | 49 | 47 | 209 |
| `out/mild` | 50 | 59 | 50 | 225 |

So roughly 3–4× better than random, and within ~10% of a perfect rota on the big pools.

It is not exact, and that is the `W_GARMENT` term doing its job: an unworn outfit that
shares a shirt with something worn two days ago gets held back, and a well-rested outfit
you have already worn goes out instead. Trading a handful of early repeats for never
seeing the same shirt twice in a week is the intended bargain.

If you would rather have the strict rota, raising `W_COVER` to ~400 makes the **left
card** an exact sweep — measured over all 12 filters, early repeats from the top-ranked
pick go from 47 to 0. The **right card** keeps a small residue (10 across all filters,
and no lower at `W_COVER` 1000), because the no-shared-garment rule outranks coverage:
when every unworn outfit shares a piece with the left card, the second slot has to fall
back to something already worn. That residue only ever bites if you tap the right card.

## Backing up the wear log

The log lives in `localStorage`. **Export log** writes it out as JSON (via the iOS share
sheet when available, otherwise a download, otherwise the clipboard); **Import log**
reads it back, merging by date. iOS can clear script-writable storage on sites it
decides are dormant — daily use should keep it alive, but take a backup occasionally.

## Scope

Jackets and coats are deliberately **out of scope**. They sit in a separate `outerwear`
key and appear in no outfit; `validate.js` fails if one leaks into the engine. Grabbing a
coat on the way out is not a decision worth automating.

Not wanted, ever: social features, shopping recommendations, resale integration, an AI
stylist chat, avatar try-on.

## Known data issues

- Garment hex values were inferred from written descriptions, not photographs. Several
  are wrong; `Taupe maroon polo` and `Light black jeans` are the most suspect. Correcting
  them by eye against the actual garments materially improves the cards.
- `salsa` + `cold` is the thinnest pool at 8 outfits. That is a wardrobe gap, not a bug.
- If you add garments later, run `validate.js` rather than assuming coverage balanced out.

## Not built yet

Deliberately left for after the core: real weather from Open-Meteo (<10°C cold, 10–17
mild, >17 warm), per-garment photos as IndexedDB blobs under the colour bands, a laundry
flag, and a least-worn wear-count view.
