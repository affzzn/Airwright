# 02 · PRD — Build 1: Quote & Take-off Engine (~7 weeks)

## Goal

Take a house builder's drawing pack + plot list, do the scaffold take-off with
AI assistance, let **Colin review and correct it fast**, and produce a priced
client quote for **both housebuilding and construction** — laid out and
reconciled the way Colin already works. Quicker and smoother than his
spreadsheets, and correct enough that he trusts it.

**Primary user: Colin.** Secondary: Laura + office (view/export). Admin: rates,
house types.

## Five things that shape the whole build

1. **A take-off is a list of staged operations, not "perimeter × rate".** The
   real unit of pricing is an *operation*: erect or dismantle, of a component
   (lift, gable, loading bay, birdcage, render), on a specific plot.
2. **Dismantle & stage splits are derived by percentage.** Enter/measure once,
   derive the stages — the numbers cannot drift apart (a correctness feature).
3. **Two estimating modes.** House-build (per plot / house type, matrix-shaped,
   config splits) vs Construction (per elevation, bespoke, hire weeks / permits /
   access / ground conditions). Different shapes; both from the start.
4. **A house type is a reusable identity: builder + type code.** Standard Miller
   / Lovell types repeat across plots and sites. Priced once, never re-measured.
5. **Colin's spreadsheet layout is the correctness benchmark.** Output must
   reconcile the way his does (stages sum to plot; plots + garages sum to grand
   total).

## Weekly plan

- **W1 — Foundation + first drawing intake.** Repo, schema, upload → Storage,
  extraction pipeline (pg-boss + Claude tool-use), oversized-pack split,
  read-only review view. ← **this codebase**
- **W2 — Full tender packs + sheet classification.** Multi-file upload; classify
  sheets (elevation / floor plan / plot layout / spec / other), surface
  elevations; segment into house types; plot-list ingestion (plot → type +
  config); flag unreadable rasters.
- **W3 — Drawings + plot list → staged take-off.** Perimeter from individual
  wall lengths (traceable); lifts from height (**Colin's rule**); build the
  staged operation list; detached/semi/terraced splits; shared-scaffold split.
- **W4 — Pricing (both modes) + review screen + exports.** Deterministic pricing
  engine (pure, unit-tested), percentage-derived stages, versioned rate cards,
  reconciliation enforced, editable review screen, Strike-ready + Excel export.
- **W5 — Accuracy testing** against all real packs.
- **W6 — Edge cases, hardening, security.**
- **W7 — Refine, polish, sign-off.**

## ⚠ Two rules that gate correctness — get from Colin, never infer

1. **Height → number of lifts** mapping.
2. **Exact percentage splits** for erect / birdcage / dismantle.

Book the Week-3 session with Colin to confirm both **before** hardening the
pricing engine.

## Explicitly out of scope for Build 1

Gang pay / self-bill (Build 2 — the staged model + `payPercent` hook feed it),
cross-project house-type bank (Build 3), WhatsApp handover, applications for
payment, payroll, Sage, scaffolder profiles, any write-back into Strike/Sage.
