import { AppShell } from "@/components/app-shell";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ConstructionNewForm } from "@/components/construction/construction-new-form";

export const dynamic = "force-dynamic";

export default function NewConstructionQuotePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <Breadcrumbs
          items={[{ label: "Construction", href: "/construction" }, { label: "New job" }]}
        />
        <p className="eyebrow mb-1">Construction</p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">New job</h1>
        <ConstructionNewForm />
      </div>
    </AppShell>
  );
}
