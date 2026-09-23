-- Construction enquiry reading (docs/20): let the estimator tick which attachment
-- files the AI reads, and store the drawing reader's output per file. Additive,
-- construction-only — nothing in the house-build tables is touched.
ALTER TABLE "ConstructionAttachment" ADD COLUMN "useForDrafting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConstructionAttachment" ADD COLUMN "drawingKind" TEXT;
ALTER TABLE "ConstructionAttachment" ADD COLUMN "readStatus" TEXT DEFAULT 'NONE';
ALTER TABLE "ConstructionAttachment" ADD COLUMN "readRawOutput" JSONB;
ALTER TABLE "ConstructionAttachment" ADD COLUMN "readMeta" JSONB;
