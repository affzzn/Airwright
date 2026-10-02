-- Construction scope mode + output (docs/22 M3–M4). Additive only.

-- AlterTable
ALTER TABLE "ConstructionQuote" ADD COLUMN     "outputFormat" TEXT,
ADD COLUMN     "scopeReview" JSONB;

-- AlterTable
ALTER TABLE "ConstructionMeasurement" ADD COLUMN     "key" TEXT,
ADD COLUMN     "sheetRefs" JSONB;

-- AlterTable
ALTER TABLE "ConstructionQuoteLine" ADD COLUMN     "clientRef" JSONB,
ADD COLUMN     "flags" JSONB;
