-- AlterTable
ALTER TABLE "Takeoff" ADD COLUMN     "configuration" "Configuration" NOT NULL DEFAULT 'DETACHED',
ADD COLUMN     "includePartyWall" BOOLEAN NOT NULL DEFAULT true;
