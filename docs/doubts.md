# Doubts & Parked Issues

A running log of known problems / open doubts that are **on hold** — captured so they
aren't lost, not yet actioned. Each entry: what's wrong, why, and the fix options.

---

## 1. Birdcage over-reads the WHOLE PAIR on a shared-core semi (Type SM1) — ON HOLD (2026-09-01)

> ⚠️ **UPDATE (2026-09-01): stated areas + NDSS were REMOVED from the birdcage** — it is
> now derived purely from the dimensions. This **removes the safety net** that caught this
> bug (the NDSS cross-check) and **retires fix options A and B**, which relied on the stated
> per-house area / NDSS. The geometry problem below is UNCHANGED and now goes **uncaught**
> automatically — the remaining live fixes are **C** (schema tag: one dwelling vs whole
> building) and **D** (depth-read accuracy). This is a known trade-off of the change.

**Symptom.** For a Bloor-style semi-detached pair (`Type SM1`, plots 9 & 10), the GF
birdcage came out **109.404 m²** — roughly the *whole pair*, ~2× too big. One SM1 should be
~**52 m²** (gross).

**What the model reported** (no internal dims):
`overallWidthM = 14.727` (the WHOLE PAIR frontage), `overallDepthM = 8.428`, uniform wall
`327`. The engine faithfully did:
`width 14.727 − 0.327 − 0.327 = 14.073` × `depth 8.428 − 0.654 = 7.774` = **109.404**.

> Previously the NDSS cross-check flagged this (derived 109 vs NDSS 49.71 = +120%). With
> NDSS removed, **nothing auto-flags it now** — the whole-pair blowout would be stored at
> medium/low from the wall source alone. See the UPDATE banner.

**Three things went wrong (compounding):**

1. **Wrong depth read.** The plan has several overlapping vertical dimension chains
   (8878 / 8224 / 8428 / 6741…). The model grabbed **8428** (a different reference —
   8428 − 8224 = 204 mm ≈ a brick/overhang offset) when the building-line depth is
   **8224**. Pure read-accuracy error (picked the wrong dimension among many); no clean
   printed internal depth to prefer.
2. **Party wall not stripped.** Only the two OUTER walls were removed. There is a central
   party/cavity wall (`327`, "cavity barrier at party wall junction") not stripped. The
   birdcage schema has only TWO wall sides per axis — no concept of a *middle* party
   wall — so even reporting it wouldn't help today.
3. **The big one — whole pair vs one house.** `14727` is the PAIR frontage. The model
   reported the pair overall, not one house. Since the ÷dwellings division was removed
   (the Byron fix — there the model reported ONE house, so dividing wrongly halved it),
   a pair-frontage report now produces the whole-pair area. **The model is inconsistent:**
   Byron → one house (5253); SM1 → pair (14727). The engine can't know which, so neither
   "always divide" nor "never divide" is right.

**The correct per-house value** (all three fixed):
`((14.727 − 3×0.327) ÷ 2) × (8.224 − 2×0.327)` = `6.873 × 7.570` = **52.0 m²**.
The ÷2 (per-house) is the essential missing piece — the wall-strip fixes alone still give
the pair (~104).

**Root cause in one line.** This is a mirror semi with a **shared central core**
(two `5512` bodies + a `327|1034|327|1034|327` stair/bath core), so "one house's width"
isn't a clean single dimension → the model fell back to the most prominent overall
(14727 = the pair) and picked the wrong depth.

**Fix options (post-removal of stated areas / NDSS):**
- ~~**A — Anchor on the stated per-house area.**~~ **RETIRED** — stated areas are no longer read.
- ~~**B — Turn the NDSS cross-check into a correction.**~~ **RETIRED** — NDSS is no longer read.
- **C — Make the dimensional path unambiguous for pairs (the structural fix, now primary).**
  The model either reports ONE unit's footprint (hard on shared-core plans), or **tags** the
  overall as *one dwelling* vs *whole building/pair* — then the engine strips the party
  wall(s) and divides for a whole-building report. Resolves the Byron-vs-SM1 inconsistency
  at the root, but needs a schema field + reliable model tagging.
- **D — Depth read accuracy.** Prompt guidance to read the building-line (brick-to-brick)
  depth and prefer a printed internal span.

**Recommended:** C is now the near-term fix (there is no stated-area anchor to fall back on),
supported by D. Optionally **measure first** — how often does the model report the
whole-pair overall vs one-house overall across the packs?
