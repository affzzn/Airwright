import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConstructionNewForm } from "@/components/construction/construction-new-form";

export const dynamic = "force-dynamic";

export default function NewConstructionQuotePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <Link
          href="/construction"
          className="mb-4 inline-flex items-center gap-1 text-sm text-ink-subtle hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} /> Construction quotes
        </Link>
        <p className="eyebrow mb-1">New construction quote</p>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-ink">Create a quote</h1>
        <p className="mb-6 text-xs text-ink-subtle">
          Start the quote here, then add measurements, pick scaffold items and attach the
          enquiry drawings on the next screen. Everything is editable.
        </p>
        <ConstructionNewForm />
      </div>
    </AppShell>
  );
}
