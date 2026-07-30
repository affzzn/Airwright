-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ESTIMATOR', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "EstimatingMode" AS ENUM ('HOUSE_BUILD', 'CONSTRUCTION');

-- CreateEnum
CREATE TYPE "RateBand" AS ENUM ('SUPER_COMPETITIVE', 'COMPETITIVE', 'MEDIUM', 'HIGH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BuildType" AS ENUM ('TRADITIONAL', 'TIMBER_FRAME');

-- CreateEnum
CREATE TYPE "Configuration" AS ENUM ('DETACHED', 'SEMI_DETACHED', 'END_TERRACE', 'MID_TERRACE');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('HAKI_STAIR', 'LADDER_TOWER');

-- CreateEnum
CREATE TYPE "GarageType" AS ENUM ('SINGLE', 'TWIN');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ELEVATION', 'FLOOR_PLAN', 'PLOT_LAYOUT', 'SPEC', 'PRICING_TEMPLATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('HOUSEBUILDING', 'CONSTRUCTION');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('AI_EXTRACTED', 'MANUAL', 'EDITED', 'DERIVED');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('LM', 'M2', 'EACH', 'LIFT', 'WEEK');

-- CreateEnum
CREATE TYPE "MeasurementKey" AS ENUM ('HEIGHT_TO_SOFFIT', 'ROOF_PITCH', 'STOREYS', 'LIFTS', 'GABLE_QTY', 'RENDER_LENGTH', 'BIRDCAGE_GF_M2', 'BIRDCAGE_FF_M2', 'LOW_LEVEL_QTY', 'FOOT_SCAFFOLD_QTY', 'CORNER_COUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "WallPosition" AS ENUM ('FRONT', 'REAR', 'GABLE_LEFT', 'GABLE_RIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ScaffoldComponent" AS ENUM ('LIFT', 'GABLE', 'GABLE_RAILS', 'RENDER_ADAPTION', 'BIRDCAGE_GF', 'BIRDCAGE_FF', 'LOADING_BAY', 'HAKI', 'LADDER_TOWER', 'RUBBISH_CHUTE', 'TABLE_LIFT', 'JOIST_SUPPORT', 'FOOT_SCAFFOLD', 'LOW_LEVEL', 'PARTY_WALL', 'CONSTRUCTION_LINE', 'OTHER');

-- CreateEnum
CREATE TYPE "OperationAction" AS ENUM ('ERECT', 'DISMANTLE');

-- CreateEnum
CREATE TYPE "OperationGroup" AS ENUM ('MAIN', 'GARAGE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'ESTIMATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBand" "RateBand" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "estimatingMode" "EstimatingMode" NOT NULL DEFAULT 'HOUSE_BUILD',
    "status" TEXT NOT NULL DEFAULT 'TENDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderPack" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'tender-packs',
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "sizeBytes" INTEGER,
    "isReadable" BOOLEAN NOT NULL DEFAULT true,
    "isRasterOnly" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "houseTypeId" TEXT,
    "pageRange" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "rawOutput" JSONB,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "buildType" "BuildType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Takeoff" (
    "id" TEXT NOT NULL,
    "houseTypeId" TEXT NOT NULL,
    "seedExtractionId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "warnings" JSONB,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Takeoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffMeasurement" (
    "id" TEXT NOT NULL,
    "takeoffId" TEXT NOT NULL,
    "key" "MeasurementKey" NOT NULL,
    "label" TEXT,
    "valueNumber" DECIMAL(10,3),
    "valueText" TEXT,
    "unit" "Unit",
    "aiValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "source" "FieldSource" NOT NULL DEFAULT 'AI_EXTRACTED',
    "sourceSheet" TEXT,
    "sourceDimension" TEXT,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallSegment" (
    "id" TEXT NOT NULL,
    "takeoffId" TEXT NOT NULL,
    "position" "WallPosition" NOT NULL DEFAULT 'OTHER',
    "label" TEXT,
    "lengthM" DECIMAL(7,3) NOT NULL,
    "aiLengthM" DECIMAL(7,3),
    "shareable" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "source" "FieldSource" NOT NULL DEFAULT 'AI_EXTRACTED',
    "sourceSheet" TEXT,
    "sourceDimension" TEXT,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldOperation" (
    "id" TEXT NOT NULL,
    "takeoffId" TEXT NOT NULL,
    "group" "OperationGroup" NOT NULL DEFAULT 'MAIN',
    "garageType" "GarageType",
    "component" "ScaffoldComponent" NOT NULL,
    "action" "OperationAction" NOT NULL,
    "liftLevel" INTEGER,
    "quantity" DECIMAL(10,2) NOT NULL,
    "aiQuantity" DECIMAL(10,2),
    "unit" "Unit" NOT NULL,
    "derived" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "source" "FieldSource" NOT NULL DEFAULT 'AI_EXTRACTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffoldOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "houseTypeId" TEXT NOT NULL,
    "plotNumber" TEXT NOT NULL,
    "configuration" "Configuration" NOT NULL DEFAULT 'DETACHED',
    "blockGroup" TEXT,
    "isRendered" BOOLEAN NOT NULL DEFAULT false,
    "accessType" "AccessType",
    "hasGarage" BOOLEAN NOT NULL DEFAULT false,
    "garageType" "GarageType",
    "specNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "EstimatingMode" NOT NULL DEFAULT 'HOUSE_BUILD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateItem" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "component" "ScaffoldComponent" NOT NULL,
    "action" "OperationAction" NOT NULL DEFAULT 'ERECT',
    "band" "RateBand" NOT NULL,
    "unit" "Unit" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "payPercent" DECIMAL(5,2),

    CONSTRAINT "RateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageSplit" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StageSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionRateItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" "Unit" NOT NULL,
    "band" "RateBand",
    "rate" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionRateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionScope" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hireWeeks" INTEGER,
    "permits" TEXT,
    "access" TEXT,
    "groundConditions" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rateCardId" TEXT,
    "type" "QuoteType" NOT NULL DEFAULT 'HOUSEBUILDING',
    "band" "RateBand" NOT NULL DEFAULT 'MEDIUM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "plotId" TEXT,
    "description" TEXT NOT NULL,
    "component" "ScaffoldComponent",
    "action" "OperationAction",
    "liftLevel" INTEGER,
    "group" "OperationGroup" NOT NULL DEFAULT 'MAIN',
    "stage" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" "Unit" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "hireWeeks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "TenderPack_projectId_idx" ON "TenderPack"("projectId");

-- CreateIndex
CREATE INDEX "Document_packId_idx" ON "Document"("packId");

-- CreateIndex
CREATE INDEX "Document_kind_idx" ON "Document"("kind");

-- CreateIndex
CREATE INDEX "Extraction_documentId_idx" ON "Extraction"("documentId");

-- CreateIndex
CREATE INDEX "Extraction_houseTypeId_idx" ON "Extraction"("houseTypeId");

-- CreateIndex
CREATE INDEX "Extraction_status_idx" ON "Extraction"("status");

-- CreateIndex
CREATE INDEX "HouseType_projectId_idx" ON "HouseType"("projectId");

-- CreateIndex
CREATE INDEX "HouseType_clientId_code_idx" ON "HouseType"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HouseType_projectId_code_key" ON "HouseType"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Takeoff_houseTypeId_key" ON "Takeoff"("houseTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Takeoff_seedExtractionId_key" ON "Takeoff"("seedExtractionId");

-- CreateIndex
CREATE INDEX "Takeoff_houseTypeId_idx" ON "Takeoff"("houseTypeId");

-- CreateIndex
CREATE INDEX "TakeoffMeasurement_takeoffId_idx" ON "TakeoffMeasurement"("takeoffId");

-- CreateIndex
CREATE UNIQUE INDEX "TakeoffMeasurement_takeoffId_key_key" ON "TakeoffMeasurement"("takeoffId", "key");

-- CreateIndex
CREATE INDEX "WallSegment_takeoffId_idx" ON "WallSegment"("takeoffId");

-- CreateIndex
CREATE INDEX "ScaffoldOperation_takeoffId_idx" ON "ScaffoldOperation"("takeoffId");

-- CreateIndex
CREATE INDEX "ScaffoldOperation_component_action_idx" ON "ScaffoldOperation"("component", "action");

-- CreateIndex
CREATE INDEX "Plot_projectId_idx" ON "Plot"("projectId");

-- CreateIndex
CREATE INDEX "Plot_houseTypeId_idx" ON "Plot"("houseTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_projectId_plotNumber_key" ON "Plot"("projectId", "plotNumber");

-- CreateIndex
CREATE INDEX "RateItem_rateCardId_idx" ON "RateItem"("rateCardId");

-- CreateIndex
CREATE UNIQUE INDEX "RateItem_rateCardId_component_action_band_key" ON "RateItem"("rateCardId", "component", "action", "band");

-- CreateIndex
CREATE INDEX "StageSplit_rateCardId_idx" ON "StageSplit"("rateCardId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionRateItem_code_key" ON "ConstructionRateItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionScope_projectId_key" ON "ConstructionScope"("projectId");

-- CreateIndex
CREATE INDEX "Quote_projectId_idx" ON "Quote"("projectId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteId_idx" ON "QuoteLineItem"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_plotId_idx" ON "QuoteLineItem"("plotId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderPack" ADD CONSTRAINT "TenderPack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_packId_fkey" FOREIGN KEY ("packId") REFERENCES "TenderPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_houseTypeId_fkey" FOREIGN KEY ("houseTypeId") REFERENCES "HouseType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseType" ADD CONSTRAINT "HouseType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseType" ADD CONSTRAINT "HouseType_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Takeoff" ADD CONSTRAINT "Takeoff_houseTypeId_fkey" FOREIGN KEY ("houseTypeId") REFERENCES "HouseType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Takeoff" ADD CONSTRAINT "Takeoff_seedExtractionId_fkey" FOREIGN KEY ("seedExtractionId") REFERENCES "Extraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_takeoffId_fkey" FOREIGN KEY ("takeoffId") REFERENCES "Takeoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallSegment" ADD CONSTRAINT "WallSegment_takeoffId_fkey" FOREIGN KEY ("takeoffId") REFERENCES "Takeoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldOperation" ADD CONSTRAINT "ScaffoldOperation_takeoffId_fkey" FOREIGN KEY ("takeoffId") REFERENCES "Takeoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_houseTypeId_fkey" FOREIGN KEY ("houseTypeId") REFERENCES "HouseType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateItem" ADD CONSTRAINT "RateItem_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageSplit" ADD CONSTRAINT "StageSplit_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionScope" ADD CONSTRAINT "ConstructionScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
