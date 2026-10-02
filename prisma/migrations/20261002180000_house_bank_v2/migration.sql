-- House bank v2 (docs/20): reads HELD for a bank decision / SKIPPED when a bank
-- version is picked; the house type pins the exact bank version it came from.
-- Additive only.
ALTER TYPE "ExtractionStatus" ADD VALUE 'HELD';
ALTER TYPE "ExtractionStatus" ADD VALUE 'SKIPPED';

ALTER TYPE "BankMatchState" ADD VALUE 'FROM_BANK';
ALTER TYPE "BankMatchState" ADD VALUE 'SAVED';

ALTER TABLE "HouseType" ADD COLUMN "bankVersionId" TEXT;
CREATE INDEX "HouseType_bankVersionId_idx" ON "HouseType"("bankVersionId");
ALTER TABLE "HouseType" ADD CONSTRAINT "HouseType_bankVersionId_fkey" FOREIGN KEY ("bankVersionId") REFERENCES "HouseTypeBankVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
