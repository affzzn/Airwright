# 17 · Smart Upload & Grouping — ingesting any pack shape into house types

**What this is.** The canonical spec for the **smart upload + AI grouping** layer: let
the user drop a *whole tender folder* — an arbitrary tree of PDFs, single- or
multi-page, buried under trade sub-folders — and have the system figure out, on its
own, **which files belong to which house type**, group *every* file for a house type
into one combined PDF, tag which pages are scaffold-relevant, and hand that to the
existing extract → review → confirm → price pipeline. It must feel effortless, and —
above all — be **accurate and reliable on builders it has never seen**.

**The premise (corrected 2026-08-29).** In production **every builder is unknown**.
There are no "known builders" to hand-configure. The four builder packs in
`data/first-ones-sent/` (Vistry, Bloor, Tilia, Taylor Wimpey) are **test fixtures** for
checking that grouping is accurate — not the production model. Therefore **the AI must
be the primary grouping engine and generalise to any pack**; hand-written per-builder
rules are only a caching optimisation (§9), never the core.

> Legend: **✅ CONFIRMED** (decided — build it) · **⚠️ OPEN** (needs a call — flag,
> don't guess) · **🔭 LATER** (shapes the design now, built later) · **🔧** (a code/
> schema change). Read `docs/13` (extraction playbook) and `docs/11` (take-off spec)
> first; this layer sits *upstream* of both and changes nothing downstream of the
> assembled PDF's relevant pages.

> **STATUS (2026-08-29, branch `feat/smart-upload-grouping`).** *Built:* folder-first
> resumable upload; deterministic path/filename/title-block reading; combined-PDF
> assembly; a confirm screen; **✅ Feature 1 — group EVERY file per house type with a
> per-page relevance tag** (§5) + the review preview-relevant / **Open full drawing**
> split; **✅ Feature 2 — AI-first grouping** (§3–§4): the AI infers the packaging
> *recipe* (constrained schema, `inferRecipe.ts` + `runToolText`), `compileRecipe` turns
> it into the profile `groupPack` applies, with a deterministic-profile then legacy
> fallback (`env.groupingAI`, default on). The four hand profiles are now **test
> fixtures + a cross-check**. **✅ Feature 3 — in-pack answer-key cross-check** (§7);
> **✅ Feature 4 — Tier-2 LLM relevance triage** (§6, rescue-only); **✅ Feature 5 —
> override UI** (§4.7, rename / merge / exclude). Verified group-everything on the four
> real packs. **All five near-term features shipped.** Follow-ups: file-level reassign /
> split; the later/optional items (§8, and the descoped grading harness + OCR/raster).
> Build order in §12.
>
> **Out of scope for now (by decision 2026-08-29):** an offline **grading harness**
> and **OCR/vision rescue of raster (image-only) PDFs**. Raster pages with no text
> layer are simply **flagged for a human** as they are today, not auto-read.

---

## 1. The core reframe

**Two jobs that were tangled, now cleanly separated:**

- **Grouping = identity only.** "Which house type does this file belong to?" Group
  **every** file for a house type — relevant or not (kitchens, SAP, wardrobes, lintels
  included) — into **one combined PDF per house type**: the complete dossier.
- **Relevance = a per-page tag** on the pages inside that combined PDF. It no longer
  decides grouping; it only decides *which pages the extractor reads* and *which pages
  the review preview shows*.

**And the production truth:** every builder is unknown, so grouping can't lean on
pre-written recipes. **The AI infers how each pack is organised, and does it reliably
enough to trust with a quote.** The rest of this doc is how.

---

## 2. The four real pack shapes (test fixtures — evidence the design must handle)

From `data/first-ones-sent/` (gitignored PII). These are **not** "supported builders";
they are the accuracy fixtures that prove the AI-first engine groups correctly. They
also show why no single hard rule works — the packaging convention is different every
time. Verified: the loose single-page PDFs carry strong **text layers** (title blocks,
dims), so text is the primary signal.

| Builder (fixture) | Packaging | Identity signal | Junk to ignore |
|---|---|---|---|
| **Bloor Oadby PH2A** | One multi-page combined PDF per type (`372_BYRON_ISSUE_4.13.pdf`) | filename | revisions/handed pairs to dedupe |
| **Taylor Wimpey Perryfields** | Deep trade tree; real drawing in `…/EMA21_Avonsford/00_House_Type_PDF/…` | folder | ~12 trade folders (kitchens, SAP, roofs…) |
| **TW apartment blocks** | Flat folder of numbered single-page GA PDFs | folder | fire strategy, customer plans, PC plank |
| **Tilia Hawkesbury** | Flat folder, many types intermixed as loose pages (`CROMFORD-201-03D …`) | filename prefix | M+E, schedules, compliance |
| **Vistry Top Wighay** | Pre-curated `Scaffold/<Type>/` subfolders of loose pages | folder | block/site plans, boundaries |

Cross-cutting facts still true: zips sometimes sit beside the unzipped folder
(→ dedupe by content hash); each pack ships a take-off answer sheet
(`… TAKE OFFS.pdf` — a **free answer key**, §7); filenames often carry config + plots.

---

## 3. The one principle that makes AI grouping reliable

The crucial, counter-intuitive design choice:

> **Don't ask the AI to place 500 files. Ask the AI to infer the *rule*, then let plain
> code apply that rule to all 500 files.**

Why: when an LLM is asked to label hundreds of items in one pass it **silently drops
items** — files just vanish from the output ([schema-bound omission](https://tianpan.co/blog/2025-10-29-structured-outputs-llm-production)).
A dropped house type = a missing line on the quote. Unacceptable.

So instead:
1. The AI reads the pack and **infers the packaging pattern** — "house types are the
   folder under `Scaffold/`; these folders are junk; names look like X." A small,
   bounded answer.
2. **Code applies that pattern to every single file, exhaustively.** Code never drops a
   file; it's deterministic and auditable — you can trace exactly why each page landed
   where it did.

This is "the AI writes the recipe" **as the main engine** — the AI generates the recipe
**per pack, on the fly**, and code executes it. Smart inference + reliable application.
LLMs generalise these rules well to layouts they've never seen
([generalization without fine-tuning](https://www.nature.com/articles/s41598-025-15627-z.pdf)).

---

## 4. The AI-first grouping pipeline

1. **Read the facts (no AI, free).** For every file: folder path, filename tokens, and
   the **title-block text** from the PDF (house-type name, drawing type, plots,
   revision). ~90% of the signal, at no cost. *(Built: `parsePath.ts` + `classify.ts`.)*
2. **Image-only drawings → flag for a human (no OCR).** A PDF with no text layer can't
   be read for grouping/relevance, so it is **flagged for review**, not auto-read.
   *(OCR/vision rescue is out of scope for now — see the STATUS note.)*
3. **AI structure pass (one small call).** Hand the AI a compact **text summary** of the
   pack — the folder tree + a sample of filenames and title blocks. With a **strict
   schema** and **low temperature**, ask: the packaging convention? the distinct house
   types? which folders/files are non-scaffold junk? confidence + a one-line reason per
   group. **Text only — no expensive images** ([tight schema + low temp is the
   reliability recipe](https://genaiunplugged.substack.com/p/structured-outputs-json-prompts-guide)). *(To build.)*
4. **Code apply pass (deterministic, exhaustive).** Apply the AI's recipe to assign
   **every** file to a house type or explicitly to "junk/pack-level." The invariant
   *every file is accounted for exactly once* is checked in code. *(Built as the
   profile "apply" path; generalise it to consume an AI recipe.)*
5. **Deterministic cross-check → confidence.** Does the recipe agree with the raw
   signals (folder vs filename vs title block)? Agree → high confidence; disagree →
   flag. Each group sanity-checked (has an elevation + a plan, etc.). Same
   "read → reconcile → confidence-from-agreement" doctrine as birdcage/height.
6. **Use the pack's own answer key.** Most packs contain a house-type list — the
   take-off sheet, plot schedule, or drawing register. Parse it and **cross-check our
   grouping**: found all? extra? missing? A **free ground-truth check at runtime**, not
   just in testing (§7). *(To build.)*
7. **Human confirm / override.** The confirm screen, upgraded so Colin can reassign a
   stray file, split/merge a type, or place an unplaced one — **before any paid
   extraction**. Low-confidence groups float to the top
   ([route the risky cases to a human, keep the confident ones](https://arxiv.org/pdf/2510.23874)).
   *(Confirm built; override to build.)*
8. **Cache the recipe (§9).** Once the AI infers a builder's pattern and a human
   confirms it, **save it**. Next pack from that builder reuses the saved recipe —
   deterministic, instant, free, identical every time.

**Why this is accurate *and* reliable, not just smart:** no dropped house types (code
assigns, with the account-for-every-file guarantee); deterministic where it counts (the
only stochastic step is the small recipe inference — application, validation and repeat
packs are all deterministic); self-checking (the in-pack answer key); cheap (text-only
inference, images only as fallback); auditable + correctable (see why each page landed
where it did, and fix it before spending on extraction).

---

## 5. Group everything + a per-page relevance tag (the model)

**One combined PDF per house type = the complete dossier** (every file for that type,
relevant or not), plus a **page manifest** that records, per page: its source
(file + page) and whether it is **scaffold-relevant**. That manifest drives everything:

- **Extraction** reads only the **relevant** pages (a page range within the combined PDF).
- **Review — left preview** shows only the **relevant** pages (clean: just the scaffold
  drawings). 🔧
- **"Open full drawing" → new tab** loads the **entire** combined PDF (everything, in
  order). 🔧

**Ordering.** Put the relevant scaffold pages **first** in the combined PDF — so the
extraction page-range is a clean contiguous block and the preview is trivial to filter —
then the rest of the dossier after. "Open full" shows scaffold pages first, trades after.

**Size.** A full Taylor-Wimpey dossier can be 40+ pages / tens of MB. Fine (bucket is
250 MB), but assembly must merge efficiently and the UI should show a page count so the
size isn't a surprise.

**Safety net.** "Open full drawing" is also the backstop for relevance mistakes: if the
tag ever wrongly hides a page, Colin still sees it in the full PDF and can flip it on.

*(Built today: assembly includes only relevant pages + a page manifest. The change is to
include ALL pages, carry a `relevant` flag per page, order relevant-first, and split the
review UI into preview-relevant vs open-full-everything.)*

---

## 6. Relevance detection — tiered hybrid, judged by meaning not keywords

**How it works today:** fully **deterministic** — read the PDF text layer, find the
title block, keyword-match the drawing type ("Front Elevation"/"Ground Floor
Plan"/"Section" → relevant; "Kitchen"/"Electrical"/"SAP"/"Schedule" → not). Free,
instant, deterministic, auditable.

**Honest verdict: a good first pass, not enough alone** — and its weaknesses bite
exactly in an all-unknown world:
- **Brittle on unseen title blocks** — a new builder labels things differently
  ("GA Elevation", "External Wall Elevation", an unfamiliar code) and keywords miss it.
- **Gaps cut both ways** — a weird title can wrongly include junk or, worse, **silently
  exclude a real drawing** = a hole in the take-off you'd never notice.
- **Blind on raster/scanned PDFs** — no text layer, nothing to read, page skipped.

**The shift:** define relevance by **what the page IS for a scaffolder**, not by its
title text — *"does this page carry a measurement the take-off needs — the outside
faces, the footprint/plan, the section heights, the roof?"* That domain definition
generalises to any builder; keyword lists don't.

**Decide it in tiers, cheapest first:**
1. **Tier 1 — deterministic (free).** The text classifier resolves the clear cases at
   high confidence. Most pages settle here for nothing.
2. **Tier 2 — LLM triage for the rest.** Ambiguous / weak-text / unfamiliar pages get
   an LLM look — the page's **title-block text + surrounding filename/folder context** —
   with the scaffold-relevance definition in the prompt and a strict schema: *drawing
   type + relevant? + one-line reason*. (Text-based; a page thumbnail / vision pass is a
   possible later add, but OCR/raster rescue is out of scope for now — raster pages with
   no text stay flagged for a human, Tier 1.)
3. **Reconcile → confidence.** Agree → high, done. Disagree → flag and **lean toward
   including**. Crucial bias: for relevance, **recall beats precision** — a wrongly
   *included* page just wastes a few tokens (Colin deselects it); a wrongly *excluded*
   page is a silent hole. When unsure, include + flag.
4. **Human override.** Colin can toggle any page relevant/not in review; "Open full
   drawing" means nothing is ever truly lost.

**Reliability techniques** (from the research): strict JSON schema + **low temperature**
so labels don't wobble run-to-run; **account for every page** (each input page must
appear in the output — no silent drops); route **only uncertain** pages to the LLM, not
all ([keep the confident, review the risky](https://arxiv.org/pdf/2510.23874)).

**Cost:** Tier 1 free; Tier 2 text triage on only the minority of uncertain pages —
pennies per pack.

---

## 7. Self-check at runtime — the in-pack answer key

Most packs *contain* a house-type list — the take-off sheet, plot schedule, or drawing
register (Laura's packs literally ship a `… TAKE OFFS.pdf`). Parse it at runtime and
**cross-check it against our grouping**: found all of them? extra? missing? A self-check
that flags "expected 16 house types, found 15" while Colin is right there to fix it — a
reliability multiplier that costs nothing extra and needs no separate test suite.

*(An offline grading harness that scores grouping/relevance against these sheets +
`bank.json` is **out of scope for now** — see the STATUS note.)*

---

## 8. Builder recipes (the profiles, reborn) — 🔭 LATER / OPTIONAL

The four hand-written profiles are **not** the product. Their real role now is as
**test fixtures** — the known-answer packs to sanity-check grouping against by hand — and
as the **shape** of a recipe (folder / filename / combined-pdf strategy, junk rules, name
pattern), so the code that *applies* a hand profile is the same code that applies an
AI-inferred one (§4.4).

**Recipe caching is a later/optional optimisation, not a foundation.** The idea: once the
AI infers a builder's pattern (§4.3) and a human confirms the grouping, persist that
recipe (`BuilderProfile.ingestProfile`) and reuse it on the next pack from that builder →
instant, free, identical. But the AI structure pass is already cheap (pennies/pack), and
caching adds real complexity: recognising "same builder as last time," and — the risky
part — detecting when a builder **changes** their packaging so a **stale** recipe doesn't
silently mis-group a pack. So the near-term plan **infers fresh every pack** (always
current); add caching only if high volume from a few repeat builders makes it worthwhile.

---

## 9. Data-model implications

Already added (migration `smart_upload_grouping`): `PackUpload.relativePath`;
`Document.relativePath` + `contentHash` + `pageManifest`; `DocumentKind.ASSEMBLED`;
`TenderPack.groupingStatus/groupingData/builderProfileId`; `BuilderProfile.ingestProfile`.

Still needed for this plan: the **page manifest carries a `relevant` flag** per page (so
extraction/preview can filter, and "open full" ignores it); the grouping proposal
(`groupingData`) gains the **answer-key cross-check** result + per-file assignment
reasons for the override UI. (`BuilderProfile.ingestProfile` already exists for a
later/optional recipe cache — §8 — but nothing in the near-term plan writes it.)

---

## 10. Upload layer (as built — folder-first, resumable)

A robust, **folder-first** custom uploader — folder drag-drop (FileSystem API recursion)
+ a `webkitdirectory` picker (loose files / ZIP still accepted), non-PDF/ZIP filtered
client-side, a concurrency pool (5) and **backoff retry** (0/1s/3s) — over the existing
**signed-URL** transport (works against the RLS-protected bucket, no policy change).
**Resumable by re-drop:** files are **registered incrementally** as they finish
(`registerUploads`, batches of 20) — not all at the end — so an interrupted session keeps
its progress; `createSignedUploads` **skips files already registered** for the pack (by
relative path), so re-dropping the same folder re-uploads only what's missing.
`startProcessing` enqueues once (idempotent). The worker dedupes by **content hash**
(zip-vs-unzipped). Folder-first is the reliability win: many small parallel transfers
beat one fragile 155 MB ZIP.

**Uppy + TUS resumable** stays the intended transport upgrade for very large packs
(cross-session resume), but needs a Storage **RLS policy** for browser-side TUS — defer
until real usage shows a need; the folder/relativePath plumbing already in place stays.

---

## 11. Libraries

| Need | Use | Status |
|---|---|---|
| Folder upload, resumable-by-re-drop, retries, progress | custom uploader (Uppy + TUS = later) | ✅ built |
| Unzip (dedupe) | **fflate** | ✅ have |
| Page text / classification | **pdfjs-dist** | ✅ have |
| Combined-PDF assembly | **pdf-lib** | ✅ have |
| AI structure pass + relevance triage | **@anthropic-ai/sdk** (text; a fast model, strict schema, low temp) | ✅ SDK have |

---

## 12. Build order (recommended)

1. ✅ **DONE — "group everything + per-page relevance tag"** + the review
   **preview-relevant / open-full-everything** split (§5).
2. ✅ **DONE — AI structure pass + deterministic apply** (§3–§4): AI infers the recipe,
   `compileRecipe` → `groupPack`; deterministic-profile then legacy fallback.
3. ✅ **DONE — In-pack answer-key cross-check** (§7): read the pack's take-off/schedule
   sheet, cross-check grouped names → matched/missing/extra, surfaced in the confirm screen.
4. ✅ **DONE — Tier-2 LLM relevance triage** (§6): re-judge uncertain not-relevant pages
   by meaning (rescue-only, batched, account-for-every-page); `env.groupingAI`.
5. ✅ **DONE (rename / merge / exclude) — Override UI** (§4.7): fix the grouping in the
   confirm screen before extraction. File-level reassign + split are a follow-up.

**Later / optional (not near-term):**
- **Recipe caching** (§8) — persist a confirmed learned recipe and reuse it on repeat
  packs. A pure optimisation: the AI structure pass is already cheap (pennies/pack), and
  caching adds real complexity (matching a pack to a builder, and detecting/invalidating
  a **stale** recipe when a builder changes their packaging). Add only if high volume
  from a few repeat builders makes cost or run-to-run variance worth removing.

*(Out of scope for now: an offline grading harness, and OCR/vision rescue of raster
PDFs — see the STATUS note.)*

---

## 13. Defaults chosen (flag to change) + open questions

**Defaults (recommended):**
- **Relevant pages first** in the combined PDF; extraction reads the contiguous relevant
  range; preview filters to relevant; open-full shows all.
- **Include-if-unsure** for relevance (recall > precision), always flagged.
- **AI reasons over TEXT** — for both grouping and relevance triage (no images for now).
- **Config & plots from filenames/answer key** proposed to the human, not auto-applied.
- **Raster (no-text) PDFs** are flagged for a human, not OCR'd (out of scope for now).

**⚠️ Open:**
1. Answer-key parsing — how reliably can the take-off/register sheet be read to a
   house-type list (its own small extraction problem)?
2. Very large dossiers — cap/limit or stream assembly; what page count triggers a warning?
3. Recipe-cache invalidation — when a builder changes their packaging, how is a stale
   learned recipe detected and re-inferred?
4. Apartment blocks — the whole-block take-off rules (docs/11 §7a) joined to grouping.

---

*Sources: `data/first-ones-sent/` (gitignored — four real builder packs as fixtures).
Research: [structured-output reliability in production](https://tianpan.co/blog/2025-10-29-structured-outputs-llm-production),
[structured JSON prompting guide](https://genaiunplugged.substack.com/p/structured-outputs-json-prompts-guide),
[LLM rule generalization](https://www.nature.com/articles/s41598-025-15627-z.pdf),
[risk-based human review](https://arxiv.org/pdf/2510.23874).
Cross-refs: `docs/13` (extraction playbook — unchanged downstream of the relevant pages),
`docs/11` (take-off spec), `ARCHITECTURE.md`. Update this doc as ⚠️ items resolve and the
build-order status changes.*
