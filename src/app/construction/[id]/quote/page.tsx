import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadConstructionQuote, priceLoadedQuote } from "@/server/construction";
import { ConstructionPrintBar } from "@/components/construction/construction-print-bar";
import {
  BAND_LABEL,
  UNIT_LABEL,
  type ConstructionUnit,
  type RateBand,
} from "@/lib/construction/types";
import { formatDate, formatGBP } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ENQUIRY_LABEL: Record<string, string> = {
  VAGUE: "Vague enquiry",
  SCOPE_OF_WORKS: "Scope of works",
  DETAILED: "Detailed (marked-up drawings)",
};

export default async function ConstructionQuoteOutputPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await loadConstructionQuote(id);
  if (!quote) notFound();
  const pricing = priceLoadedQuote(quote);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <ConstructionPrintBar quoteId={quote.id} />

        <div className="rounded-lg border border-hairline bg-canvas p-8 print:border-0 print:p-0">
          {/* Letterhead */}
          <div className="mb-6 flex items-start justify-between border-b border-hairline pb-5">
            <div>
              <p className="text-lg font-semibold tracking-tight text-ink">Airwright Midland</p>
              <p className="text-xs text-ink-subtle">Scaffolding quotation</p>
            </div>
            <div className="text-right text-xs text-ink-subtle">
              <p>{formatDate(quote.createdAt)}</p>
              <p>{ENQUIRY_LABEL[quote.enquiryType ?? ""] ?? ""}</p>
            </div>
          </div>

          {/* Header details */}
          <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-subtle">Project</p>
              <p className="text-ink">{quote.reference || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-subtle">Customer</p>
              <p className="text-ink">{quote.customerName || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-subtle">Site</p>
              <p className="text-ink">{quote.siteAddress || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-subtle">Rate band</p>
              <p className="text-ink">{BAND_LABEL[quote.band as RateBand] ?? quote.band}</p>
            </div>
          </div>

          {/* Scope of works */}
          {quote.notes && (
            <div className="mb-6">
              <h2 className="mb-1 text-sm font-semibold text-ink">Scope of works</h2>
              <p className="whitespace-pre-wrap text-sm text-ink-muted">{quote.notes}</p>
            </div>
          )}

          {/* Itemised pricing */}
          <h2 className="mb-2 text-sm font-semibold text-ink">Itemised pricing</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong text-left text-xs text-ink-subtle">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">Lifts</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th>
                <th className="py-2 pr-3 font-medium">Unit</th>
                <th className="py-2 pr-3 text-right font-medium">Rate</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-sm text-ink-subtle">No items.</td>
                </tr>
              )}
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b border-hairline last:border-0">
                  <td className="py-2 pr-3 text-ink">
                    {l.description}
                    {l.note && <span className="block text-[11px] text-ink-subtle">{l.note}</span>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-ink-muted">{l.lifts ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">{l.quantity}</td>
                  <td className="py-2 pr-3 text-ink-subtle">{UNIT_LABEL[l.unit as ConstructionUnit] ?? l.unit}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">{formatGBP(l.rate)}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{formatGBP(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink">
                <td colSpan={5} className="py-2 pr-3 text-right text-sm font-semibold text-ink">Total (inclusive of hire)</td>
                <td className="py-2 text-right text-base font-semibold tabular-nums text-ink">{formatGBP(pricing.total)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Terms */}
          <div className="mt-6 space-y-1.5 text-sm text-ink-muted">
            {quote.durationWeeks != null && (
              <p>
                <span className="font-medium text-ink">Hire duration:</span> {quote.durationWeeks} weeks inclusive.
              </p>
            )}
            {pricing.extraHirePerWeek != null && (
              <p>
                <span className="font-medium text-ink">Extra hire:</span> {formatGBP(pricing.extraHirePerWeek)} per week
                beyond the inclusive period ({quote.extraHirePctPerWeek}% of the job cost per week; a part-week is charged as a full week).
              </p>
            )}
          </div>

          {/* Attachments referenced */}
          {quote.attachments.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-1 text-sm font-semibold text-ink">Reference drawings / enquiry</h2>
              <ul className="list-inside list-disc text-sm text-ink-muted">
                {quote.attachments.map((a) => (
                  <li key={a.id}>{a.fileName}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Assumptions */}
          <div className="mt-6 border-t border-hairline pt-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Assumptions &amp; exclusions</h2>
            <ul className="list-inside list-disc text-xs text-ink-subtle">
              <li>Priced strictly to the scope above — items not listed are excluded.</li>
              {quote.measurements.some((m) => m.source === "GOOGLE_EARTH") && (
                <li>Some measurements taken from Google Earth; subject to site confirmation.</li>
              )}
              {pricing.flags
                .filter((f) => f.level === "warn")
                .map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
            </ul>
            <p className="mt-3 text-[11px] text-ink-subtle">⚠ Rates are placeholders pending Airwright’s construction rate sheet.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
