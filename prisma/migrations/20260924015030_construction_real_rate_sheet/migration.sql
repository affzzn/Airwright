-- CreateEnum
CREATE TYPE "BusinessLine" AS ENUM ('CONSTRUCTION', 'TRADITIONAL', 'TIMBER_FRAME', 'GENERAL');

-- AlterEnum
ALTER TYPE "HeightBracket" ADD VALUE 'H24_30M';

-- AlterTable
ALTER TABLE "ConstructionElement" ADD COLUMN     "line" "BusinessLine" NOT NULL DEFAULT 'CONSTRUCTION',
ADD COLUMN     "sourceTitle" TEXT;

-- AlterTable
ALTER TABLE "ConstructionQuote" DROP COLUMN "extraHirePctPerWeek";

-- AlterTable
ALTER TABLE "ConstructionQuoteLine" ADD COLUMN     "baseHireWeeks" INTEGER,
ADD COLUMN     "extraHireChargePct" DECIMAL(5,2),
ADD COLUMN     "extraHirePerWeek" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ConstructionRate" ADD COLUMN     "baseHireWeeks" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "extraHireChargePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "extraHirePerWeek" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ConstructionElement_line_idx" ON "ConstructionElement"("line");

