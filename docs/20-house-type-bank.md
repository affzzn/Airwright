# 20 · House-Type Bank — canonical spec

**Status: BUILT (2026-09-23), on branch `feat/house-type-bank`.** P0–P3 done and
verified end-to-end (373 tests incl. 18 bank unit tests; typecheck + lint + prod
build clean; a real-DB round-trip of write → alias-learn → change→new-version →
match → skip-read reuse → build-type isolation, all asserted + cleaned up). Only
**P4 (Excel seed of Laura's Excel bank)** remains — gated on her file. The canonical
design; this section records what shipped against it.

Companion reading: `docs/11` (take-off engine), `docs/13` (extraction playbook),
`docs/15` (pricing), `ARCHITECTURE.md` (the take-off/pricing seam). The bank plugs
in at the **take-off layer** and leaves pricing/quotes untouched.

---

## 0. What this is, in one line

Turn Laura's personal Excel "bank" of house types into **shared, company-owned
software**: every confirmed take-off is saved against the client + house type, and
when a repeat tender arrives the prior measurements are reused instead of rebuilt by
hand — with any drawing change flagged for a quick sense-check.

**House-build only (TRADITIONAL + TIMBER_FRAME). Never Construction.** Construction
is a separate manual island (`docs/19`) with no reusable repeating "type" — the bank
does not touch it.

### The value case
Most of Airwright's work is repeat clients using the same standard types (Miller
Denton, Bloor Aspen…), yet each is re-measured and re-reviewed by hand even when the
dimensions are already known. This removes that rebuild admin and de-risks a key
person: the knowledge becomes the company's, not one spreadsheet on one laptop.

### Acceptance criteria (from the brief)
1. A repeat house type is **retrieved and applied without a manual rebuild**.
2. The system **flags when a drawing differs** from the stored version.
3. The bank is **shared and owned by the company**, not held in one person's spreadsheet.

---

## 1. The one principle that makes it correct

**A house type's true identity is its geometry, not its name.** The whole platform
already runs on "the drawing is truth; title-block text is noise." Names and codes
drift across tenders, clients, revisions and handings — but a Denton's walls,
storeys, height, birdcage areas and apex count *are* the Denton.

So the bank **matches on measurements**, and treats name/code only as a cheap hint
that surfaces a candidate. And — this is a human-in-the-loop tool — the matcher
**never decides** that two types are the same. It **proposes** a candidate with the
evidence and the field-by-field diff; the estimator confirms. (Same discipline as the
rest of the app: nothing uncertain is guessed.)

---

## 2. How it fits the existing model

Today `HouseType` + `Takeoff` are **per-project** (`prisma/schema.prisma`): every
tender re-creates them from scratch. `HouseType.clientId` exists but nothing reads
across projects — a latent hook.

The bank is a thin **client-owned layer above**:

- **Bank entry = the "class"** — the reusable measured identity of a type ("Miller Denton").
- **Project `HouseType` / `Takeoff` = an "instance"** — this tender's copy, with its
  own plots / configuration / render / quote.

The single integration seam is `takeoffInputFromStored(measurements, walls, warnings,
config, buildSystem)` (`src/lib/takeoff/fromStored.ts`). Materialise a bank snapshot
into a project `Takeoff` and `buildTakeoff` → `priceTakeoffLine` → quote/Excel all run
**unchanged**. That is the whole reason this is a low-risk build: nothing downstream
of the take-off changes.

---

## 3. Data model (2 new tables + 1 link column — minimal, additive)

No mirror of the measurement/wall tables. The snapshot is JSON — in-idiom here
(`Takeoff.warnings`, `Extraction.rawOutput`, frozen `QuoteLineItem`s all work this way).

### `HouseTypeBankEntry` — the library card (identity)
- `clientId` — owner (the housebuilder, e.g. Miller). Bank is scoped per client.
- `buildType` — TRADITIONAL | TIMBER_FRAME.
- `canonicalName` ("Denton"), `canonicalCode` ("L363", nullable).
- `matchKey` — normalised name stem used for candidate lookup.
- `aliases String[]` — every alternate name/code **confirmed** as this type
  ("Denton XYZ", "DENTON-LH", superseded codes…). Learned on confirmation (§5).
- `currentVersionId` — pointer to the live reference snapshot.
- `status` (ACTIVE | ARCHIVED), `timesReused Int`, `createdById`, timestamps.
- Soft-unique on `(clientId, canonicalCode, buildType)` **when a code is present**
  (codes are the reliable id); names are never hard-unique — dedup is by matcher +
  human merge (§7), not a DB constraint.

### `HouseTypeBankVersion` — a frozen snapshot of one confirmed take-off
- `bankEntryId`, `version Int` (auto-increment per entry).
- `snapshot Json` — the frozen **observables**, in exactly the shape
  `takeoffInputFromStored` reads (§3.1). **Observables only — never a price.**
- `geometryFingerprint String` — stable hash of the rounded observables, for cheap
  change-detection.
- `sourceTakeoffId?` / `sourceProjectId?` — provenance, `onDelete: SetNull`. The
  snapshot **survives** if the source project is deleted (that is the point).
- `note String?` ("Rev B — front 8.20→8.45"), `confirmedById`, `confirmedAt`.

### `HouseType` (existing) — add the instance link
- `bankEntryId String?` (nullable, `onDelete: SetNull`).
- `bankMatchState` enum: NEW | MATCHED | CHANGED | DETACHED.

### 3.1 The snapshot shape (frozen payload)
Mirror the inputs of `takeoffInputFromStored` so reuse is a straight deserialise:
- measurement values: `STOREYS`, `HEIGHT_TO_SOFFIT`, `GABLE_QTY`, `RENDER_LENGTH`,
  `BIRDCAGE_GF_M2` / `_FF_M2` / `_SF_M2`, `LOW_LEVEL_QTY`, `CORNER_COUNT`
- `wallSegments[]`: `{ position, lengthM }`
- categoricals: `roofType`, `roomInRoof`, `rendered`, `chimney`, `structure`,
  `dwellingsWide`, per-face `elevations[]`
- `configuration` (the house-type build form)
- `buildType`

**Not stored:** prices, plots, per-plot config/render, confidences. Prices come from
rates at quote time (rates change; a stored price would rot). Per-plot facts belong to
the instance, not the class.

---

## 4. The matcher (`src/lib/bank/match.ts`, pure + unit-tested)

Scope every search to **same client + same buildType**. Two signals.

### Signal 1 — name/code (cheap; generates candidates)
- exact hit on an `alias` or on `canonicalCode` → **strong**
- normalised name stem match: prefix relationship, OR token-set Jaccard ≥ ~0.6, OR
  Levenshtein ratio ≥ ~0.85 → **candidate**
- reuse `cleanHouseTypeName` / `cleanHouseTypeCode` (`src/lib/extract/houseTypeIdentity.ts`);
  extend the normaliser to strip handing (lh/rh/mirror/reverse), config
  (det/semi/end/mid) and garage tokens before comparing.

### Signal 2 — geometry (authoritative; arbitrates)
Compare the new take-off's observables to the candidate snapshot, field by field →
a verdict:
- **IDENTICAL** — all fields within tolerance.
- **CHANGED** — matches but ≥1 field beyond tolerance → *the "drawing differs" flag*,
  carrying the exact per-field diff (old→new).
- **DIFFERENT** — geometry clearly unlike → not the same type despite the name.

Tolerances (wall ±?, birdcage ±?%, height) are **an open Colin question** — reuse the
same configurable sign-off tolerance flagged in `docs/11 §8 #11`; do **not** invent a
number. Exact-match fields: storeys, apex count, corner count, roof type, structure.

### The decision table (what the estimator sees)
| Name signal | Geometry | Proposed | UI |
|---|---|---|---|
| strong | IDENTICAL | **Reuse** | "This is Miller Denton (confirmed 12 Aug, Oadby). Apply?" → one click |
| strong | CHANGED | **Same, drawing changed** | "Looks like Denton but differs: front 8.20→8.45, birdcage GF 34.9→36.1. Sense-check → apply / save as new version." |
| strong name | DIFFERENT | **Ambiguous** | "Named like Denton but measurements differ a lot — redesign or different house? You decide." |
| weak / none | — | **New** | "No match — new type. Added to the bank when confirmed." |
| several | — | **Choose** | ranked candidates, each with its diff |

Every row is a **proposal**; the estimator confirms. Nothing auto-applies.

---

## 5. Denton vs Denton-XYZ — the resolution mechanism

The hard case: house-type names differ slightly across tenders/clients, and
"Denton-XYZ" may or may not be a "Denton". Resolution:

1. New type reads as "Denton XYZ". Bank has "Denton" (Miller) → name stem matches →
   candidate surfaced.
2. **Geometry decides, and the estimator confirms:**
   - identical / changed → "same type" → link to the Denton entry (new version if
     changed) and **record "Denton XYZ" as an alias**.
   - genuinely different → "separate type" → create a new entry (optionally a
     `not-same-as` marker so it stops re-proposing).
3. **The bank learns the alias on confirmation.** Next time "Denton XYZ" appears it is
   an *exact* alias hit — no fuzzy needed, instantly right.

So the fuzzy string match only has to be good enough to surface a candidate **once**;
geometry + a human decide; the alias makes it permanent. Worst case is a one-click
rejection — it can **never silently get it wrong**. (Same alias-learning shape already
proven in Construction "Draft from enquiry", `src/lib/construction/draftFromScope.ts`.)

---

## 6. Touchpoints & flows (human-in-the-loop throughout)

### 6a. Write on confirm — AUTOMATIC (decided 2026-09-23)
`confirmTakeoff` (`src/server/actions/takeoff.ts`) already locks the take-off and
fires `ensureDefaultPlot`. Add: **create-or-new-version the bank entry automatically**
on confirm. The match was resolved during review, so confirm just freezes the snapshot
+ learns any alias. A manual **"don't bank this"** escape is available. TRADITIONAL +
TF only; Construction confirm paths never call it.

### 6b. Match on review
After extraction, a small **"Bank" panel** on the review screen (`src/app/extractions/[id]`)
shows the proposal + diff. This is where the "rebuild" collapses into a *glance at
what changed* — the real admin saving. Non-blocking.

### 6c. Reuse into a quote — SKIP-READ BY DEFAULT (decided 2026-09-23)
Default: on a confident name/code match, **pull the bank take-off without re-reading
the drawing** — materialise a `Takeoff` from the snapshot into the project → confirm →
`ensureDefaultPlot` → priced. This is the "drops into the quote in seconds" path and
the strongest expression of criterion #1.

**Safeguard (mandatory, to keep criterion #2 true).** A skip-read instance is marked
**"reused from bank — not yet verified against this drawing."** When a drawing for that
type *is* present in the pack, surface a prominent, one-click **"Verify against
drawing"** that runs the normal extract + geometry-diff and flags any change. Skip-read
buys speed; the verify action preserves change-detection on demand rather than on every
repeat.

Both entry points exist: skip-read (default, fast) and the auto-extract-then-diff route
(when the estimator wants the fresh read up front, or no bank match is confident).

---

## 7. The `/bank` browse UI (monochrome, existing design system)

- **List:** client · name · code · buildType · storeys · perimeter · #versions · last
  confirmed · times reused. Search + filter by client / buildType.
- **Entry detail:** current confirmed take-off (read-only, same review layout) ·
  version history with diffs · aliases (editable) · where-used (projects/plots) ·
  source-drawing link.
- **Actions:** rename / set canonical · edit aliases · set current version · **merge
  two entries** (duplicates will happen; fold aliases + versions, relink instances —
  precedent: `scripts/merge-duplicate-house-types.mts`) · archive.

---

## 8. Explicitly OUT of scope (keep it minimal)

- ❌ Cross-client matching — scope to the client (different builders ≠ same type).
- ❌ ML / embedding similarity — plain normalised-string + geometry is enough and
  *explainable* (trust matters more than cleverness in a human-in-the-loop tool).
- ❌ Auto-merge / auto-apply-without-a-glance — always a human confirm.
- ❌ Mirror measurement/wall tables — JSON snapshot only.
- ❌ Storing prices in the bank — observables only.
- ❌ Touching the pricing/quote engine — plug in at the take-off seam.
- ❌ Building the Excel seed before Laura's file is in hand — map her real columns,
  don't guess the format.

---

## 9. Open items (do not guess)

1. **Change-detection tolerance** (wall ±?, birdcage ±?%, height) — reuse the open
   sign-off tolerance from `docs/11 §8 #11`; flag until Colin gives it.
2. **Excel seed of Laura's bank** — needs her actual spreadsheet to map columns →
   measurement keys. A later phase, gated on the file (house-build only).
3. **`not-same-as` negative markers** — confirm whether to persist a rejected match so
   it stops re-proposing (nice-to-have; decide during P2).

---

## 10. Decisions locked (2026-09-23)

- **Reuse default = skip-read** (pull from bank without re-reading), with the §6c
  "Verify against drawing" safeguard so drawing changes are still catchable on demand.
- **Write-to-bank = automatic on confirm**, with a "don't bank this" escape.

---

## 11. Phasing / what shipped

- **P0 — foundations. ✅** Migration `house_type_bank` (additive: enum `BankMatchState`,
  models `HouseTypeBankEntry` + `HouseTypeBankVersion`, `HouseType.bankEntryId` +
  `bankMatchState`). Pure matcher `src/lib/bank/{snapshot,normalize,match}.ts` +
  `bank.test.ts` (18 tests). Snapshot mirrors `takeoffInputFromStored`; fingerprint
  ignores sub-tolerance jitter.
- **P1 — write path. ✅** `src/server/bank.ts saveTakeoffToBank` — automatic on confirm
  (hooked in `confirmTakeoff`, best-effort), idempotent on fingerprint, learns aliases,
  guards the unique code. `forceEntryId` / `markNew` overrides for the panel.
- **P2 — match + reuse. ✅** Review Bank strip (`bank-match-panel.tsx`, via
  `ReviewWorkspace.bankPanel`): linked state / proposal + drawing diff / new; link ·
  it's-new · detach. Skip-read reuse (`materializeBankEntry` + `ReuseFromBank` on the
  project page) → confirmed take-off + plot, flagged `bankReusedUnverified` (the
  "Verify against drawing" safeguard surfaced on review).
- **P3 — browse. ✅** `/bank` list (grouped by client, build filter, archived toggle) +
  `/bank/[id]` detail (current take-off readout, version history with per-version diff,
  where-used) + admin (`bank-entry-admin.tsx`: rename, aliases, merge, archive;
  `bank-version-actions.tsx`: make-current). Nav "Bank" tab.
- **P4 — later.** Excel seed (needs Laura's file) · optional feed of bank names into
  grouping/segmentation (`src/lib/ingest`).

### Notes / decisions made during the build
- **Fingerprint idempotency** doubles as the guard against duplicate versions on reuse
  or a re-confirm with no change — a new version is written only when the geometry
  actually moves.
- **Code is authoritative identity:** an exact-code match always attaches (never spawns
  a second entry with the same code), respecting `@@unique(clientId, canonicalCode, buildType)`.
- The matcher is a **pure lib** (no Prisma); all IO lives in `src/server/bank.ts`.

---

*When an open item is resolved, update this doc and `docs/11 §8` together, and bump
any affected prompt/engine version.*
