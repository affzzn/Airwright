-- Site type categories (Airwright, 2026-10-02): Commercial · Construction · Public sector · Small works.
-- Old values map across: School / Public street → Public sector, Construction site → Construction.
ALTER TYPE "SiteType" RENAME TO "SiteType_old";
CREATE TYPE "SiteType" AS ENUM ('COMMERCIAL', 'CONSTRUCTION', 'PUBLIC_SECTOR', 'SMALL_WORKS', 'OTHER');
ALTER TABLE "ConstructionQuote" ALTER COLUMN "siteType" TYPE "SiteType" USING (
  CASE "siteType"::text
    WHEN 'SCHOOL' THEN 'PUBLIC_SECTOR'
    WHEN 'PUBLIC_STREET' THEN 'PUBLIC_SECTOR'
    WHEN 'CONSTRUCTION_SITE' THEN 'CONSTRUCTION'
    ELSE "siteType"::text
  END
)::"SiteType";
DROP TYPE "SiteType_old";
