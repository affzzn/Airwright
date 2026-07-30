# 04 · Data Model

Full schema: [`prisma/schema.prisma`](../prisma/schema.prisma).

## The pipeline the schema models

```
Extraction  →  Measurements + WallSegments   (traceable, per-field confidence)
            →  [Colin confirms]
            →  ScaffoldOperations             (typed, staged, priced)
            →  per Plot + config + RateCard
            →  QuoteLineItems                 (immutable snapshot)
```

## Why it's shaped this way

- **`Document` vs `HouseType`** are separate, linked by `Extraction.pageRange` —
  because one PDF can contain several house types, and one house type can span
  several files/sheets.
- **`TakeoffMeasurement` + `WallSegment`** are the *review / provenance* layer:
  every field carries `confidence`, `sourceSheet`, `sourceDimension` and an
  `ambiguous` flag, so the review screen shows where each number came from and
  ambiguous ones float to the top. Perimeter is **assembled from wall segments**,
  never a single opaque number.
- **`ScaffoldOperation`** is the *engine* layer and the real pricing unit:
  `component × action (ERECT/DISMANTLE) × liftLevel × quantity`, with `MAIN` /
  `GARAGE` groups. Typed, so the deterministic pricing engine reads it directly.
- **`RateCard` + `StageSplit`** — rates are versioned/effective-dated (Colin
  reprices every 3–4 months); the **percentage splits live here as configurable
  rules**, so stages stay consistent by construction. Old quotes stay frozen on
  the rates they were made with.
- **`Quote` + `QuoteLineItem`** are an **immutable snapshot** — quantity + rate +
  amount frozen at quote time. Re-quotes are new versions.
- **`HouseType`** carries `clientId + code` — the identity the repeat matcher
  (Build 3) keys on. First-class even in Build 1.
- **Two modes**: `Project.estimatingMode`, `ConstructionRateItem` (bespoke
  catalogue), `ConstructionScope` (hire weeks / permits / access / ground).
- **`payPercent`** on `RateItem` is the unused Build-2 gang-pay hook.
- **`AuditLog`** records every money-touching action.

## Provenance & evals

`Extraction.rawOutput` stores exactly what the model returned. Correction-rate
(the north-star quality metric) = `rawOutput` vs the confirmed `Takeoff`.

## Design decisions worth knowing

- **Typed operations, not EAV, for the engine.** Measurements use a
  per-field table (uniform confidence + traceability); operations use typed
  columns (deterministic pricing).
- **Render is per-plot** (`Plot.isRendered`), not per-house-type — same type,
  some plots rendered, some not.
- **Storeys is `Decimal(3,1)`** to hold 2.5.
- **`onDelete`** behaviours are set (cascade from Project/Pack/Takeoff; restrict
  where a HouseType still has plots).
