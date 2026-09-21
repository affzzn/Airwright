import Link from "next/link";
import { ArrowRight, Building2, HardHat } from "lucide-react";

/**
 * The Home hub — a small, no-scroll launcher menu (docs: nav reorg). It's the app
 * landing after sign-in: pick a work area rather than being dropped into a list.
 * Two estimating domains (House Building / Construction), each running the same
 * take-off → pricing → quote flow inside; plus quiet admin/reference links and the
 * greyed future builds.
 */
export function HomeHub({
  tenderCount,
  constructionCount,
}: {
  tenderCount: number;
  constructionCount: number;
}) {
  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col justify-center">
      <div className="mx-auto w-full max-w-3xl">
        <p className="eyebrow mb-1">Airwright estimating</p>
        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-ink">
          What are you working on?
        </h1>

        <p className="eyebrow mb-3">Estimating</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <HubTile
            href="/tenders"
            icon={<Building2 className="h-5 w-5" strokeWidth={1.75} />}
            title="House Building"
            desc="New-build housing tenders — Traditional & Timber-frame."
            meta={`${tenderCount} tender${tenderCount === 1 ? "" : "s"}`}
          />
          <HubTile
            href="/construction"
            icon={<HardHat className="h-5 w-5" strokeWidth={1.75} />}
            title="Construction"
            desc="Bespoke commercial jobs, built off the picking list."
            meta={`${constructionCount} quote${constructionCount === 1 ? "" : "s"}`}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="eyebrow">Admin &amp; reference</span>
          <Link href="/rates" className="text-sm text-ink-muted transition-colors hover:text-ink">
            Rates
          </Link>
          <Link href="/docs" className="text-sm text-ink-muted transition-colors hover:text-ink">
            Docs
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="eyebrow">Coming soon</span>
          <span className="text-xs text-ink-subtle">Gang Pay &amp; Viability</span>
          <span className="text-ink-subtle/50">·</span>
          <span className="text-xs text-ink-subtle">House-Type Bank</span>
        </div>
      </div>
    </div>
  );
}

function HubTile({
  href,
  icon,
  title,
  desc,
  meta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-5 transition-colors hover:border-hairline-strong hover:bg-surface"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-surface text-ink">
          {icon}
        </span>
        <ArrowRight
          className="h-4 w-4 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
          strokeWidth={1.75}
        />
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-subtle">{desc}</p>
      </div>
      <p className="mt-auto text-xs text-ink-muted">{meta}</p>
    </Link>
  );
}
