import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string; // omit (or it's the last item) → rendered as plain current-page text
}

/**
 * A simple, monochrome breadcrumb trail: `A > B > C`, where every item but the
 * last is a link back up the hierarchy. Separator is " > " (per the app style).
 * Use at the top of a page that sits inside a clear parent → child path.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}
    >
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-x-2">
            {c.href && !last ? (
              <Link href={c.href} className="text-ink-subtle transition-colors hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "font-medium text-ink" : "text-ink-subtle"}>{c.label}</span>
            )}
            {!last && (
              <span aria-hidden className="select-none text-ink-subtle/70">
                &gt;
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
