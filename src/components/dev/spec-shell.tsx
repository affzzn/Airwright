"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface NavGroup {
  label: string;
  items: { id: string; title: string }[];
}

/**
 * Three-column documentation shell: a grouped left nav (the section tree), a
 * constrained reading column, and a right "On this page" rail. One scroll-spy
 * highlights the section in view in both rails. The centre `children` are
 * server-rendered doc sections passed in as a prop.
 */
export function SpecShell({
  groups,
  children,
}: {
  groups: NavGroup[];
  children: React.ReactNode;
}) {
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [active, setActive] = useState(flat[0]?.id ?? "");

  useEffect(() => {
    const els = flat
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [flat]);

  return (
    <div className="lg:flex lg:gap-10 xl:gap-14">
      {/* Left — grouped section tree */}
      <nav className="sticky top-20 hidden h-fit w-48 shrink-0 lg:block">
        <ul className="space-y-5">
          {groups.map((g) => (
            <li key={g.label}>
              <p className="eyebrow mb-2">{g.label}</p>
              <ul className="space-y-0.5 border-l border-hairline">
                {g.items.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        "-ml-px block border-l-2 py-1 pl-3 text-sm transition-colors",
                        active === s.id
                          ? "border-ink font-medium text-ink"
                          : "border-transparent text-ink-muted hover:text-ink",
                      )}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* Centre — constrained doc column */}
      <article className="min-w-0 max-w-3xl flex-1 space-y-14 pb-24">{children}</article>

      {/* Right — on this page */}
      <nav className="sticky top-20 hidden h-fit w-44 shrink-0 xl:block">
        <p className="eyebrow mb-2">On this page</p>
        <ul className="space-y-0.5">
          {flat.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={cn(
                  "block py-1 text-sm transition-colors",
                  active === s.id ? "font-medium text-ink" : "text-ink-subtle hover:text-ink",
                )}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
