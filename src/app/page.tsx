import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { HomeHub } from "@/components/home-hub";

export const dynamic = "force-dynamic";

/** The Home hub — the app's landing menu. Two live counts, otherwise static. */
export default async function HomePage() {
  const [tenderCount, constructionCount] = await Promise.all([
    prisma.project.count({ where: { archivedAt: null } }),
    prisma.constructionQuote.count(),
  ]);

  return (
    <AppShell>
      <HomeHub tenderCount={tenderCount} constructionCount={constructionCount} />
    </AppShell>
  );
}
