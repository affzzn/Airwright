/** A small stat tile for a workspace header strip. Monochrome, no border. */
export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
