import { AppShell } from "@/components/app-shell";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ConstructionNewForm } from "@/components/construction/construction-new-form";

export const dynamic = "force-dynamic";

export default function NewConstructionQuotePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <Breadcrumbs
          items={[{ label: "Construction", href: "/construction" }, { label: "New quote" }]}
        />
        <p className="eyebrow mb-1">New construction quote</p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">Create a quote</h1>
        <ConstructionNewForm />
      </div>
    </AppShell>
  );
}
