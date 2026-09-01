/** Overview prose (docs/EXTRACTOR-COMPLETE-REFERENCE.md Part 0). */

export const LAYERS = [
  {
    id: "llm",
    title: "Layer 1 — the Extractor (AI)",
    body:
      "Reads observable facts off the drawing and returns them with confidence + provenance: wall lengths, height, storeys, roof shape, apex counts, render, internal dimensions, stated areas, porch/bay counts, corners, chimney. It does NO arithmetic and never outputs a lift count, a perimeter total, a birdcage area, a stage split or a price.",
    files: "prompt.ts · schema.ts · claude.ts · extractDrawing.ts",
  },
  {
    id: "engine",
    title: "Layer 2 — the Engine (deterministic)",
    body:
      "Takes the observables and computes the take-off line with rules confirmed with Colin: lifts, perimeter by configuration, birdcage per floor, render lifts, apex → table lifts, party walls, apartment mode. Every open value is a parameter with a documented default; every unresolved cross-check raises a flag, never a silent number.",
    files: "takeoff/engine.ts · birdcage.ts · height.ts · fromStored.ts · garage.ts",
  },
  {
    id: "pricing",
    title: "Layer 3 — Pricing (the boundary)",
    body:
      "After a human confirms a take-off, a third deterministic layer prices it per plot. This page stops at the take-off line — it covers reading and measuring, not money.",
    files: "src/lib/pricing/* (out of scope here)",
  },
];

export const DOCTRINES = [
  {
    title: "Read observables, don't price",
    body: "The model reads facts (lengths, heights, counts, roof form, stated areas). It never computes a derived quantity.",
  },
  {
    title: "Report the stated value AND the raw dimensions",
    body:
      "Where the drawing states a number and prints the dimensions behind it, the model reports both and stops. The engine subtracts, multiplies and reconciles, and computes the confidence.",
  },
  {
    title: "No arithmetic by the model — not even a subtraction",
    body: "Reporting a raw printed number you can point to is reliable; mental arithmetic is not.",
  },
  {
    title: "Null + unknown, never a guess",
    body: "Anything not legible or not present is null with confidence 'unknown'. Never invent a value or assume a standard.",
  },
  {
    title: "Confidence is computed, not self-reported",
    body: "For the birdcage and the height, the stored confidence comes from whether two independent reads agree. Contradictions are flagged, not trusted.",
  },
  {
    title: "Open questions stay flags",
    body: "A value we still owe (the render table, a tolerance, the apartment basis) is a configurable parameter or a flag — never a hard-coded guess.",
  },
];

export const OVERVIEW_INTRO =
  "This is the living spec for how Airwright turns tender drawings into a scaffold take-off. It shows exactly what the AI reads and what the deterministic engine computes — so the Innate team can see what's built, and Colin/Laura can verify and correct it. Nothing is ever auto-priced: the model reads, the engine reconciles, and a human confirms every take-off before it's priced.";
