-- AlterEnum
ALTER TYPE "DocumentKind" ADD VALUE 'ASSEMBLED';

-- AlterTable
ALTER TABLE "BuilderProfile" ADD COLUMN     "ingestProfile" JSONB;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "pageManifest" JSONB,
ADD COLUMN     "relativePath" TEXT;

-- AlterTable
ALTER TABLE "PackUpload" ADD COLUMN     "relativePath" TEXT;

-- AlterTable
ALTER TABLE "TenderPack" ADD COLUMN     "builderProfileId" TEXT,
ADD COLUMN     "groupingData" JSONB,
ADD COLUMN     "groupingStatus" TEXT;
