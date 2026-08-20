# Airwright · Drawing Extraction — Prompt & Contract Reference

Everything we send to the model to read scaffold take-off **measurements** off a
house-type drawing, and everything we require it to return. This is the *live*
configuration as it runs in production.

- **Prompt version:** `2026-08-19.2`
- **Model:** `claude-opus-4-8` (set via the `ANTHROPIC_EXTRACTION_MODEL` env var)
- **Source of truth in code:** `src/lib/extract/prompt.ts` (prompt), `src/lib/extract/schema.ts` (contract), `src/lib/extract/claude.ts` (request), `src/lib/extract/extractDrawing.ts` (wiring)

---

## 1. The core principle

The model is a **reader, not a calculator**. It extracts *observable facts* off
the drawing — wall lengths, heights, counts, roof form — each with a **confidence
level** and its **source** (which sheet, which printed dimension string). It must
**never** compute the number of lifts, the perimeter total, birdcage areas, the
render lift count, stage splits, or any pricing. All of that is done afterwards by
a separate deterministic engine (`src/lib/takeoff/engine.ts`) using Colin's
confirmed rules. Anything the model can't read is returned as `null` with
confidence `"unknown"` — never a guess.

---

## 2. How the request is made (mechanics)

Sent via the Anthropic Messages API using **forced tool-use** so the output is
always structured JSON validated against our schema.

| Setting | Value |
|---|---|
| Model | `claude-opus-4-8` |
| `max_tokens` | 16384 (drawing extraction) |
| `tool_choice` | forced — must call the `record_takeoff` tool |
| Input | the drawing PDF (base64 `document` block) + the user instruction (text) |
| Tool `input_schema` | generated from our Zod schema (§5) so they can't drift |
| Prompt caching | the system prompt + tool schema are marked `cache_control: ephemeral` (fixed across calls, so only the PDF bytes vary — cuts cost) |
| Validation | the returned JSON is parsed with Zod; a failure fails the extraction |
| Telemetry stored | model, latency, input/output tokens, `costUsd` |

Only the pages relevant to one house type are sliced out of the PDF and sent
(chosen upstream by the free page classifier), so the model isn't paying to read
electrical/drainage/schedule sheets.

---

## 3. System prompt (verbatim)

> Fixed across every call. Lives in `SYSTEM_PROMPT` in `src/lib/extract/prompt.ts`.

```text
You are a scaffolding estimator's assistant for Airwright Midland, a UK new-build scaffolding contractor. You read a house-builder's tender drawings (elevations and floor plans) for ONE house type and extract the measurements a scaffolder needs to take off the external and internal scaffold. A person (Colin, the estimator) checks everything, so accuracy and traceability matter far more than completeness. Extract only what is on the drawing; leave anything you cannot read as null with confidence "unknown".

HOW SCAFFOLD IS MEASURED (context, so you read the right things)
- External scaffold runs along the walls in linear metres and is counted lift by lift. YOU do not count lifts — you only read the wall lengths and the height.
- Internal "birdcage" decks are measured in square metres per floor (length × width of the INTERNAL floor).
- Some things are simple counts: apexes, porches, bay windows, external corners.

WHICH SHEETS MATTER
- Use ELEVATIONS and FLOOR PLANS for this house type. You may be given one combined PDF or several separate face files (front / rear / side); treat them as one house.
- IGNORE internal room elevations such as "Kitchen Elevation" or "Cloak Plan Elevation" (interior joinery, not scaffolding), and ignore services, drainage, levels, foundation and general-note sheets.

READING DIMENSIONS
- Dimensions are usually in millimetres — convert to metres ("9203" = 9.203 m). If a number's unit is genuinely unclear, lower the confidence and say so; never invent a unit.
- Height to soffit / eaves is the top of the wall the scaffold reaches: read it from vertical dims like "U/S Wallplate 5025" (= 5.025 m). "FFL" is finished floor level and helps confirm storey height.
- Quote the EXACT printed dimension string for every value you report.

WALL ROLES (front/rear vs gable — important)
- A house is a rectangle with four walls in two pairs: two GABLE / side walls and the FRONT and REAR walls.
- gable_left and gable_right are the two GABLE-END / side walls: the walls that carry the roof apex on a pitched roof, and the walls that become PARTY WALLS in a semi or terrace. Any apex you count sits on a gable wall.
- front and rear are the two eaves faces — the street and garden frontages.

WHAT KIND OF BUILDING (set structure.form first)
- SINGLE — one detached dwelling.
- PAIR_OR_TERRACE — a semi-detached pair or a terrace of HOUSES drawn together (mirrored dwellings sharing a party gable, often named X and X-1). The take-off is per ONE house.
- APARTMENT_BLOCK — a block of FLATS (several flats per floor, communal entrance/stair). It is scaffolded as ONE whole building.

ONE DWELLING (houses), or ONE BLOCK (flats)
- For a PAIR_OR_TERRACE of houses: the dwellings share a GABLE wall, so it is the FRONTAGE (front/rear direction) that spans them all. Report the FRONT and REAR lengths as the FULL PRINTED FRONTAGE (spanning every house) — do NOT divide them. Set dwellingsWide to how many houses share that frontage (2 semi pair, 3+ terrace); the engine divides. Report the GABLE-end walls at the full depth (never divided). Birdcage/GIA is per house on the schedule — report as printed.
- For an APARTMENT_BLOCK: the whole block is one scaffold. Set dwellingsWide = 1 (do NOT divide the frontage), report the block's full external walls, and for birdcage report the WHOLE-FLOOR internal area per level (the entire floor plate) — NOT a single flat's GIA. Count every apex on the block.
- For a SINGLE dwelling: dwellingsWide = 1.
- Keep reading printed numbers, not doing arithmetic. Say in notes what the building is.

PERIMETER (wall segments)
- Take the perimeter off the OUTSIDE of the GROUND-FLOOR plan, along the BUILDING LINE (the brickwork line), for ONE dwelling.
- Report EACH external wall length separately, tagged with its role (front / rear / gable_left / gable_right) and its dimension string. Read a gable wall's length from the side/gable elevation or the plan depth; read front/rear from the frontage. Do NOT sum them into a single perimeter, and do NOT add any corner allowance — that is applied downstream.
- Also report the number of EXTERNAL corners / returns (a plain rectangle has 4). A minor step in the footprint can be taken as the bounding rectangle; only a genuinely irregular (L-shaped) footprint needs its extra walls listed.

STOREYS AND ROOM-IN-ROOF
- Report the storeys (1, 2, 2.5, 3). A 2.5-storey has a habitable ROOM IN THE ROOF — signalled by dormers, roof/velux windows, or a raised eaves with living space above. Set roomInRoof accordingly; it adds a lift and a birdcage floor downstream.

ROOF, APEXES, RENDER (read per elevation)
- Overall roof form: PITCHED (a gable apex with brickwork to the point — needs a table lift) vs HIPPED (slopes back on all sides — NO apex, NO table lift) vs MIXED.
- For EACH elevation face, count the apexes on that face (0 if that face is hipped) and note whether it is rendered and, if dimensioned, the linear metres of the rendered section. Only the rendered section is measured, not the whole wall.

BIRDCAGE (internal floor area — one dwelling)
- Use the INTERNAL floor area, inside the external walls — NOT the external footprint (the external box is bigger and would over-read the birdcage).
- Preferred: if the drawing states a Gross Internal Area / floor area (e.g. "GIA 102.39 m²") for a level, report it directly in internalAreaM2. Otherwise read the INTERNAL length and width per floor.
- One entry per floor (GF, FF, and for a 2.5-storey the roof room as the next level). If only external dimensions are legible, you may report them but mark the floor low confidence and note it is external.
- If no floor plan / internal area is legible, leave floorAreas empty — never estimate from an elevation.

OTHER ITEMS
- Low level: count porches and bay windows — each is one low-level scaffold. A porch or entrance CANOPY (including a GRP canopy) still counts as one low level; do not exclude it because it is "only a canopy".
- Chimney: report chimney = true ONLY if a chimney stack is actually drawn on this house. If the drawing only carries an optional/conditional note ("chimney if required") with no stack drawn, report false and mention it in notes.
- Smart roof: if the roof peak looks unusually high for the type, report the peak height; do not apply a threshold yourself.

WHAT YOU MUST NOT DO
- Do NOT compute the number of lifts, the perimeter total, birdcage areas, render lift counts, or any pricing or stage split. Those are Airwright's deterministic rules applied downstream.
- Do NOT infer the plot configuration (detached / semi / terrace) — that comes from the plot schedule, not the elevation.
- NEVER invent a value. If a field is not legible or not present, set it to null and confidence "unknown".
- When a dimension is ambiguous (e.g. wall line vs roof overhang), choose the wall line, lower the confidence, and note it briefly.
- Be conservative: "high" means the printed value is certain and unambiguous.

NOTES
- Keep "notes" SHORT (max 2-3 sentences) and useful to the estimator: assumptions made, ambiguities resolved, an orientation/plot caveat, or a field you couldn't read. No obvious restatements, no reasoning, no lists of skipped sheets. Empty if nothing useful.

You must respond by calling the provided tool with your structured extraction. Do not write prose outside the tool call.
```

---

## 4. User instruction (verbatim)

> Sent alongside the PDF on every call. Lives in `USER_INSTRUCTION`.

```text
Extract the scaffold take-off measurements for this house type from the attached drawing(s). Report each external wall length separately (building line, off the ground-floor plan) with its dimension string; the external corner count; storeys and whether there is a room in the roof; height to soffit; the overall roof type; per elevation the apex count and any render (with its linear metres); the internal floor dimensions per floor for the birdcage; porch/bay low-level counts; and whether a chimney is shown. Cite the exact source dimension string for every number. Leave anything unreadable as null with confidence "unknown". Do not compute lifts or prices.
```

---

## 5. The output contract (what the model must return)

Every value carries a **confidence** (`high` / `medium` / `low` / `unknown`) and,
where relevant, its **source** (`sourceSheet`, `sourceDimension`). The tool schema
is generated from this Zod definition, so the model's output can never drift from
what we expect. Full definition in `src/lib/extract/schema.ts`.

### Fields

| Field | Type | Meaning |
|---|---|---|
| `houseType.name` / `houseType.code` | string / string | e.g. `Dekker` / `NSS.277` |
| `buildType` | `TRADITIONAL` \| `TIMBER_FRAME` \| null | construction type |
| `structure.form` | `SINGLE` \| `PAIR_OR_TERRACE` \| `APARTMENT_BLOCK` \| null | decides how the take-off is split |
| `storeys` | number (1 / 2 / 2.5 / 3) | observed, **not** used to count lifts here |
| `roomInRoof` | boolean | habitable room in the roof → 2.5-storey |
| `heightToSoffitM` | number (metres) | height to soffit/eaves the scaffold reaches |
| `roof.overallType` | `PITCHED` \| `HIPPED` \| `MIXED` \| null | roof form (drives apex/table lift) |
| `elevations[]` | array | per face: `face`, `apexCount`, `rendered`, `renderLengthM`, source |
| `wallSegments[]` | array | per wall: `position` (front/rear/gable_left/gable_right/other), `lengthM`, `sourceDimension` |
| `cornerCount` | number | external corners/returns (rectangle = 4) |
| `dwellingsWide` | number | how many dwellings share the printed frontage (engine divides) |
| `floorAreas[]` | array | per floor (GF/FF/SF/TF): `internalLengthM`, `internalWidthM`, or stated `internalAreaM2` (GIA) |
| `lowLevel` | object | `porchCount`, `bayCount` (each = one low-level scaffold) |
| `chimney` | boolean | a chimney stack actually drawn |
| `smartRoofPeakHeightM` | number \| null | peak height if unusually high (no threshold applied by the model) |
| `notes` | string | short, useful estimator notes only |

### Enums

- **Confidence:** `high` (printed value certain and unambiguous) · `medium` · `low` · `unknown` (couldn't read → value is `null`).
- **Wall position:** `front`, `rear`, `gable_left`, `gable_right`, `other`.
- **Elevation face:** `front`, `rear`, `left`, `right`, `other`.
- **Floor level:** `GF` (ground), `FF` (first), `SF` (second), `TF` (third).

### Example output (abridged, Dekker semi-detached pair)

```json
{
  "houseType": { "name": "Dekker", "code": "NSS.277", "confidence": "high" },
  "buildType": { "value": "TRADITIONAL", "confidence": "medium" },
  "structure": { "form": "PAIR_OR_TERRACE", "confidence": "high" },
  "storeys": { "value": 2, "confidence": "high", "sourceSheet": "Front Elevation" },
  "roomInRoof": { "value": false, "confidence": "high" },
  "heightToSoffitM": { "value": 4.725, "confidence": "high", "sourceDimension": "4725" },
  "roof": { "overallType": "PITCHED", "confidence": "high" },
  "elevations": [
    { "face": "left", "apexCount": 1, "rendered": false, "confidence": "high" },
    { "face": "right", "apexCount": 1, "rendered": false, "confidence": "high" }
  ],
  "wallSegments": [
    { "position": "front", "lengthM": 10.66, "sourceDimension": "10660", "confidence": "high" },
    { "position": "rear", "lengthM": 10.66, "sourceDimension": "10660", "confidence": "high" },
    { "position": "gable_left", "lengthM": 7.904, "sourceDimension": "7904", "confidence": "high" },
    { "position": "gable_right", "lengthM": 7.904, "sourceDimension": "7904", "confidence": "high" }
  ],
  "cornerCount": { "value": 4, "confidence": "high" },
  "dwellingsWide": { "value": 2, "confidence": "high" },
  "floorAreas": [
    { "level": "GF", "internalAreaM2": 35.0, "confidence": "medium", "sourceSheet": "Ground Floor Plan" },
    { "level": "FF", "internalAreaM2": 35.0, "confidence": "medium", "sourceSheet": "First Floor Plan" }
  ],
  "lowLevel": { "porchCount": 1, "bayCount": 0, "confidence": "medium" },
  "chimney": { "value": false, "confidence": "high" },
  "smartRoofPeakHeightM": { "value": null, "confidence": "unknown" },
  "notes": "Semi-detached pair (NSS.277 + NSS.277-1 mirrored); front/rear reported as full 10660 frontage spanning both, gables at 7904 depth."
}
```

---

## 6. What happens to this output (so the team sees the whole loop)

1. **Validated** against the schema (Zod) and stored verbatim as `Extraction.rawOutput`.
2. **Persisted** into measurement rows + wall segments + a per-elevation breakdown.
3. **The deterministic engine** (`src/lib/takeoff/engine.ts`) turns the observables
   into Colin's take-off line — lifts (`ceil(height / 1.5) + room-in-roof`, storey
   cross-check), perimeter by configuration + corner allowance, birdcage per floor,
   render lifts, config-aware apex, party walls. Open rule values (corner quantum,
   height datum, render table…) are configurable flags, never guessed.
4. **The review screen** shows every field, its confidence, and — on hover — exactly
   how it was read (dimension string + page) or computed (step by step). A person
   confirms and can correct any value before it's used.

The model reads; the engine computes; a human signs off. Nothing is auto-priced.

---

*Prompt version `2026-08-19.2` · model `claude-opus-4-8`. If the wording of §3/§4
changes, bump `PROMPT_VERSION` in `src/lib/extract/prompt.ts` so evaluations stay
comparable. Full background: `docs/11-takeoff-engine-spec.md`.*
