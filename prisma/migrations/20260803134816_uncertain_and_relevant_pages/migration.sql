-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'UNCERTAIN';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "relevantPages" INTEGER NOT NULL DEFAULT 0;
