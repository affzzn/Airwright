-- Per-lift-level pricing (docs/15 §3, P2): RateItem gains a liftLevel dimension.
-- liftLevel 0 = the base rate (upper lifts + non-lift components); 1..8 = a
-- specific lift level's rate (the client matrix prices the 1st lift dearer).
-- Existing rows default to 0, so the re-keyed unique constraint can't collide
-- (the old key [rateCardId, component, action, band] was already unique).
ALTER TABLE "RateItem" ADD COLUMN "liftLevel" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "RateItem_rateCardId_component_action_band_key";

CREATE UNIQUE INDEX "RateItem_rateCardId_component_action_band_liftLevel_key" ON "RateItem"("rateCardId", "component", "action", "band", "liftLevel");
