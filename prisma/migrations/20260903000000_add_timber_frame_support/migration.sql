-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScaffoldComponent" ADD VALUE 'ADAPTION_INSIDE_BOARD';
ALTER TYPE "ScaffoldComponent" ADD VALUE 'ADAPTION_HOP_UP';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "buildType" "BuildType" NOT NULL DEFAULT 'TRADITIONAL';
