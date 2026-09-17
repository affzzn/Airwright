-- CreateEnum
CREATE TYPE "ConstructionUnit" AS ENUM ('LM_PER_LIFT', 'M2_PER_LIFT', 'NR_PER_LIFT', 'NR', 'LM', 'M2', 'PER_WEEK', 'FIXED');

-- CreateEnum
CREATE TYPE "HeightBracket" AS ENUM ('UP_TO_6M', 'H6_12M', 'H12_18M', 'H18_24M', 'ANY');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('SCHOOL', 'PUBLIC_STREET', 'CONSTRUCTION_SITE', 'COMMERCIAL', 'OTHER');

-- CreateTable
CREATE TABLE "ConstructionElement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "unit" "ConstructionUnit" NOT NULL,
    "usesLifts" BOOLEAN NOT NULL DEFAULT true,
    "usesHeightBracket" BOOLEAN NOT NULL DEFAULT true,
    "defaultRuleNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionRate" (
    "id" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "band" "RateBand" NOT NULL,
    "bracket" "HeightBracket" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ConstructionRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionQuote" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "customerName" TEXT,
    "siteAddress" TEXT,
    "enquiryType" TEXT,
    "band" "RateBand" NOT NULL DEFAULT 'COMPETITIVE',
    "durationWeeks" INTEGER,
    "extraHirePctPerWeek" DECIMAL(5,3) DEFAULT 0.05,
    "siteType" "SiteType",
    "buildingHeightM" DECIMAL(6,2),
    "defaultHeightBracket" "HeightBracket",
    "doorwayCount" INTEGER,
    "fireExitCount" INTEGER,
    "pedestrianAccessCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "assumptions" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionMeasurement" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "valueNumber" DECIMAL(10,3) NOT NULL,
    "lifts" INTEGER,
    "heightBracket" "HeightBracket",
    "source" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionQuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "elementId" TEXT,
    "description" TEXT NOT NULL,
    "lifts" INTEGER,
    "unit" "ConstructionUnit" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "heightBracket" "HeightBracket",
    "rate" DECIMAL(10,2) NOT NULL,
    "durationWeeks" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "isAuto" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionAttachment" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'tender-packs',
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConstructionElement_category_idx" ON "ConstructionElement"("category");

-- CreateIndex
CREATE INDEX "ConstructionRate_elementId_idx" ON "ConstructionRate"("elementId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionRate_elementId_band_bracket_key" ON "ConstructionRate"("elementId", "band", "bracket");

-- CreateIndex
CREATE INDEX "ConstructionMeasurement_quoteId_idx" ON "ConstructionMeasurement"("quoteId");

-- CreateIndex
CREATE INDEX "ConstructionQuoteLine_quoteId_idx" ON "ConstructionQuoteLine"("quoteId");

-- CreateIndex
CREATE INDEX "ConstructionQuoteLine_elementId_idx" ON "ConstructionQuoteLine"("elementId");

-- CreateIndex
CREATE INDEX "ConstructionAttachment_quoteId_idx" ON "ConstructionAttachment"("quoteId");

-- AddForeignKey
ALTER TABLE "ConstructionRate" ADD CONSTRAINT "ConstructionRate_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ConstructionElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionMeasurement" ADD CONSTRAINT "ConstructionMeasurement_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionQuoteLine" ADD CONSTRAINT "ConstructionQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionQuoteLine" ADD CONSTRAINT "ConstructionQuoteLine_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ConstructionElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionAttachment" ADD CONSTRAINT "ConstructionAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
