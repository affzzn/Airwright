-- AlterTable
ALTER TABLE "ConstructionAttachment" ADD COLUMN     "bucket" TEXT,
ADD COLUMN     "bucketReason" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "relativePath" TEXT,
ADD COLUMN     "sourceArchiveId" TEXT;

-- AlterTable
ALTER TABLE "ConstructionMeasurement" ADD COLUMN     "buildingId" TEXT,
ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "paramsUsed" JSONB,
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "ConstructionQuote" ADD COLUMN     "clientTemplate" JSONB,
ADD COLUMN     "ingestError" TEXT,
ADD COLUMN     "ingestStatus" TEXT DEFAULT 'NONE',
ADD COLUMN     "ingestedAt" TIMESTAMP(3),
ADD COLUMN     "jobParams" JSONB,
ADD COLUMN     "mode" TEXT;

-- AlterTable
ALTER TABLE "ConstructionQuoteLine" ADD COLUMN     "buildingId" TEXT,
ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "formula" TEXT,
ADD COLUMN     "paramsUsed" JSONB,
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "section" TEXT;

-- CreateTable
CREATE TABLE "ConstructionBuilding" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionBuilding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionSheet" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "buildingId" TEXT,
    "drawingNo" TEXT,
    "title" TEXT,
    "revision" TEXT,
    "kind" TEXT NOT NULL,
    "level" TEXT,
    "face" TEXT,
    "scale" TEXT,
    "paper" TEXT,
    "widthPt" DOUBLE PRECISION NOT NULL,
    "heightPt" DOUBLE PRECISION NOT NULL,
    "hasText" BOOLEAN NOT NULL,
    "bucket" TEXT NOT NULL,
    "reason" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "geometry" JSONB,
    "readStatus" TEXT NOT NULL DEFAULT 'NONE',
    "readKind" TEXT,
    "readRawOutput" JSONB,
    "readMeta" JSONB,
    "readKey" TEXT,
    "readError" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionReadRun" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "mode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "progress" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionReadRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConstructionBuilding_quoteId_idx" ON "ConstructionBuilding"("quoteId");

-- CreateIndex
CREATE INDEX "ConstructionSheet_quoteId_idx" ON "ConstructionSheet"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSheet_attachmentId_page_key" ON "ConstructionSheet"("attachmentId", "page");

-- CreateIndex
CREATE INDEX "ConstructionReadRun_quoteId_idx" ON "ConstructionReadRun"("quoteId");

-- AddForeignKey
ALTER TABLE "ConstructionBuilding" ADD CONSTRAINT "ConstructionBuilding_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionSheet" ADD CONSTRAINT "ConstructionSheet_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionSheet" ADD CONSTRAINT "ConstructionSheet_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "ConstructionAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionSheet" ADD CONSTRAINT "ConstructionSheet_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "ConstructionBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionReadRun" ADD CONSTRAINT "ConstructionReadRun_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ConstructionQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionMeasurement" ADD CONSTRAINT "ConstructionMeasurement_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "ConstructionBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionQuoteLine" ADD CONSTRAINT "ConstructionQuoteLine_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "ConstructionBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

