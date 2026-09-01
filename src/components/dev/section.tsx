import { cn } from "@/lib/utils";

/**
 * A titled spec section with a scroll-anchor id (the Dev nav jumps to these).
 * `scroll-mt` clears the sticky app header when jumped to.
 */
export function Section({
  id,
  title,
  eyebrow,
  intro,
  children,
  className,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h2 className="group flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
        {title}
        <a
          href={`#${id}`}
          aria-label={`Link to ${title}`}
          className="text-ink-subtle opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        >
          #
        </a>
      </h2>
      {intro && <div className="mt-2 text-sm leading-relaxed text-ink-muted">{intro}</div>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
