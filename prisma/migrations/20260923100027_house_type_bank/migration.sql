-- CreateEnum
CREATE TYPE "BankMatchState" AS ENUM ('NEW', 'MATCHED', 'CHANGED', 'DETACHED');

-- AlterTable
ALTER TABLE "HouseType" ADD COLUMN     "bankEntryId" TEXT,
ADD COLUMN     "bankMatchState" "BankMatchState";

-- CreateTable
CREATE TABLE "HouseTypeBankEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "buildType" "BuildType" NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "canonicalCode" TEXT,
    "matchKey" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timesReused" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseTypeBankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseTypeBankVersion" (
    "id" TEXT NOT NULL,
    "bankEntryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "geometryFingerprint" TEXT NOT NULL,
    "sourceTakeoffId" TEXT,
    "sourceProjectId" TEXT,
    "note" TEXT,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseTypeBankVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseTypeBankEntry_currentVersionId_key" ON "HouseTypeBankEntry"("currentVersionId");

-- CreateIndex
CREATE INDEX "HouseTypeBankEntry_clientId_buildType_idx" ON "HouseTypeBankEntry"("clientId", "buildType");

-- CreateIndex
CREATE INDEX "HouseTypeBankEntry_matchKey_idx" ON "HouseTypeBankEntry"("matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "HouseTypeBankEntry_clientId_canonicalCode_buildType_key" ON "HouseTypeBankEntry"("clientId", "canonicalCode", "buildType");

-- CreateIndex
CREATE INDEX "HouseTypeBankVersion_bankEntryId_idx" ON "HouseTypeBankVersion"("bankEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseTypeBankVersion_bankEntryId_version_key" ON "HouseTypeBankVersion"("bankEntryId", "version");

-- CreateIndex
CREATE INDEX "HouseType_bankEntryId_idx" ON "HouseType"("bankEntryId");

-- AddForeignKey
ALTER TABLE "HouseType" ADD CONSTRAINT "HouseType_bankEntryId_fkey" FOREIGN KEY ("bankEntryId") REFERENCES "HouseTypeBankEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseTypeBankEntry" ADD CONSTRAINT "HouseTypeBankEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseTypeBankEntry" ADD CONSTRAINT "HouseTypeBankEntry_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "HouseTypeBankVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseTypeBankVersion" ADD CONSTRAINT "HouseTypeBankVersion_bankEntryId_fkey" FOREIGN KEY ("bankEntryId") REFERENCES "HouseTypeBankEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
