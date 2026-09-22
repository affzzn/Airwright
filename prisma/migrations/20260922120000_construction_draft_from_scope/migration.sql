-- Draft from enquiry (docs/19): store the written scope-of-works text and the
-- last AI draft output on a construction quote. Additive, construction-only —
-- nothing in the house-build tables is touched.
ALTER TABLE "ConstructionQuote" ADD COLUMN "enquiryText" TEXT;
ALTER TABLE "ConstructionQuote" ADD COLUMN "draftRawOutput" JSONB;
