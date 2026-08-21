-- CreateEnum
CREATE TYPE "StageScenario" AS ENUM ('STANDARD', 'BUNGALOW', 'NO_BIRDCAGE');

-- AlterTable
ALTER TABLE "StageSplit" ADD COLUMN "scenario" "StageScenario" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "BuilderProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accessType" "AccessType",
    "ladderAllowedConfined" BOOLEAN NOT NULL DEFAULT false,
    "beamOverLowLevel" BOOLEAN NOT NULL DEFAULT false,
    "chimneyScaffoldAlways" BOOLEAN NOT NULL DEFAULT false,
    "birdcageLiftsOver2p5m" INTEGER,
    "loadingBayPolicy" TEXT,
    "joistSupportVariant" TEXT,
    "extraHirePolicy" TEXT,
    "matrixTemplateId" TEXT,
    "notes" TEXT,
    "spec" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuilderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMatrixTemplate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'tender-packs',
    "storagePath" TEXT,
    "fieldMapping" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientMatrixTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuilderProfile_clientId_idx" ON "BuilderProfile"("clientId");
CREATE INDEX "ClientMatrixTemplate_clientId_idx" ON "ClientMatrixTemplate"("clientId");

-- AddForeignKey
ALTER TABLE "BuilderProfile" ADD CONSTRAINT "BuilderProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMatrixTemplate" ADD CONSTRAINT "ClientMatrixTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
