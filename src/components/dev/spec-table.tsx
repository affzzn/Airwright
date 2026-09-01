import { cn } from "@/lib/utils";

/** A plain bordered spec table. Cells may be strings or nodes (badges, mono). */
export function SpecTable({
  head,
  rows,
  caption,
  colClass,
}: {
  head: string[];
  rows: React.ReactNode[][];
  caption?: string;
  /** Optional per-column className (e.g. widths). */
  colClass?: (string | undefined)[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      {caption && (
        <p className="border-b border-hairline bg-surface px-4 py-2 text-xs text-ink-muted">{caption}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface text-left">
              {head.map((h, i) => (
                <th key={i} className={cn("px-4 py-2.5 font-medium text-ink-muted", colClass?.[i])}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-hairline align-top last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className={cn("px-4 py-3 text-ink-muted", colClass?.[ci])}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
