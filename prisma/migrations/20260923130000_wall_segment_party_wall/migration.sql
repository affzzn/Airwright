-- Party-wall flag per wall segment (docs/21 §B2).
-- Nullable on purpose: NULL = the drawing did not state it, which the engine must be
-- able to tell apart from FALSE (an external wall). Additive, no backfill — existing
-- rows stay NULL and fall back to the previous size heuristic, flagged.
ALTER TABLE "WallSegment" ADD COLUMN "isPartyWall" BOOLEAN;
