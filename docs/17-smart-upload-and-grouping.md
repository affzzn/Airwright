# 17 · Smart Upload & Grouping — ingesting any pack shape into house types

**What this is.** The canonical spec for the **smart upload + cross-file grouping**
layer: let the user drop a *whole tender folder* — an arbitrary tree of PDFs, single-
or multi-page, buried under trade sub-folders and junk — and have the system figure
out, on its own, which pages belong to which **house type**, assemble one clean
combined PDF per type, and hand that to the existing extract → review → confirm →
price pipeline. The upload must feel **very smart and very robust**, so that using it
is effortless.

**Why now.** The current pipeline assumes **1 uploaded PDF = 1 house type = all its
pages** (`segment.ts` groups pages *within one document*; the worker fans out one
Extraction per house type over a page range of that document). The real packs Laura
sent (`data/first-ones-sent/`, gitignored PII) break that assumption four different
ways at once. This doc is the plan to handle all of them.

> Legend: **✅ CONFIRMED** (decided — build it) · **⚠️ OPEN** (needs a call — flag,
> don't guess) · **🔭 LATER** (shapes the design now, built later) · **🔧** (a code/
> schema change). Read `docs/13` (extraction playbook) and `docs/11` (take-off spec)
> first; this layer sits *upstream* of both and changes nothing downstream of the
> assembled PDF.

---

## 1. The core reframe

**A house type is a *group of pages*, not a file.** The one sentence for Colin/Laura:

> The system ingests an arbitrary tree of PDFs, works out which pages are
> scaffold-relevant, groups those pages into house types across every file, assembles
> **one combined PDF per house type**, and runs the normal take-off on that.

Two things the new packs do that the old assumption can't handle:
1. **One house type is spread across many files** (loose single-page PDFs).
2. **One upload contains many house types AND a mountain of non-scaffold trades.**

The fix is a new **grouping stage** between ingest and extract — plus a
**path-preserving, resumable upload**. Everything downstream of the assembled PDF
(extractor, review screen, engine, pricing) is **unchanged**.

---

## 2. What Laura actually sent — the four shapes (evidence)

From `data/first-ones-sent/` (four builders, four packaging conventions). Verified:
the loose single-page PDFs have **strong text layers** (Tilia's Cromford elevation
exposes `4725` U/S-wallplate, "GRP porch canopy", brick courses; Vistry's plan
exposes the cavity-wall build-up and setting-out dims) — so the existing text-layer
classifier and dimension-hint extractor work on them **unchanged**. The problem is
grouping + assembly, not reading.

| Builder | Packaging | Per house type | Junk level | Key challenge |
|---|---|---|---|---|
| **Bloor Oadby PH2A** | **One multi-page combined PDF per type** (`372_BYRON_ISSUE_4.13.pdf` = 19pp) | already one file | low | **Revision / handed-pair dedupe** (470_HALLAM as ISSUE 4.6/4.8/4.9/7/7.1; `470` vs `470-1`) |
| **Taylor Wimpey Perryfields** | **Deep trade-folder tree**; real drawing is `…/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford END – 2021.pdf` (31pp combined) | one combined PDF **buried** under ~12 trade folders | **very high** (substructure, roofs 30/35/40°×boxed/clipped, kitchens, wardrobes, SAP, ventilation, lintels…) | Find the `00_House_Type_PDF`; ignore everything else; END/MID + affordable variants |
| **TW apartment blocks** | **Flat folder of numbered single-page PDFs** (`51_GA ELEVATIONS`, `21_GA GROUND FLOOR PLAN`, `61_SECTION A-A`) + junk | folder = one block | high | Group loose pages by folder; drop fire-strategy/customer/PC-plank junk |
| **Tilia Hawkesbury** | **Flat folder, MANY types intermixed as loose single-page PDFs**; identity in the **filename** (`CROMFORD-201-03D Front Elevation Plots 4,21,…_Ver3.pdf`) | scattered across ~34 files | medium | Group by filename prefix; config + plot list are IN the filename; `_VerN` dedupe |
| **Vistry Top Wighay** | **Pre-curated `Scaffold/` folder, one subfolder per type** (Aspen, Beech…) of loose single-page PDFs + Block Plans / Site Plans / Garages / Boundaries | folder = one type | low | Cleanest — folder = type. **Build & prove the concept here first.** |

Three cross-cutting facts:
- **Zips still sit beside the unzipped folders** (`Housetypes 1.zip`, `Files (2).zip`,
  `OneDrive_1_….zip`, `FileArchive (11).zip`) → recursive unzip would **double-ingest**;
  the grouper must dedupe (content hash / same relative path).
- **Each builder ships a take-off answer sheet** at the top level
  (`TAYLOR WIMPEY … TAKE OFFS.pdf`, `BLOOR OADBY PH2A TAKE OFFS.pdf`) → Colin's/Laura's
  golden answers, **not inputs** — must be excluded from extraction (great for validation).
- **Filenames carry config + plots for free** (Tilia/TW: `END`/`MID`, `Plots 4, 21, …`).

---

## 3. Architecture — where the new stage sits

```
upload folder / zip tree
  → ingest: flatten, KEEP each file's RELATIVE PATH        ★ path preservation
      (dedupe zip-vs-unzipped by content hash)
  → classify every page (existing classify.ts, unchanged)
  → detect builder → load BuilderIngestProfile             ★
  → GROUP relevant pages into house types ACROSS ALL files ★ cross-file grouping
      signals: folder path → filename → title block;
      dedupe revisions; LLM manifest fallback for unknown / low-confidence
  → assemble ONE combined PDF per house type (pdf-lib)      ★ + page manifest
  → grouping CONFIRM screen (always shown, low-conf flagged)★
  → existing extract-drawing → review (renders combined PDF) → confirm → price
```

`segment.ts` already groups pages into house types **within one document**; this lifts
that up to span **all files in the pack**, and materialises a combined PDF so the review
screen and extractor keep working unchanged.

---

## 4. Decisions taken (2026-08-28)

1. **Upload = Uppy + TUS (resumable) from the start.** ✅ Robustness is a priority; a
   200-file, multi-hundred-MB tree on a flaky connection needs resume + retries +
   concurrency + real progress out of the box.
2. **Grouping = per-builder profile (deterministic), LLM as a targeted assist.** ✅
   More reliable; onboarding a builder is worth it — and the LLM drafts each profile's
   first version so onboarding is cheap (§7).
3. **Grouping always passes a lightweight CONFIRM screen**, with **low-confidence groups
   flagged for attention** and extraction **blocked only on genuinely unresolved** items.
   ✅ Same human-in-the-loop philosophy as the take-off review; cheap insurance against a
   silently-wrong grouping that would waste extraction spend and mis-price.
4. **The LLM reasons over a TEXT MANIFEST, never over PDF images.** ✅ Paths +
   title-block snippets carry the identity; text is pennies/pack and fast. Images stay
   for the actual take-off extraction (already good).
5. **Assembled combined PDF is the unit of extraction/review**, with a page manifest
   mapping every assembled page back to its source file+page (provenance intact). ✅

---

## 5. Data-model changes (Prisma) — additive

- 🔧 **`PackUpload.relativePath`** + **`Document.relativePath`** — the file's path
  inside the uploaded folder (`Scaffold/Aspen/…Front Elevation.pdf`). The single most
  important addition: it's the strongest grouping signal, and it fixes the current
  match-by-bare-`name` bug (many files are literally `Section A-A.pdf`).
- 🔧 **`Document.contentHash`** — for zip-vs-unzipped dedupe.
- 🔧 **A synthetic assembled `Document`** per house type: `kind = ASSEMBLED`, its own
  Storage object (the merged PDF), plus a **`pageManifest` JSON** mapping each assembled
  page → `{ sourceDocumentId, sourcePage, relativePath }`. The `Extraction` points at
  this assembled Document, so review/provenance are unchanged; a reviewer can still trace
  a measurement back to the original file/page.
- 🔧 **`BuilderProfile.ingestProfile` JSON** (the grouping rules — §6). The model exists
  and is currently unused; this gives it a job.
- 🔧 **Grouping is persisted + reviewable** (a `HouseTypeGroup` staging record, or the
  grouping result stored on the assembled Document) so it can be overridden **before**
  extraction.

Nothing downstream of the assembled Document changes.

---

## 6. The per-builder profile (`BuilderIngestProfile`) — the reliability core

A JSON config per builder, seeded from real packs, LLM-drafted for new ones (§7).

```
BuilderIngestProfile {
  builderMatch          // recognise the builder from top folder / title block
  typeGroupingStrategy  // "folder" | "filename" | "combined-pdf" | "llm"
  typeFolderPattern     // Vistry: "Scaffold/<TYPE>/*" ; TW: ".../<CODE>_<TYPE>/..."
  filenamePattern       // regex → { type, drawingKind, plots[], revision, variant }
  preferCombinedPdf     // TW: if "00_House_Type_PDF/*.pdf" exists, use it, skip assembly
  relevantDrawingKinds  // [ELEVATION, FLOOR_PLAN, SECTION, SETTING_OUT, ROOF]
  ignoreFolders         // TW: 06_Kitchens, 08_SAP_and_Part_O, 10_Fitted_Furniture, 11_Ventilation…
  ignoreFilePatterns    // "TAKE OFFS", "SAP", "M+E", "Compliance", "Schedules", "Wardrobe"…
  revisionRule          // latest ISSUE_x.y / _VerN ; "<code>" vs "<code>-1" = handed pair
  configFromFilename    // Tilia/TW: END/MID + "Plots 4,21,…" → configuration + plot list
}
```

Mapping to the four real builders (proof it's real):
- **Vistry** → `folder`, `Scaffold/<TYPE>/`, ignore `Boundaries`/`Engineer`, garages separate. Cleanest.
- **Taylor Wimpey** → `combined-pdf` (`preferCombinedPdf` on `00_House_Type_PDF`), heavy `ignoreFolders`, `configFromFilename` (END/MID + affordable). Apartments → `folder` on `APARTMENT_BLOCK_*`.
- **Tilia** → `filename` (type = filename prefix `CROMFORD-…`), `configFromFilename` (plot lists), `_VerN` revision.
- **Bloor** → already 1 PDF = 1 type; mainly `revisionRule` (latest `ISSUE`; `470` vs `470-1` handed pair).

---

## 7. The LLM — used surgically (text manifest only)

The LLM makes the upload *smart and robust*, but only in two places. It reasons over a
**text manifest** — for every file: relative path + a few extracted title-block strings
(house-type name, drawing kind, plots, revision). A few KB even for a 500-file pack.

- **(A) The manifest reasoner — the smart fallback.** For an **unknown builder** or any
  **low-confidence** cluster, call a cheap fast model (**`claude-haiku-4-5`**, text-only)
  to group files into house types + separate drawings from trades/junk + give confidence.
  Runs in the worker, off the request path. Known builders never pay for it. This is the
  "figure it out on its own" behaviour for layouts we've never seen.
- **(B) The profile proposer — cheap onboarding.** For a new builder, run the same
  manifest through the LLM to **draft a `BuilderIngestProfile`** (folder patterns,
  filename regex, junk folders, combined-PDF presence). A human confirms/edits/saves in a
  small admin screen; the builder is deterministic forever after.

**Boundaries (do NOT):** the LLM does **not** do the take-off extraction here (that's the
existing Layer-1 job); it does **not** group by looking at drawing images (expensive,
unnecessary — paths + text layer carry the identity). Keep it on **text**, keep it
**assistive**, keep the deterministic profile + human in charge. Same doctrine as the
rest of the app: AI proposes, the engine/human decides.

---

## 8. The grouping engine (deterministic + LLM fallback)

A pure, unit-testable module (mirror `houseTypeIdentity.ts` / `segment.ts`):

1. **Detect builder** → load profile (or "unknown").
2. **Parse each relevant page's identity** from `{folderPath, filename, titleBlock}` →
   `{ typeName, drawingKind, plots, revision, variant, confidence }`.
3. **Reconcile signals** — folder vs filename vs title block agree → high; disagree →
   flag (same multi-source-reconcile → confidence-from-agreement doctrine as birdcage/height).
4. **Cluster** pages into house-type groups; drop junk per profile; **dedupe revisions**
   (latest wins; `<code>` vs `<code>-1` and END/MID = one type, config as a variant).
5. **LLM fallback** for unknown builder / low-confidence clusters (§7A) — a *suggestion*,
   never silent.
6. **Emit groups** → each becomes an assembled PDF + Extraction.

---

## 9. Combined-PDF assembly + provenance

Using **pdf-lib** (already in the stack): for each group, copy the chosen relevant pages
into one new PDF in the extractor's **reading order** (elevations → floor plans → section
→ setting-out → roof), upload it as the assembled Document, and write the `pageManifest`
(assembled page → source file+page). The review screen renders this combined PDF exactly
like today; provenance links resolve through the manifest to the original file. **No
change to the extractor or review UI.**

---

## 10. The grouping CONFIRM screen (always shown, attention where it counts)

After grouping, before the (paid) extraction:

- **Always** show a lightweight summary — "12 house types found from 340 files, 200
  ignored. Confirm & extract." For a clean Vistry pack it's a 2-second glance + one click.
- **Low-confidence items are flagged at the top** in a distinct state (signal
  disagreement, unknown builder, an unplaced file, a name clash) so the eye goes straight
  to the 1–2 things needing a decision.
- **Extraction is blocked only on genuinely unresolved** groups; confident ones proceed.
- Fully **overridable** — reassign a file to a different type, split/merge a group, mark a
  file junk — same editable, human-in-the-loop pattern as the take-off review.

Rationale: a silently-confident-but-wrong grouping is the one failure that costs a wrong
quote **and** wasted extraction spend; a 2-second confirm is cheap insurance, and it keeps
the "a person confirms every take-off" promise intact end to end.

---

## 11. Upload layer — Uppy + TUS

- **Uppy** (`@uppy/core`, `@uppy/react`, `@uppy/tus`, a directory-capable source) →
  folder drag-drop with **path preservation**, **resumable** uploads (TUS), automatic
  **retries**, **concurrency** control, real **progress**.
- **Supabase Storage speaks TUS natively** (recommended for files > 6MB — most of these
  drawings) → point Uppy at the Supabase TUS resumable endpoint
  (`…storage.supabase.co/…/upload/resumable`); use the **direct storage hostname** for
  performance; set `removeFingerprintOnSuccess` so the same file can be re-uploaded.
- **Thread `relativePath`** from `file.meta`/`webkitRelativePath` all the way to
  `PackUpload.relativePath` → `Document.relativePath`.
- Keep **zip support** (fflate) and **dedupe** zip-vs-unzipped by content hash.
- If `react-dropzone` is used anywhere, set **`useFsAccessApi: false`** or directory
  picking is blocked by the File System Access API.

This **replaces** the current per-file signed-URL XHR flow (`upload-form.tsx` +
`createSignedUploads`/`finalizeUploads`). The finalize → `process-pack` enqueue stays.

---

## 12. Libraries — summary

| Need | Use | Status |
|---|---|---|
| Robust folder upload, resumable, retries, progress | **Uppy** (`@uppy/core/react/tus`) → Supabase **TUS** | new (chosen) |
| Unzip (with dedupe) | **fflate** | ✅ have |
| Page classification / text layer | **pdfjs-dist** | ✅ have |
| Combined-PDF assembly | **pdf-lib** | ✅ have |
| LLM manifest reasoner + profile proposer | **@anthropic-ai/sdk**, model **claude-haiku-4-5** (text-only) | ✅ SDK have |
| Fuzzy name reconcile (optional) | `fastest-levenshtein` (tiny) or hand-rolled normalisation | optional |

Refs: [Uppy](https://uppy.io) · [Supabase Resumable Uploads (TUS)](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) · [react-dropzone](https://react-dropzone.js.org/).

---

## 13. Build order (each step demoable)

1. **Path-preserving folder upload** — Uppy + TUS; `relativePath` threaded to
   `PackUpload`/`Document`; zips still supported + deduped by hash. *Foundation.*
2. **Filename/path identity parser** — pure, unit-tested against the real
   `first-ones-sent` filenames. *High value, fully testable now.*
3. **Builder profile model + schema + seed Vistry** (cleanest).
4. **Cross-file grouping engine + combined-PDF assembly**, proven end-to-end **on
   Vistry** (folder = type, low junk → fastest win). *Closes the loop:* upload Vistry
   folder → grouped house types → review → price.
5. **Add Bloor** (revision/handed-pair dedupe) + **Tilia** (filename grouping +
   config-from-filename).
6. **Add Taylor Wimpey** (the `00_House_Type_PDF` shortcut + aggressive folder ignore +
   apartments). *Hardest — do last.*
7. **LLM manifest-reasoner fallback** (unknown builders / low-confidence groups).
8. **LLM profile-proposer + onboarding screen.**
9. **Grouping review/override UI** (correct a mis-grouped set before extraction).

Build 1–4 first to prove the concept on the cleanest builder; the rest broadens coverage
and adds the smart fallbacks.

---

## 14. Defaults chosen (flag to change) + open questions

**Defaults (recommended, applied unless told otherwise):**
- **Config & plots from filenames** (Tilia/TW encode END/MID + `Plots 4, 21, …`) →
  auto-propose plots/config, human confirms. Quietly fills the plot-list gap left when the
  AI plot-list extractor was removed (2026-08-26).
- **Assembled PDF page order** = elevations → floor plans → section → setting-out → roof.
- **Manifest reasoner runs in the worker** (`process-pack`), off the request path.
- **Handed pairs** (`470` vs `470-1`; END vs MID) = **one house type, config as a variant**.

**⚠️ Open (confirm before hardening):**
1. Does **auto-plots-from-filename** feed the plot list directly, or only propose it?
2. The exact **junk folder / file** lists per builder (seed from real packs, keep as profile data).
3. **Garages** (Vistry has a `Garages/` folder of their own single-page PDFs) — group as
   their own units and feed the garage pricing path (`docs/16 A6`)? Likely yes.
4. **Apartment blocks** — the loose-pages-in-one-folder shape (TW) reuses the same grouper;
   confirm the relevant GA sheets (`GA ELEVATIONS`, `GA … FLOOR PLAN`, `SECTION`,
   `SUB-STRUCTURE`) and that whole-block apartment mode (docs/11 §7a) still applies.

---

*Sources: `data/first-ones-sent/` (gitignored PII — four real builder packs: Bloor Oadby
PH2A, Taylor Wimpey Perryfields 2B, Tilia Hawkesbury, Vistry Top Wighay). Cross-refs:
`docs/13` (extraction playbook — unchanged downstream), `docs/11` (take-off spec),
`docs/16` (pricing engine — garages/apartments), `ARCHITECTURE.md` (the pipeline this
inserts into). Update this doc when a ⚠️ item is confirmed, and keep the build-order
status current as steps ship.*
