# 19 · Construction Estimator — Spec & Build Plan (a separate, manual path)

**What this is.** The canonical spec + technical build plan for the **Construction
estimating mode** — a *completely separate* path from the house-build side
(Traditional + Timber-Frame). It is built from the two Colin/Laura/Ben calls (9 Sep
"Construction Walkthrough" + 16 Sep "Strike Construction Walkthrough", both in the
session record) and the real worked example in `data/construction/eg-01/` (Wren Park,
Stepnell — the "detailed dream quote" walked through on the 16 Sep call). Read
`docs/03` (glossary) and `docs/15` (house-build pricing) for the shared scaffold
vocabulary; **nothing in the house-build take-off/pricing engine is touched by this** —
construction is a parallel route with its own models, its own screens and its own maths.

> **STATUS (2026-09-17): ✅ BUILT (Tracks A–F).** The full construction estimator is wired
> end-to-end: data model + migration `construction_estimator` (6 models + 3 enums, purely
> additive); the seeded element library (13 items); the pure pricing + rules core
> (`src/lib/construction/{price,rules}.ts`, 19 tests, reproduces the Wren schedule); the
> Rates → Construction tab (library editor); the `/construction` area (workspace, new-quote
> form, the 5-panel builder with per-lift + per-bracket pricing, live totals, suggestion
> chips, attachments upload, assumptions); and the output (print view + Excel in the Wren
> schedule layout). Green: typecheck + lint + **333 tests** + production build; verified with a
> real-DB backend round-trip. Rates are **placeholders** until Colin's real construction rate
> sheet lands (a few real rates seen on screen are the §5 seed placeholders). Files: §14.

> Legend: **✅ CONFIRMED** (from the calls/example — build it) · **⚠️ CONFIRM** (needs a
> Colin/Laura answer — flag, don't guess) · **🔧** (a code/schema change) · **🚫 OUT OF
> SCOPE** (explicitly not building now).

---

## 0. The one big idea — construction is the OPPOSITE of house-build

| | House-build (Traditional / Timber-Frame) | **Construction (this doc)** |
|---|---|---|
| Unit of work | a repeating **house type** across an estate of plots | a **one-off bespoke job** (school, office, National Grid, refurb) |
| How the take-off is made | the **AI reads the drawing** → a deterministic engine derives lifts/perimeter/birdcage → Colin checks | **Colin measures & decides himself** → the tool just holds the menu and does the maths |
| The rules | fixed (`ceil(h/1.5)`, birdcage = internal area, party wall…) | **no derivation rules** — Colin picks items off a **picking list** and enters quantities |
| AI involvement | heavy (extraction, grouping) | **NONE** — see §3 |
| Pricing shape | matrix per plot, stage splits (50/25/25…) | **line-per-item**, everything **per lift**, plus **hire** (weeks) |

**The mental model:** house-build = *the tool measures, the human checks*. Construction =
*the human measures, the tool calculates and files the paperwork*. Same app, opposite
direction. The construction estimator is a **structured manual quote builder** backed by a
**configurable element library** (the "picking list") — it must let Colin build an accurate
quote even when the enquiry is vague or changes after a phone call.

---

## 1. The domain (ground truth from the two calls)

### 1.1 What a construction job is
Bespoke commercial/industrial scaffolding, priced job-by-job for a **main contractor** (the
enquiry usually comes from their **QS / planner**, e.g. Stepnell's Haris Younis on Wren
Park). No repeating types; every job is measured fresh.

### 1.2 How enquiries arrive (three shapes, vague → perfect)
1. **Vague** — an email + a bird's-eye photo + a sentence or two. No dimensions. (Colin then
   measures off Google Earth **by hand**.)
2. **Scope of works (Excel)** — the client lists exactly what they want, row by row, with
   locations and sometimes measurements. **A pricing document.**
3. **Detailed** — photos + written description + **marked-up technical drawings** with every
   measurement + lift count already on them (the Wren Park example — "the dream ones").

> **The governing rule (Ben, firmly):** construction scope is **matter-of-fact — you price
> exactly what is asked, no more, no less.** If the client misses something, you don't add it.
> This is the **opposite** of house-build (where scope can be vague/over-inclusive and judgment
> fills gaps). ✅

### 1.3 The picking list (the heart of it)
A **pre-set library of every scaffold item Airwright can build, each with a rate**. Estimating
a job = go down the scope, **pick the items, set a quantity + number of lifts on each, add it
up**. Not every item is used on every job. **A human adds new items** when a job needs one that
isn't there yet — never auto-invented. Over time the library approaches complete.

### 1.4 Everything is priced PER LIFT
Construction meterage is entered/priced **per lift** (Wren: `42.2 m × 3 lifts`, `35.2 m × 2
lifts`), never as one lump. This also **corrected a house-build rule** (16 Sep call): loading
bays, Haki staircases and rubbish chutes should be priced **per lift** there too (mirrors gang
pay) — noted here, tracked as a small house-build follow-up, **not part of this build**.

### 1.5 Height brackets (rate depends on height) ✅ per-bracket confirmed
Rates are banded by building height: **≤6 m · 6–12 m · 12–18 m …**. A 4 m school prices in the
"≤6 m" bracket. Colin picks the bracket from the height he measured. **Each item can carry a
different rate per bracket** (user-confirmed 2026-09-17 — the library is per-bracket, not one
flat rate).

### 1.6 Hire — the genuinely new money concept (two parts)
- **Inclusive hire** — a **flat price for a set period** (usually **4 weeks**; Wren = 10). Up
  for 1 week or 4, same price; the weeks are *built into* the quoted figure.
- **Extra hire** — a **weekly charge for every week beyond** the inclusive period. Applied
  **automatically**; a part-week rounds **up** to a full week. **⚠️ Initial rule: 0.05% of the
  total job cost per extra week** (Laura to confirm the exact calculation in writing).
- **Inspections** — charged **per hire week** (4 weeks hire → 4 inspections; extra weeks add
  inspections too).

### 1.7 Terminology is messy — map it, don't expect uniformity
The client's words ≠ the picking-list words ≠ Strike's words. Same physical thing, three names
("Safegate" = lift gate; "working platform" = independent scaffold = Strike's "ConInscaff";
"crash deck" = birdcage). Ben: *"you'll never get it uniform."* The library carries the
**canonical Airwright name** + optional aliases; the estimator maps a client term to it by
hand. (Laura is sending a terminology list.)

### 1.8 Terminology quick-reference (the items that came up)
| Item | Plain meaning | Unit |
|---|---|---|
| **Independent scaffold / working platform** | the boarded platform workers stand on, freestanding beside the building | m **per lift** |
| **Edge protection / handrail** | rail to stop a fall; **single / double / triple** | m (per lift or perimeter) |
| **Toe board** | board at the base of a handrail (part of a standard double) | m / included |
| **Birdcage (crash deck)** | internal deck filling a floor | m² **per lift** |
| **Haki stair tower** | proprietary staircase access tower; **counts as 3 lifts** | per lift (inflated rate) |
| **Loading bay** | reinforced materials-lifting spot, on a 3.6×2.4 grid | nr **per lift** |
| **Rubbish chute / skip bay** | waste route down the scaffold | nr per lift |
| **Lift gate ("Safegate")** | gated doorway at a lift-shaft opening; one per lift entrance per floor | nr |
| **Scaffold mat / dummy lift** | temp lift put in then removed so a 2.7 m first "walking lift" can be built (schools, public streets, 3 m lifts) | nr (1st lift) |
| **Foam protection** | padding on uprights at doorways/fire exits/walk-unders | nr / m |
| **Roof edge protection** | handrail around a roof edge — defaults to **triple** | m |
| **Inspections** | statutory weekly inspection | per week |
| **Extra hire** | charge beyond the inclusive weeks | per week |

Colin's tolerance philosophy (matches the app's confidence idea): being out by 100–200 mm is
fine — "have a go, roughly right." What matters is not missing a whole item or a height bracket.

---

## 2. Worked example — Wren Park (`data/construction/eg-01/`)

The real "dream" enquiry from Stepnell (files gitignored PII). It is the reference fixture for
the builder + the output format.

**Files (all reference-only — displayed, NEVER parsed):**
- `Re_ Scaffolding quote - Wren Park - Air wright.eml` — the enquiry email (scope in prose:
  *"scaffold wrap around the building for brickwork lifts; access scaffold to the roof with
  edge protection; crash decks in each classroom for roof lights"*).
- `Wren park elevation plan.pdf` / `…2.pdf`, `wren park roofing plan.pdf`, `Wren park skylight
  locations.pdf`, `wren park way in to site and overall site plan.pdf` — drawings.
- `Wren - Scaffolding Measure.pdf` — the **marked-up** drawing (blue = 3-lift external, red =
  2-lift birdcage, green = handrail perimeter).
- **`Wren - Scaffolding Schedule.xlsx` — THE KEY FILE.** This is Airwright's own
  scaffolding-schedule template = **the exact shape of our quote builder + output.**

**Decoded schedule (the columns ARE our line-item model):**

> Columns: **Item · Nr of Lifts · Unit · Quantity · Rate · Duration (weeks) · Total Cost · Notes**, plus a **Weekly Inspections** row.

| Item | Nr of Lifts | Unit | Quantity | Duration |
|---|---|---|---|---|
| Haki Stair Tower | 2 | nr | 1 | 10 wk |
| Haki Stair Tower | 3 | nr | 1 | 10 wk |
| Loading Bay | 2 | nr | 1 | 10 wk |
| Loading Bay | 3 | nr | 1 | 10 wk |
| Progressive Internal Birdcage Scaffold | 2 | m² | 203.34 | 10 wk |
| Progressive Internal Birdcage Scaffold | 3 | m² | 123.88 | 10 wk |
| Roof Edge Protection | — | m | 77.357 | 10 wk |
| Progressive External Perimetre | 2 | m | 35.157 | 10 wk |
| Progressive External Perimetre | 3 | m | 42.199 | 10 wk |
| **Weekly Inspections** | | | | |

("Progressive" = progressive dismantle. Note the **same item repeats per lift count** — the
per-lift model in §1.4. `42.199 → 42.2` shows the sensible rounding.) The estimator would type
these rows straight in from the marked-up drawing; on a vague enquiry they'd come from Colin's
own Google-Earth measure instead.

**How the example is used in the build:** it is (a) the **acceptance fixture** for the quote
builder (reproduce this schedule + a grand total), (b) the **column layout** for the Excel/print
output, and (c) the demonstration that attachments are **reference material a human reads**, not
something we parse.

---

## 3. Scope & non-goals (read this twice)

**🚫 EXPLICITLY OUT OF SCOPE — do NOT build (user-confirmed 2026-09-17):**
- **No AI extraction from construction drawings/plans.** (It works for Traditional/Timber-Frame;
  construction drawings are too varied/hard.) Attachments are uploaded, stored and **shown for a
  human to read** — never sent to a model, never classified, never measured.
- **No Google-Earth automation** — no AI, no API, no geocoding. Colin does the Google-Earth
  measuring **himself** and **types the numbers in**.
- No plot/house-type concepts, no stage splits (50/25/25), no matrix, no birdcage-derivation
  engine — none of the house-build machinery applies.

**✅ IN SCOPE — the first release (this doc):**
1. Manual **Construction Quote** creation (customer, site, duration, attachments).
2. The **scaffold element library** (picking list) + **per-lift, per-bracket** pricing.
3. The **rules** as editable pre-fill defaults (handrails, Haki, mat, foam, inspections, extra hire).
4. **Attachment review** (upload + view only).
5. **Editable quote lines + a measurement sheet + an assumptions list**, then a **quote output**.

**The bar:** an estimator can build an accurate quote even when the enquiry is vague or changes
after a phone call — every value manual, every auto-added line visible and editable.

---

## 4. Data model (new — a parallel island, migration `construction_estimator`)

Reuse what exists where it fits; add construction-specific models. **All new, additive — the
house-build tables are untouched.**

### 4.1 Reused / existing
- `Project.estimatingMode = CONSTRUCTION` — a construction quote hangs off a Project in this
  mode (created from the new `/construction` area; it never shows the house-build screens).
- `Unit` enum — extend for construction units (§4.4).
- `RateBand` — the commercial band still applies (competitive/medium/…).

### 4.2 🔧 `ConstructionElement` (the picking-list item — supersedes the thin `ConstructionRateItem`)
The configurable library row. **Per-bracket rates live in a child table** (§4.3).
```
id                String   @id @default(cuid())
clientId          String?  // null = global Airwright library; set = client-specific override
name              String   // canonical Airwright name, e.g. "Independent Scaffold"
aliases           String[] // client/Strike synonyms ("working platform","ConInscaff","crash deck")
category          String?  // grouping for the picker (Access / Protection / Internal / Extras)
unit              ConstructionUnit           // LM_PER_LIFT | M2_PER_LIFT | NR_PER_LIFT | NR | LM | PER_WEEK | FIXED
usesLifts         Boolean  @default(true)    // does "Nr of Lifts" apply?
usesHeightBracket Boolean  @default(true)    // do per-bracket rates apply, or one flat rate?
defaultRuleNote   String?  // the pre-fill hint shown in the builder (e.g. "roof edge → triple")
sortOrder         Int      @default(0)
isActive          Boolean  @default(true)
rates             ConstructionRate[]
```

### 4.3 🔧 `ConstructionRate` (per-element, per-bracket, per-band rate)
```
id         String @id @default(cuid())
elementId  String
element    ConstructionElement @relation(...)
band       RateBand
bracket    HeightBracket   // UP_TO_6M | H6_12M | H12_18M | H18_24M | ANY (for bracket-agnostic items)
rate       Decimal @db.Decimal(10,2)   // £ per the element's unit
@@unique([elementId, band, bracket])
```
> Lookup ladder (mirrors the house-build resolver): exact `(band, bracket)` → `(band, ANY)` →
> null (unpriced → £0 + flagged). A flat-rate item stores everything under `bracket = ANY`.

### 4.4 🔧 Enums
```
enum ConstructionUnit { LM_PER_LIFT  M2_PER_LIFT  NR_PER_LIFT  NR  LM  M2  PER_WEEK  FIXED }
enum HeightBracket    { UP_TO_6M  H6_12M  H12_18M  H18_24M  ANY }
enum SiteType         { SCHOOL  PUBLIC_STREET  CONSTRUCTION_SITE  COMMERCIAL  OTHER }  // drives mat/foam rules
```

### 4.5 🔧 `ConstructionQuote` (the container)
```
id            String @id @default(cuid())
projectId     String            // Project (estimatingMode = CONSTRUCTION)
reference     String?           // e.g. "Wren Park"
customerName  String?
siteAddress   String?
enquiryType   String?           // VAGUE | SCOPE_OF_WORKS | DETAILED (metadata)
band          RateBand @default(COMPETITIVE)
durationWeeks Int?              // inclusive hire period (Wren = 10; typical 4)
extraHirePctPerWeek Decimal? @db.Decimal(5,3) @default(0.05)  // ⚠️ Laura to confirm
// --- Enquiry-review capture (spec §2): the site facts the rules key off, entered by hand ---
siteType      SiteType?         // school / public street / construction site → mat + foam rules
buildingHeightM     Decimal? @db.Decimal(6,2)  // Colin's measured height → picks the bracket + lift hint
defaultHeightBracket HeightBracket?            // the bracket most lines default to
doorwayCount        Int?        // doorways needing foam (spec §2 access points)
fireExitCount       Int?        // fire exits needing foam
pedestrianAccessCount Int?      // walk-under pedestrian routes needing foam
status        String   @default("DRAFT")   // DRAFT | CONFIRMED (frozen) | QUOTED
notes         String?
assumptions   Json?             // the confirmed assumptions/exclusions list
confirmedAt   DateTime?
createdAt     DateTime @default(now())
measurements  ConstructionMeasurement[]
lines         ConstructionQuoteLine[]
attachments   ConstructionAttachment[]
```

### 4.6 🔧 `ConstructionMeasurement` (kept SEPARATE from the priced lines — spec point 3)
What Colin measured himself; the lines reference these but aren't overwritten by an edit.
```
id            String @id
quoteId       String
label         String            // "Blue external perimeter", "Roof handrail perimeter"…
kind          String            // PERIMETER_LM | BIRDCAGE_M2 | HANDRAIL_LM | HEIGHT_M | LIFTS | AREA_LM
valueNumber   Decimal @db.Decimal(10,3)
lifts         Int?
heightBracket HeightBracket?
source        String?           // GOOGLE_EARTH | DRAWING | CLIENT_SCOPE | MANUAL
note          String?
```

### 4.7 🔧 `ConstructionQuoteLine` (the à-la-carte priced line)
```
id            String @id
quoteId       String
elementId     String?           // the library item (null = a one-off manual add)
description   String            // the item name as it prints (editable; may differ from element.name)
lifts         Int?              // "Nr of Lifts"
unit          ConstructionUnit
quantity      Decimal @db.Decimal(10,3)
heightBracket HeightBracket?
rate          Decimal @db.Decimal(10,2)   // resolved from the library, or hand-entered
durationWeeks Int?              // usually = quote.durationWeeks; overridable per line
amount        Decimal @db.Decimal(12,2)   // computed (§7), frozen on confirm
isAuto        Boolean @default(false)     // rule-suggested vs hand-added (all editable)
sortOrder     Int     @default(0)
note          String?
```

### 4.8 🔧 `ConstructionAttachment` (reference files — NEVER parsed)
```
id            String @id
quoteId       String
fileName      String
storageBucket String @default("tender-packs")
storagePath   String
mimeType      String
sizeBytes     Int?
kind          String?   // EMAIL | DRAWING | SITE_PLAN | ROOF_PLAN | LOGISTICS_PLAN | PHOTO | SCOPE | OTHER (a human tag)
createdAt     DateTime @default(now())
```

> **Retire** the thin `ConstructionRateItem` after migrating (or leave it dormant — it's unused).
> `ConstructionScope` (hireWeeks/access/notes) is folded into `ConstructionQuote`; leave the model
> for now.

---

## 5. The scaffold element library (seed — placeholders)

Seed the **global** library (`clientId = null`). Units + rules are ✅ from the calls; **£ rates
are ⚠️ placeholders** (a few real ones were seen on the recording — flagged; swap in Colin's
Google-Drive sheet). Every item is editable on the Construction rates tab (§9).

| Element | Unit | Uses lifts? | Bracketed? | Placeholder rate | Rule note |
|---|---|---|---|---|---|
| Independent Scaffold (working platform) | `LM_PER_LIFT` | ✅ | ✅ | £ tbd / m / lift | "= working platform" |
| Double Handrail (+ toe board) | `LM_PER_LIFT` | ✅ | ✅ | **£25.61 / m** (seen) | standard scaffold handrail |
| Single / Additional Handrail | `LM_PER_LIFT` | ✅ | ✅ | **£7.75 / m** (seen) | only when a steel/obstruction blocks a double |
| Triple Handrail (roof/edge) | `LM` | — | ✅ | = double + single | **roof/edge default** |
| Toe Board | `LM_PER_LIFT` | ✅ | — | £ tbd | usually part of a double |
| Haki Stair Tower | `NR_PER_LIFT` | ✅ (**=3 lifts**) | ✅ | £ tbd (inflated) | kicker + to-1st + to-2nd |
| Loading Bay | `NR_PER_LIFT` | ✅ | ✅ | £ tbd | 3.6×2.4 grid; per lift |
| Rubbish Chute / Skip Bay | `NR_PER_LIFT` | ✅ | — | £ tbd | per lift |
| Internal Birdcage (crash deck) | `M2_PER_LIFT` | ✅ | — | £ tbd / m² / lift | progressive dismantle |
| Lift Gate ("Safegate") | `NR` | — | — | £ tbd | one per lift entrance per floor |
| Scaffold Mat / Dummy Lift | `NR` | — | — | **£33** (seen, 1st lift) | schools/public streets/2.7 m 1st lift |
| Foam Protection | `NR` | — | — | £ tbd | doorways/fire exits/walk-unders |
| Weekly Inspection | `PER_WEEK` | — | — | £ tbd / week | one per hire week |
| Extra Hire | `PER_WEEK` | — | — | 0.05% job/wk | auto beyond duration |

---

## 6. The rules engine (editable pre-fill defaults — NOT gospel)

With no AI, "rules" are just **smart defaults that pre-fill the builder**, each **visible and
overridable** before finalising (spec point 5). Pure + unit-tested (`lib/construction/rules.ts`).

1. **Terminology map** — working platform → Independent Scaffold; edge protection → handrail;
   crash deck → birdcage (via `element.aliases`).
2. **Handrail default** — a **roof / building-edge** handrail defaults to **triple**; a standard
   scaffold handrail = **double + toe board**; **single** only for an obstruction. ✅
3. **Haki = 3 lifts.** ✅ (pre-fill `lifts = 3`.)
4. **Scaffold mat** — auto-suggested when `siteType ∈ {SCHOOL, PUBLIC_STREET}` or a 2.7 m first
   lift is set; first lift only. ✅
5. **Foam** — auto-suggested at doorways / fire exits / pedestrian walk-unders (a manual count). ✅
6. **Height bracket** — a ~4 m building → `UP_TO_6M`, normally **2 lifts** (a hint, editable). ✅
7. **Per-lift** — Loading Bay / Haki / Rubbish Chute are entered **per lift**, never one lump. ✅
8. **Inspections** — auto-add `durationWeeks` inspection weeks. ✅
9. **Extra hire** — auto line: `0.05% × jobCost` per week **beyond** `durationWeeks`; a part-week
   rounds up. ⚠️ confirm the exact %/basis with Laura.

Every rule writes an **`isAuto = true`** line the estimator can edit or delete. Nothing is
locked.

---

## 7. Pricing & calculation (`lib/construction/price.ts`, pure + tested)

**Per-line amount** (integer pence internally, £ 2dp out — same discipline as house-build):
```
qtyEffective = quantity × (usesLifts ? (lifts ?? 1) : 1)
lineAmount   = qtyEffective × rate            // rate resolved by (band, bracket) ladder, §4.3
```
- `LM_PER_LIFT` / `M2_PER_LIFT` / `NR_PER_LIFT` multiply by `lifts`. `LM`, `M2`, `NR`, `FIXED`
  do not. `PER_WEEK` multiplies by weeks (inspections/extra hire).
- **Rounding:** measurements rounded sensibly at entry (42.198 → 42.2); money to the penny.

**Quote total:**
```
itemsSubtotal   = Σ lineAmount (excl. extra hire)
inspectionsCost = inspectionRate × durationWeeks           // if the inspection line is present
jobCost         = itemsSubtotal + inspectionsCost          // the "total job cost" hire is based on
quoteTotal      = jobCost                                   // extra hire is a CONDITIONAL add-on
```
**Extra hire (shown as terms + an on-demand calc, not in the base total):**
```
extraHirePerWeek = round2(jobCost × extraHirePctPerWeek/100)   // 0.05% → jobCost × 0.0005
// billed automatically per week beyond durationWeeks; a part-week rounds up
```
> Extra hire is presented as a **rate + terms** on the quote (like Strike), not baked into the
> headline figure — the headline is the inclusive-period price. ⚠️ confirm with Laura whether
> extra hire is quoted as a line or only as terms.

**Reconciliation:** `quoteTotal = Σ line amounts (+ inspections)` to the penny — the same
"subtotal = Σ lines" guarantee as house-build, so the printed quote always adds up.

---

## 8. Routes & screens (its own `/construction` area — ✅ separate)

A top-level section, its own nav entry, never mixed with the tender/house-build screens.

| Route | Screen | Does |
|---|---|---|
| `/construction` | **Construction workspace** | list of construction quotes (search/status), **"New construction quote"** button |
| `/construction/new` | **New quote** | customer, site address, band, duration (weeks), enquiry type, notes; **attachment upload** (reuse the signed-URL uploader — store only) |
| `/construction/[id]` | **Quote builder** (the main screen) | 5 panels: **Attachments** (view drawings/email) · **Enquiry review** (site facts) · **Measurements** (manual entry) · **Line builder** (picking list) · **Assumptions/validation**. Live total. |
| `/construction/[id]/quote` | **Quote output** | print-ready client quote + Excel export (Wren schedule layout) |

**Enquiry-review panel (spec §2 — the manual "input" step, no AI):** a structured form where
the estimator enters or confirms the **site facts the rules key off**, all by hand:
- **Site type** (school / public street / construction site / commercial) → drives the scaffold-mat
  + foam suggestions.
- **Building height** (Colin's own measure) → pre-selects the **height bracket** + a lift hint
  (~4 m → `UP_TO_6M`, 2 lifts).
- **Access points** — doorway / fire-exit / pedestrian-walk-under counts → drive the **foam**
  suggestion.
- **Areas / elevations requiring scaffold** — free rows that seed the measurement sheet.
- **Requested items** — a quick checklist (Haki / loading bay / rubbish chute / birdcage / roof
  edge protection / working platform / edge protection) that pre-adds those library lines to the
  builder. Every field is **manually enter-or-correct**; a vague enquiry is filled from Colin's
  Google-Earth / manual estimate (marked `source` so it prints as an assumption).

**Quote-builder UX (spec points 2, 6):**
- **Attachments panel** — thumbnails/links to the uploaded drawings, email, site/roof plans;
  open in a lightbox/new tab. Read-only reference (Colin measures from these by eye).
- **Measurement sheet** — add rows (label, kind, value, lifts, bracket, source); rounded on entry.
- **Line builder** — **pick an element** from the library (searchable, grouped by category) →
  a row appears pre-filled from the rules (unit, default lifts, resolved rate) → edit **qty,
  lifts, bracket, rate, duration, notes**. **Show the formula behind every line**
  (`42.2 m × 3 lifts × £rate = £amount`). **Duplicate** an item across lifts/areas (Loading Bay
  — Lift 2, Loading Bay — Lift 3). Remove / manual override any line. **"Add custom item"** →
  free-text name + unit + hand-entered rate (for anything not in the library).
- **Assumptions/validation** — a checklist that must be acknowledged before generating (§11).

Everything editable; every auto-added line flagged and removable. Monochrome, matches the
existing design system (`docs/07`).

---

## 9. The Rates tab — split into THREE sections ✅

`/rates` becomes three tabs/sections (the house-build cards are unchanged; construction is new):
1. **Traditional** — the existing per-lift / per-floor / apex / render house-build rate card.
2. **Timber frame** — the TF components (external, adaptions, apex) — the existing TF rates.
3. **Construction** — **the element library editor**: add/edit/delete `ConstructionElement`
   rows; per element set unit, `usesLifts`, `usesHeightBracket`, and **a rate per (band, bracket)**
   grid (`ConstructionRate`); add a custom item + rate. This is where Colin swaps placeholders for
   his real sheet.

(Implementation note: Traditional vs Timber-Frame today share a house-build `RateCard` but use
different components; the split here is a **UI grouping** of the rates screen, plus a genuinely
separate construction library. No change to the house-build rate model.)

---

## 10. Quote output (`lib/construction/quoteExcel.ts` + a print view)

- **Print view** (`/construction/[id]/quote`) = the client quotation: header (customer/site/ref),
  **scope of works**, the **itemised lines** (item · lifts · unit · qty · rate · total), **hire
  duration**, **inspection allowance**, **extra-hire terms**, **assumptions & exclusions**, and
  **references to the attached drawings**. Print → PDF.
- **Excel export** — reproduce **Airwright's own schedule layout** (`Wren - Scaffolding
  Schedule.xlsx`): columns **Item · Nr of Lifts · Unit · Quantity · Rate · Duration · Total Cost
  · Notes** + a Weekly Inspections row + a grand total. Reuse the ExcelJS + formula-sanitisation
  approach from `pricing/quoteExcel.ts`.
- **Immutable snapshot on confirm** — freeze the lines/rates like the house-build `Quote` so a
  re-quote is a new version (construction quotes change a lot after phone calls — versioning
  matters).

---

## 11. Validation & assumptions (before generating — spec point 7)

Flag, as a checklist the estimator confirms (never blocks, but surfaces):
- Missing **duration** (weeks).
- Missing **height / bracket** or **lift count** on a bracketed/per-lift line.
- Missing **measurement** a line references.
- **Unclear handrail type** (single/double/triple not chosen).
- Unconfirmed **site constraints** (school/public → scaffold mat? foam?).
- Any value the estimator noted as **inferred** (Google Earth / drawing / client scope) — carried
  onto the quote as a stated **assumption**.

These print in the quote's **Assumptions & exclusions** block.

---

## 12. Build order (tracks, in order — first-release focus)

1. **Track A — data model.** The Prisma models + enums (§4); migration `construction_estimator`;
   seed the global element library with placeholder rates (§5). `npm run db:migrate` + `db:seed`.
2. **Track B — the pricing + rules core** (pure, unit-tested FIRST, like the house-build engine):
   `lib/construction/rules.ts` (defaults) + `price.ts` (per-lift, per-bracket, hire, inspections,
   reconciliation). **Acceptance test: reproduce the Wren Park schedule + grand total.**
3. **Track C — the Rates tab split** (§9) + the construction element-library editor + server
   actions (add/edit/delete element + rates).
4. **Track D — the `/construction` area:** workspace list, new-quote form, **attachment upload**
   (store/view only).
5. **Track E — the quote builder** (`/construction/[id]`): measurements panel, line builder
   (picking list + rules pre-fill + live formula + per-lift duplicates + custom add), assumptions.
6. **Track F — the output:** print view + Excel (Wren layout) + immutable confirm/version.

Run `typecheck && lint && test && build` at each track. Rates stay **placeholders** (flagged)
until Colin's real construction sheet lands — then swap on the Construction rates tab and validate
against a real priced job.

---

## 13. ⚠️ Still needs Colin / Laura (build the hook, flag, don't guess)
1. **The real rate sheet** — £ per element per bracket per band (Google-Drive export from the
   recording). Placeholders until then.
2. **Extra-hire calculation** — verbally 0.05% of job cost per week; confirm the exact % + basis,
   and whether it's a quoted line or terms-only.
3. **Inspection rate** + whether it's per week flat or scaled.
4. **Height brackets** — confirm the exact bands (≤6 / 6–12 / 12–18 / 18–24?).
5. **Terminology list** (Laura) — the client/Strike → Airwright name map to seed `aliases`.
6. **Handrail** — confirm triple = double + single pricing, and the roof-default rule.
7. **Per-lift house-build correction** (loading bay/Haki/chute) — a separate house-build follow-up
   noted here, not part of this build.

---

## 14a. Coverage matrix — the build skeleton (1–9) → where it lives in this spec

Every point of the agreed build skeleton, traced to its section, so nothing is dropped.

| # | Skeleton point | Covered in | Notes |
|---|---|---|---|
| **1** | New Construction Quote (customer, site, email/attachments, duration, notes/assumptions; upload drawings/plans/photos/logistics) | §4.5 `ConstructionQuote` · §4.8 `ConstructionAttachment` (+`LOGISTICS_PLAN` kind) · §8 `/construction/new` | ✅ |
| **2** | Enquiry review / manual input (scaffold type, edge protection, perimeter, height, lifts, areas/elevations, doorways/fire-exits/pedestrian access, site type, requested items) — manual add/correct; sparse → Google Earth/manual | §4.5 (siteType, buildingHeightM, access counts) · §4.6 measurements · §8 **Enquiry-review panel** | ✅ (gap closed 2026-09-17: added `siteType`, height, access-point capture + the dedicated review panel) |
| **3** | Measurement model kept separate (LM/area, lifts, birdcage m², bracket, handrail perimeter, per-lift placement; sensible rounding) | §4.6 `ConstructionMeasurement` · §7 rounding | ✅ |
| **4** | Element library (name/terminology, unit, rate, bracket/lift options, default rules, custom add + manual rate) + the initial items | §4.2 `ConstructionElement` · §4.3 `ConstructionRate` (per-bracket) · §5 seed table | ✅ all 11 initial items seeded |
| **5** | Rules engine (mapping, brackets, Haki=3, triple roof, double+toe, single-only, mat, foam, per-lift, inspections, extra hire) — all auto lines editable | §6 (rules 1–9) | ✅ every rule present + editable pre-fill |
| **6** | Quote builder (pick element; qty/unit/lifts/rate/notes; show formula; duplicate per lift/elevation; remove/override) + example | §8 quote-builder UX | ✅ example lines match |
| **7** | Validation & assumptions (missing duration/height/lifts/measurements, unclear handrail, unconfirmed constraints, inferred values) | §11 | ✅ |
| **8** | Quote output (scope, itemised, hire duration, inspection allowance, extra-hire terms, assumptions/exclusions, source refs) | §10 | ✅ |
| **9** | First-release focus (manual creation · library + per-lift pricing · rules · attachment review · editable lines + assumptions) | §3 in-scope · §12 build order | ✅ — and **no AI extraction** (§3) |

**Verdict:** all 9 points are now covered in full. The only gap on the first pass (point 2's
structured site-fact capture) has been closed with the `siteType`/height/access fields and the
Enquiry-review panel above.

---

## 14. File map (new — all under `construction`, nothing shared with house-build logic)

| Path | Role |
|---|---|
| `prisma/schema.prisma` | + `ConstructionElement`, `ConstructionRate`, `ConstructionQuote`, `ConstructionMeasurement`, `ConstructionQuoteLine`, `ConstructionAttachment`, enums |
| `prisma/seed.ts` | seed the global element library (§5) |
| `src/lib/construction/rules.ts` | editable pre-fill defaults (pure, tested) |
| `src/lib/construction/price.ts` | per-lift / per-bracket / hire / inspection maths (pure, tested) |
| `src/lib/construction/quoteExcel.ts` | Excel in the Wren schedule layout |
| `src/lib/construction/types.ts` | shared types |
| `src/server/actions/construction.ts` | quote CRUD, line CRUD, confirm/version, attachment finalize |
| `src/server/construction.ts` | load + price a construction quote (shared by page/export) |
| `src/app/construction/page.tsx` | workspace list + New button |
| `src/app/construction/new/page.tsx` | new-quote form + upload |
| `src/app/construction/[id]/page.tsx` | the quote builder |
| `src/app/construction/[id]/quote/{page.tsx,export/route.ts}` | output + Excel |
| `src/components/construction/*` | quote-builder, measurement-sheet, line-builder, element-library-editor, attachment-panel |
| `src/app/rates/*` | split into Traditional / Timber / **Construction** tabs |

---

## 15. Draft from enquiry — the ONE place AI belongs in construction ✅ BUILT (2026-09-22)

**The realisation.** House-build's "document" is the *drawings* (AI does the visual work). Construction's
drawings are too varied to read — but construction has a document house-build doesn't: the client's
**written scope-of-works** (the QS's Excel/text — *"whatever is listed is what gets priced,"* Ben). Reading
TEXT/tables is exactly where AI is reliable. So the one high-value AI job here is **turning the written
scope into draft picking-list lines** — the text twin of house-build's extract→review→confirm. It is
**optional per quote** and **cost-free when unused** (a vague email + photo → ignore it, build by hand).

**Still NO drawing reading, NO Google-Earth automation** (§3 stands): AI reads scope TEXT only.

**Flow.** `/construction/[id]` builder → **"Draft from enquiry"** → paste OR upload (.xlsx/.csv/.pdf/.txt) →
server extracts TEXT ONLY (ExcelJS rows → tab table; pdfjs text layer — never images) → shown in an
editable box → **one synchronous** `runToolText` call (forced tool, Zod→JSON schema, prompt-cached) maps
each scope line to a picking-list element by id, using `element.aliases` ("Safegate"→Lift Gate) → Zod
validate + **reject any invented id** (kept as an unmatched line, never dropped) → **review table**
(remap / edit qty+lifts / uncheck / map the unmatched) → **"Add N lines"** inserts them (`isAuto = true`,
rate resolved from the quote's band + `defaultHeightBracket`, client wording kept in the line note) →
pricing engine unchanged.

**Guardrails (the trust spine):** account for every scope line; recall > precision; **never invents a
library item** (a miss → a hand line the estimator finishes); quantities are the client's STATED numbers,
flagged to verify against the drawing by hand; **human confirms before anything prices**.

**Learns over time:** on a genuine **correction** (the estimator's final mapping ≠ the AI's guess) the
client's wording is saved as an `alias` on that element — so it auto-matches next time. (Learn on
corrections only, deduped — high-signal, not noisy.)

**Config:** `ANTHROPIC_CONSTRUCTION_MODEL` (defaults to the grouping model → extraction model) + the
`CONSTRUCTION_AI` flag (default on; `=false` hides the feature, fully-manual path). Model change is tiny +
additive: `ConstructionQuote.enquiryText` + `draftRawOutput` (migration `construction_draft_from_scope`).

**Files:** `src/lib/construction/{scopeSchema,scopePrompt,scopeDraft,draftFromScope,scopeText}.ts`
(+ `.test.ts` for the pure core + text extraction; the Wren-shape xlsx is the flatten fixture) ·
`src/server/actions/constructionDraft.ts` · `src/components/construction/draft-from-scope.tsx` (wired into
the line builder). Green: typecheck + lint + 355 tests + production build + a real-DB column round-trip.
**⚠ Rates stay placeholders** — drafting maps items + quantities; the £ still comes from the (placeholder)
library rates until Colin's sheet lands.

---

*Sources: the 9 Sep "Construction Walkthrough" + 16 Sep "Strike Construction Walkthrough" call
transcripts (session record) and `data/construction/eg-01/` (Wren Park — gitignored PII).
Cross-refs: `docs/03` (glossary), `docs/15` (house-build pricing), `docs/07` (design system),
`ARCHITECTURE.md`. This is a SEPARATE path from `docs/13/15/18` (Traditional/Timber-Frame): no AI
extraction, no drawing reading, no Google-Earth automation — a manual, human-driven quote builder.
Update this doc as the ⚠️ items resolve.*
