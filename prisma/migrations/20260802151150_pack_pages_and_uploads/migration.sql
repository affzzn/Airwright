-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('ELEVATION', 'FLOOR_PLAN', 'SECTION', 'PLOT_LAYOUT', 'SPEC', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PackUpload" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "isArchive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "kind" "PageKind" NOT NULL DEFAULT 'OTHER',
    "relevant" BOOLEAN NOT NULL DEFAULT false,
    "houseTypeCode" TEXT,
    "houseTypeName" TEXT,
    "sheetTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackUpload_packId_idx" ON "PackUpload"("packId");

-- CreateIndex
CREATE INDEX "DocumentPage_documentId_idx" ON "DocumentPage"("documentId");

-- CreateIndex
CREATE INDEX "DocumentPage_houseTypeCode_idx" ON "DocumentPage"("houseTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");

-- AddForeignKey
ALTER TABLE "PackUpload" ADD CONSTRAINT "PackUpload_packId_fkey" FOREIGN KEY ("packId") REFERENCES "TenderPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
