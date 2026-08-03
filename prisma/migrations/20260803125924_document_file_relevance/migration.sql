-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PENDING', 'HOUSE_TYPE_DRAWINGS', 'SITE_LAYOUT', 'SPEC', 'NOT_RELEVANT', 'UNREADABLE');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "category" "DocumentCategory" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "categoryDetail" TEXT,
ADD COLUMN     "included" BOOLEAN NOT NULL DEFAULT true;
