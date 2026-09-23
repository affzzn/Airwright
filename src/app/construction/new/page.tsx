import { AppShell } from "@/components/app-shell";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ConstructionNewForm } from "@/components/construction/construction-new-form";

export const dynamic = "force-dynamic";

export default function NewConstructionQuotePage() {
  return (
    <AppShell variant="wide">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[{ label: "Construction", href: "/construction" }, { label: "New job" }]}
        />
        <h1 className="mb-5 text-2xl font-semibold tracking-tight text-ink">Start a job</h1>
        <ConstructionNewForm />
      </div>
    </AppShell>
  );
}
