import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadConstructionQuote, loadConstructionLibrary } from "@/server/construction";
import { ConstructionBuilder } from "@/components/construction/construction-builder";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ConstructionQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [quote, library] = await Promise.all([
    loadConstructionQuote(id),
    loadConstructionLibrary(),
  ]);
  if (!quote) notFound();

  return (
    <AppShell variant="wide">
      <ConstructionBuilder quote={quote} library={library} aiEnabled={env.constructionAI} />
    </AppShell>
  );
}
