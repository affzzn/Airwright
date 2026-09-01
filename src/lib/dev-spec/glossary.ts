import type { GlossaryTerm } from "./types";

/**
 * Scaffolding terms as Airwright uses them. Ported from
 * docs/EXTRACTOR-COMPLETE-REFERENCE.md Part 1 / docs/03-domain-glossary.md.
 * The `id`s are the targets of Measurement.relatedTerms.
 */
export const GLOSSARY: GlossaryTerm[] = [
  // Units
  { id: "lm", term: "LM (linear metre)", definition: "A metre of scaffold measured along the wall. External scaffold is measured in LM, per lift — the core unit scaffold is priced in." },
  { id: "m2", term: "m² (square metre)", definition: "Area unit — used only for the birdcage (internal decks) = length × width." },
  { id: "count", term: "Count / quantity", definition: "\"How many\": apexes, porches, bay windows, corners, loading bays." },
  { id: "lift", term: "Lift", definition: "One working platform level stacked up the wall. A standard lift ≈ 1.5 m of height. Everything external is counted lift by lift. Render lifts are the exception — 2 m boarded lifts.", layer: "engine" },

  // Building & shape
  { id: "storeys", term: "Storeys", definition: "Number of floor levels: 1, 2, 2.5, 3. Observed; cross-checks the lift count, never prices directly.", layer: "llm" },
  { id: "room-in-roof", term: "Room in roof", definition: "A habitable room in the roof space (dormers, velux, raised eaves) → a 2.5-storey. Adds one lift and one birdcage floor.", layer: "llm" },
  { id: "structure", term: "Structure", definition: "Named by how many houses are joined: DETACHED (1), PAIR_SEMI (2 — a semi/pair), THREE_BLOCK (3), TERRACE (4+ — 'terrace' is reserved for four or more), or APARTMENT_BLOCK (flats — scaffolded as one whole building). House forms take off per one house; the frontage is divided by dwellingsWide.", layer: "llm" },
  { id: "dwellings-wide", term: "Dwellings-wide", definition: "How many houses share the printed front/rear frontage (1 single, 2 semi, 3+ terrace). The engine divides the frontage by this; gable-end walls are never divided.", layer: "llm" },
  { id: "configuration", term: "Configuration", definition: "A plot-level attribute (from the plot schedule, not the elevation): Detached / Semi / End-terrace / Mid-terrace. Decides which walls get scaffold. The extractor never infers it." },
  { id: "party-wall", term: "Party wall", definition: "A wall shared with the joined house — not scaffolded. Detached 0, semi/end 1, mid-terrace 2." },
  { id: "jg", term: "JG (joint gable)", definition: "A gable shared between two houses (a party gable)." },
  { id: "building-line", term: "Building line", definition: "The brickwork line — the outer face of the brickwork. The perimeter is taken off the outside of the ground-floor plan along this line." },

  // External scaffold
  { id: "perimeter", term: "Perimeter", definition: "The total run of external scaffold for one lift, from the config's wall lengths + a corner allowance. The AI reports each wall; the engine sums them.", layer: "engine" },
  { id: "wall-segment", term: "Wall segment", definition: "One external wall length, off the building line, tagged front / rear / gable_left / gable_right.", layer: "llm" },
  { id: "corner", term: "Corner / return", definition: "An external corner of the footprint. Scaffold wraps past it, so Airwright adds 1 m per external corner. Count external returns only.", layer: "llm" },
  { id: "height-to-soffit", term: "Height to soffit", definition: "The vertical height to the soffit / underside of wallplate — the top of the wall the scaffold reaches. The number the lift count divides.", layer: "llm" },
  { id: "storey-template", term: "Storey template", definition: "Rule-of-thumb lift counts, a cross-check on the height rule: garage/bung 2, two-storey 4 (Barratt 3), 2.5-storey 5, three-storey 6, four-storey 8. Builder-specific." },

  // Roof, gable, apex
  { id: "pitched", term: "Pitched roof", definition: "A roof with a gable apex — brickwork rising to a point. Needs a table lift to reach it.", layer: "llm" },
  { id: "hipped", term: "Hipped roof", definition: "A roof that slopes back on all sides — no brickwork above the eaves, so no apex and no table lift.", layer: "llm" },
  { id: "apex", term: "Gable / apex", definition: "The triangular top of a wall under a pitched roof (the pointy bit). Counted per elevation face. In Strike this is 'apex scaffold'.", layer: "llm" },
  { id: "table-lift", term: "Table lift", definition: "An additional lift above the main scaffold to reach the apex brickwork. One per apex.", layer: "engine" },
  { id: "apex-handrail", term: "Apex handrail / gable rails", definition: "Guard rails up to the apex. A count, always equal to the apex count.", layer: "engine" },
  { id: "smart-roof", term: "Smart roof", definition: "A roof with a raised (higher) peak — takes a double table lift. Detected only from an unusually high peak; the threshold is ⚠️ open.", layer: "llm" },

  // Birdcage
  { id: "birdcage", term: "Birdcage", definition: "An independent internal scaffold that fills a whole floor as a working deck. Measured in m² = internal floor area. One per floor; a 2.5-storey has 3. Never the external footprint.", layer: "both" },
  { id: "wall-thickness", term: "Wall thickness / cavity deduction", definition: "What is subtracted from an overall external dimension to get the internal one. No fixed default — the structural (blockwork) wall is read per drawing; the WALL LEGEND value is a flagged fallback." },

  // Low-level, chimney, underbuild
  { id: "low-level", term: "Low level", definition: "A small scaffold tower for a low feature — a porch or a single-storey bay. Each = one low level, re-erected after the main scaffold is struck. A two-storey bay is NOT a low level.", layer: "llm" },
  { id: "beam-over", term: "Beam-over", definition: "A spec variant (some Bloor sites): a beam over the porch/bay instead of a returning low-level tower. A builder-profile item." },
  { id: "chimney", term: "Chimney scaffold", definition: "Scaffold around a chimney stack, at a fixed rate for one or two lifts. Detected from the drawing; a spec demanding one with none drawn is flagged, not priced.", layer: "both" },
  { id: "foot-scaffold", term: "Foot scaffold", definition: "A low scaffold around the base of the block, at ground level." },
  { id: "underbuild", term: "Underbuild", definition: "Extra scaffold at the base where a plot sits on a slope. The real source is the site elevations plan (a separate drawing).", layer: "llm" },
  { id: "site-elevations-plan", term: "Site elevations plan", definition: "A distinct drawing showing the elevation of the site (levels/slopes) — the only real source for underbuild. Not yet classified/sent." },

  // Access / shared
  { id: "loading-bay", term: "Loading bay (LB)", definition: "A reinforced spot where materials are lifted onto the scaffold. By lift, to full height; shared across a block. Unit-priced." },
  { id: "rubbish-chute", term: "Rubbish chute / skip bay", definition: "The waste route down the scaffold. One per lift, shared. Chute vs skip bay is spec-driven." },
  { id: "haki", term: "Haki stair tower", definition: "A proprietary staircase access tower (safer, dearer). Client-spec decides it. Keepmoat mandates Haki." },
  { id: "ladder-tower", term: "Ladder tower", definition: "The cheaper ladder access alternative to a Haki." },
  { id: "joist-support", term: "Joist support / props", definition: "Temporary support when stairs/openings are formed. One per set of stairs. Variants single / double / sacrificial — client-spec." },
  { id: "apportionment", term: "Apportionment", definition: "Splitting a shared item across adjoining plots: detached full, semi 2 lifts/plot, terrace-of-3 ≈ 1.33/plot. 4-plot split is ⚠️ open. Not read by the extractor — listed as profile-pending." },
  { id: "screen-walls", term: "Screen walls", definition: "Boundary/screen walls, usually not in the original tender — priced later off a separate drawing." },

  // Render
  { id: "render", term: "Render / render adaption", definition: "A wet render or cladding finish on part of an elevation — a separate work type. Re-erected in 2 m boarded lifts. Priced at the same £/LM as the perimeter. Per plot.", layer: "both" },
  { id: "render-lifts", term: "Render lifts", definition: "Colin's table: 1-storey 1, 2-storey 2, 2.5-storey 3, 3-storey 4. Only the rendered section is measured. ⚠️ the full table is owed." },

  // Pricing / process (Layer-3 boundary)
  { id: "build-type", term: "Build type", definition: "Traditional masonry vs timber-frame. Two different pricing matrices with different columns and stage splits; timber-frame also changes scaffold sequence/ties." },
  { id: "erect-dismantle", term: "Erect vs dismantle", definition: "Put up vs take down — two separate priced operations." },
  { id: "stage-split", term: "Payment stages / stage split", definition: "The plot total split into billing stages: Plot Erect 50% · Birdcage Erect 25% · Dismantle 25% (bungalow 65/10/25). Configurable per client." },
  { id: "rate-band", term: "Rate band", definition: "Colin's commercial tier: super-competitive / competitive / medium / high / custom. Same take-off, different £/unit." },

  // Drawings / systems
  { id: "elevation", term: "Elevation", definition: "A drawing of a face of the house. Read apexes, render, height, chimney, porches/bays here. Ignore internal room elevations (Kitchen/Cloak)." },
  { id: "floor-plan", term: "Floor plan", definition: "A top-down drawing of a floor. Read the internal footprint dimensions for the birdcage, and the footprint." },
  { id: "setting-out-plan", term: "Setting-out plan", definition: "Carries the internal footprint dimensions per dwelling and the exterior-wall run — the source of the birdcage. Classified as a floor plan (relevant)." },
  { id: "section", term: "Section (A-A, B-B)", definition: "Vertical heights — height to soffit / U-S wallplate, FFL, floor-to-floor storey heights." },
  { id: "tg20", term: "TG20 (TG20:21)", definition: "The industry scaffold design-compliance standard. A constraint, not a measurement." },
];
