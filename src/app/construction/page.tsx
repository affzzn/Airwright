import { AppShell } from "@/components/app-shell";
import { loadConstructionQuotes } from "@/server/construction";
import { ConstructionWorkspace } from "@/components/construction/construction-workspace";

export const dynamic = "force-dynamic";

export default async function ConstructionPage() {
  const quotes = await loadConstructionQuotes();
  return (
    <AppShell>
      <ConstructionWorkspace quotes={quotes} />
    </AppShell>
  );
}
