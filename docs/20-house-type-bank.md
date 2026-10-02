# 20 · House-Type Bank — canonical spec (v2)

**Status: v2 BUILT 2026-10-02.** Replaces the v1 design of 2026-09-23 (automatic save on
confirm, matching scoped to one builder, a separate "Reuse from bank" button, a single
"current" version). What changed and why is in §10; the v1 notes are kept at the end.

Companion reading: `docs/11` (take-off engine), `docs/13` (extraction playbook),
`docs/15` (pricing), `ARCHITECTURE.md`. The bank plugs in at the **take-off layer** and
leaves pricing/quotes untouched.

**House-build only (TRADITIONAL + TIMBER_FRAME). Never Construction.**

---

## 0. What this is, in one line

Turn Laura's personal Excel bank into a **shared, company-owned library** of confirmed
house types, so a repeat house type is **picked, not re-measured**.

### Acceptance criteria (from the brief)
1. A repeat house type is **retrieved and applied without a manual rebuild**.
2. The system **flags when a drawing differs** from the stored version.
3. The bank is **shared and owned by the company**, not one person's spreadsheet.

---

## 1. The rules (simple, and all human-in-the-loop)

1. **Nothing goes into the bank on its own.** Confirming a take-off does NOT save it.
   A person presses **Save to house bank** (beside Confirm take-off).
2. **Every save is a choice:** a *new house type*, a *new version* of one, or "already
   saved as vN". **Versions are never edited or replaced** — v1 stays v1 forever.
3. **One bank for the whole company.** Matching searches **every builder**; the builder
   is only a label and a ranking hint (same builder listed first). Only the build type
   is a hard wall — a timber-frame Denton is never offered for a traditional tender.
4. **The bank is checked before any reading.** On upload, the moment a pack is split
   into house types, each one is checked. A repeat's read is **HELD** — never queued, no
   AI cost — until a person picks a version or says "read the drawing".
5. **Picking a version is the confirmation.** The take-off is filled from that version
   and confirmed; no drawing is read; the house type is labelled **From house bank**.
6. **Not strict on names.** "Denton", "DENTON", "Denton-XYZ", "The Denton (Semi)",
   "Denton 2B", "11. 250814 Denton", a typo "Milfield", a learned alias, or the same code
   all find it. The matcher never decides — it offers; the person picks.

---

## 2. Data model

### `HouseTypeBankEntry` — one house type in the bank
- `clientId` — the builder it was first saved from (a **label**, not a scope).
- `buildType` — TRADITIONAL | TIMBER_FRAME (a hard filter).
- `canonicalName`, `canonicalCode?`, `matchKey` (normalised name).
- `aliases String[]` — names/codes a person confirmed as this type (learned when a
  version is picked for, or saved from, a differently-named house type).
- `currentVersionId` — just the **newest** version (every version stays pickable).
- `status` ACTIVE | ARCHIVED, `timesReused`, timestamps.
- Unique `(clientId, canonicalCode, buildType)` — one entry per builder + code.

### `HouseTypeBankVersion` — one frozen, never-edited take-off
- `version` (1, 2, 3… per entry), `snapshot Json` (observables only, in the shape
  `takeoffInputFromStored` reads — `src/lib/bank/snapshot.ts`), `geometryFingerprint`.
- `sourceTakeoffId?` / `sourceProjectId?` (SetNull — the snapshot outlives its project),
  `confirmedById`, `confirmedAt` (= when it was saved), `note?`.

### `HouseType` — the link (migration `20261002180000_house_bank_v2`, additive)
- `bankEntryId?`, **`bankVersionId?`** (new: the exact version picked from / saved as).
- `bankMatchState`: **FROM_BANK** (a version was picked, no read) · **SAVED** (saved to
  the bank by the button). The v1 values NEW / MATCHED / CHANGED / DETACHED are legacy.

### `Extraction.status` — two new values
- **HELD** — the house type was found in the bank; the read is waiting on a person and
  was never queued.
- **SKIPPED** — a bank version was picked; this drawing is not read. The row is kept so
  the review page still shows the drawing.

---

## 3. Matching (`src/lib/bank/match.ts`, pure + unit-tested)

### Finding repeats — `findRepeats` (upload time, name/code only)
Searches the whole bank of the same build type. Per entry:

| Signal | Strength |
|---|---|
| a learned alias (name or code) | STRONG |
| same name after normalising (exact, a token prefix "Denton" ⊂ "Denton XYZ", or similarity ≥ 0.85) | STRONG |
| same code, same builder (or the names are similar) | STRONG |
| same code, another builder, unrelated name (short codes like "B5" recur) | POSSIBLE |
| similar name 0.6–0.85 ("Benton" vs "Denton") | POSSIBLE |

Ranked: STRONG first, then the same builder, then the closer name. Up to 3 entries are
offered, each with all its versions. POSSIBLE is labelled "possible match — check the
name"; it still holds the read (one click costs less than a needless read).

**Normalising a name** (`normalize.ts`): lower-case, file/revision noise removed, the
variant words dropped (handing LH/RH, detached/semi/end/mid/terrace, garage/integral,
plot, affordable, and filler: the/house/type), and bare numbers dropped when a real name
remains ("11. 250814 Denton" → "denton"; a name that is only a number, "341", is kept).

### Comparing numbers — `compareGeometry` / `compareWithEntry`
Used when saving and after "Check against this drawing". Field-by-field with tolerances
(`BANK_TOLERANCE` — provisional, Colin's open sign-off number, docs/11 §8): storeys,
structure, roof, dwellings wide, apex / corner / low-level counts, height, render,
birdcage per floor, each wall. Verdict IDENTICAL / CHANGED / DIFFERENT (storeys,
structure, a big perimeter drift or apex jump = looks like a different house).
`compareWithEntry` checks **every** version — an identical older version means nothing
new to save — and gives the diff against the newest plus the next version number.

---

## 4. The flows

### 4a. Save to house bank (review page, beside Confirm)
- Greyed out until the take-off is confirmed (only confirmed numbers go in).
- The dialog shows the house type + its numbers in Colin's words, then the bank
  entries it could be (`saveOptions`), each with:
  - **Same numbers as vN** → "Yes, it's X — link it to vN" (or "Already in the bank as
    vN" if it is already linked there). Nothing is duplicated.
  - **Differs from vN** → the diff (e.g. "Front wall 8.2 → 8.6"), a "looks like a
    different house" note when the verdict is DIFFERENT, and **Save as vN+1 of X** — the
    older versions stay exactly as saved.
  - Always: **It's a different house — save as a new house type**.
- `saveToBank` re-checks every choice on the server: it refuses a duplicate version
  and refuses a "same as" whose numbers differ. A clashing code (same builder + code +
  build type) is not kept on a new entry.
- After saving, the button reads **In house bank · Denton v2**.

### 4b. Upload — found in the bank (project page)
- `holdBankRepeats` runs where reads are queued: the per-file path
  (`segmentPerFileAndQueue` in the worker) and **Confirm grouping** (`confirmGrouping`).
  Held reads are never sent to the queue.
- The house type row shows **Found in the house bank** (or "Might already be…" when
  only POSSIBLE matches): each entry (name · code · builder) with its versions — v2 ·
  "20.56 m × 4 lifts · birdcage 35.6 m² × 2" · saved date · from which tender — and
  **Use v2**, plus **Not this house — read the drawing**.
- **Use vN** (`applyBankVersion`): fills the take-off from that version, confirms it,
  links the house type (FROM_BANK + the version), marks its reads SKIPPED, learns the
  name/code as an alias, creates the default plot. No AI call.
- **Not this house** (`readDrawingInsteadOfBank`): the held read is queued as normal.

### 4c. "From house bank" — everywhere it shows
- Project page: a **From house bank · Denton v2** badge on the row (links to the
  entry); the read badge says "From house bank"; **Review →** opens it.
- Review page: a banner — *From house bank · Denton L356 v2 · Miller Homes · saved
  12 Aug from Whitford Road* — and "This drawing was not read — these are the bank's
  numbers for v2", with **Check against this drawing**.
- **Check against this drawing** (`checkBankPickAgainstDrawing`) — optional, one read:
  re-opens the take-off and reads the drawing; the banner then says **matches v2** or
  **This drawing differs from v2: Front wall 8.2 → 8.6 …** (acceptance criterion 2).
  The estimator checks it, confirms, and Saves to house bank → a new version. **Use v2's
  numbers again** puts the bank's numbers back.

### 4d. Nothing reads by accident
The worker (`handleExtract`) never calls the model for a read that is HELD or SKIPPED,
whose row is gone, or whose take-off is already confirmed (marked SKIPPED). A read
already mid-flight when a version is picked cannot overwrite it (persist refuses a
CONFIRMED take-off).

### 4e. One builder, one name
New-job form: the builder field suggests the builders already on file, and an existing
builder is reused ignoring case and extra spaces ("Bloor Homes" = "bloor homes ").
Matching no longer depends on the builder anyway.

---

## 5. The `/bank` pages
- **List** (grouped by builder): name · code · build type · storeys · perimeter ·
  versions · last saved · times reused.
- **Entry:** the latest version in full, the version history (each: saved date, the
  tender it came from, the diff from the previous version), where used ("picked v2" /
  "saved as v1"), rename, aliases, merge (any builder, same build type), archive.
  There is no "make current" — every version is pickable on upload.

---

## 6. Out of scope (kept minimal)
- Auto-apply or auto-save — always a person.
- Geometry-only matching across different names (needs a read first; the name/code/
  alias signal + learned aliases cover the real cases).
- Prices in the bank — observables only; pricing reads the take-off as always.
- The Excel seed of Laura's bank — needs her file (TODO P4).

## 7. Open items (do not guess)
1. **Change tolerance** (`BANK_TOLERANCE`) — Colin's sign-off number (docs/11 §8 #11).
2. **Laura's Excel bank import** — map her real columns when the file arrives.

---

## 8. Verification (2026-10-02)
- Unit: `src/lib/bank/bank.test.ts` — every Denton spelling found; another builder found
  and ranked after the same builder; code-only from another builder = POSSIBLE; typo;
  "The Sowe" = "Sowe"; unrelated names find nothing; TF B5 never matches traditional B5;
  save comparisons (identical / older version / diff + next version). Pack progress
  treats HELD / SKIPPED as done.
- End-to-end on the real database (`scripts/e2e-bank.mts`, data KEPT for the UI):
  `seed` (confirm + save 29 Sep types; confirming alone saves nothing), `repeat` (a
  different builder, the same Miller drawings → repeats HELD, zero queue jobs for them,
  a new type read as normal), `tf` (timber frame, grouped path), `variant` ("Denton-XYZ",
  no code, another builder → held), `status`.
- To empty the bank (bank rows only; take-offs untouched): `scripts/bank-empty.mts --yes`.

---

## 9. Files
`src/lib/bank/{snapshot,normalize,match,summary}.ts` (pure) ·
`src/server/bank.ts` (bankRepeatsFor, holdBankRepeats, applyBankVersion, saveOptions,
saveToBank, bankOriginFor, listBankEntries) · `src/server/actions/bank.ts` ·
`src/components/bank/{bank-repeat-picker,save-to-bank-button,bank-origin-strip,bank-entry-admin}.tsx` ·
`src/app/bank/*` · worker hold in `src/worker/processPack.ts`, guard in `src/worker/index.ts`,
hold in `src/server/actions/grouping.ts`.

---

## 10. Why v2 (what the v1 build got wrong)
- **Matching depended on the builder name.** v1 scoped every lookup to the project's
  client, and a new project found its client by the exact typed text — "Bloor" vs
  "Bloor Homes" were two clients with separate, empty banks. → whole-bank search.
- **The drawing kept processing after "reuse".** v1 queued the read the moment the
  pack was split, before the bank suggestion appeared; reuse only deleted reads not yet
  started (the queued job then errored + retried), a started read ran and was billed, and
  the "Reuse from bank" button added a second copy while the uploaded type was still
  read. → reads are HELD before queueing; SKIPPED reads never reach the model.
- **Auto-save on confirm** filled the bank with everything confirmed, and a changed
  drawing silently became the "current" version. → an explicit button and choice;
  versions never replaced; every version pickable.
- The separate **Reuse from bank** button is removed — the bank comes to you on upload.

<details><summary>v1 (2026-09-23) — superseded</summary>

v1 shipped: schema (`HouseTypeBankEntry`, `HouseTypeBankVersion`, `HouseType.bankEntryId`
+ `bankMatchState`), the pure snapshot/normalise/geometry matcher (still used), automatic
`saveTakeoffToBank` on confirm, a review "Bank strip", skip-read `materializeBankEntry` +
`ReuseFromBank`, an upload-time `ReuseSuggestion` chip, and `/bank` browse. The v1 bank was
emptied on 2026-10-02 (`scripts/bank-empty.mts`; take-offs untouched).
</details>
