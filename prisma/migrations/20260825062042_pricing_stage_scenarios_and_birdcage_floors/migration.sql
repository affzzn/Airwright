-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScaffoldComponent" ADD VALUE 'BIRDCAGE_SF';
ALTER TYPE "ScaffoldComponent" ADD VALUE 'BIRDCAGE_TF';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StageScenario" ADD VALUE 'GARAGE';
ALTER TYPE "StageScenario" ADD VALUE 'GARAGE_NO_BCAGE';
ALTER TYPE "StageScenario" ADD VALUE 'TIMBER_FRAME';
