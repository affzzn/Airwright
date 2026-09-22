import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadConstructionQuote, priceLoadedQuote } from "@/server/construction";
import { ConstructionPrintBar } from "@/components/construction/construction-print-bar";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AirwrightLogo } from "@/components/brand/airwright-logo";
import { AirwrightFooter } from "@/components/brand/airwright-footer";
import { AIRWRIGHT } from "@/lib/brand";
import { UNIT_LABEL, type ConstructionUnit } from "@/lib/construction/types";
import { formatDate, formatGBP } from "@/lib/utils";

export const dynamic = "force-dynamic";

const { navy, blue } = AIRWRIGHT.color;

export default async function ConstructionQuoteOutputPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await loadConstructionQuote(id);
  if (!quote) notFound();
  const pricing = priceLoadedQuote(quote);

  const quoteRef = quote.reference || quote.customerName || "Construction quote";
  const quoteNo = `AW-C-${id.slice(-6).toUpperCase()}`;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <div className="print:hidden">
          <Breadcrumbs
            items={[
              { label: "Construction", href: "/construction" },
              { label: quoteRef, href: `/construction/${quote.id}` },
              { label: "Quotation" },
            ]}
          />
        </div>
        <ConstructionPrintBar quoteId={quote.id} />

        {/* Print styling — white page, brand doc, tidy page breaks. */}
        <style>{`
          @media print {
            @page { margin: 14mm; }
            body { background: #fff !important; }
            .aw-doc { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
            .aw-row { break-inside: avoid; }
            .aw-keep { break-inside: avoid; }
          }
        `}</style>

        <div
          className="aw-doc rounded-lg border border-hairline bg-white p-10 text-[13px] text-[#333] print:p-0"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-6">
            <AirwrightLogo width={220} />
            <div className="text-right text-[12px] leading-6">
              <p style={{ fontWeight: 700, color: navy }}>QUOTATION {quoteNo}</p>
              {quote.customerName && <p style={{ fontWeight: 600, color: navy }}>{quote.customerName}</p>}
              {quote.reference && <p style={{ fontWeight: 600, color: navy }}>{quote.reference}</p>}
              <p className="text-[#666]">Date {formatDate(quote.createdAt)}</p>
            </div>
          </div>

          <div className="my-5 h-[2px]" style={{ background: navy }} />

          {/* Cover note */}
          <div className="aw-keep space-y-3 text-[13px] leading-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              {quote.customerName && (
                <p><span className="text-[#888]">FAO </span><span className="font-semibold text-[#222]">{quote.customerName}</span></p>
              )}
              {quote.siteAddress && (
                <p><span className="text-[#888]">Site </span><span className="text-[#222]">{quote.siteAddress}</span></p>
              )}
              <p className="col-span-2">
                <span className="text-[#888]">Project </span>
                <span className="font-semibold text-[#222]">{quoteRef}</span>
              </p>
            </div>
            <p className="pt-2">Dear {quote.customerName || "Sir/Madam"},</p>
            <p>
              Thank you for your enquiry. We are pleased to submit the following quotation for the hire,
              delivery, erection, dismantling and clearing of scaffolding.
            </p>
            <p>
              All scaffold to comply with current Health, Safety and Welfare regulations. All materials are
              to be supplied and fixed once only, unless otherwise stated.
            </p>
            {quote.notes && (
              <div className="rounded-md border-l-2 pl-3" style={{ borderColor: blue }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: navy }}>Scope of works</p>
                <p className="whitespace-pre-wrap text-[#444]">{quote.notes}</p>
              </div>
            )}
            <p>Please do not hesitate to contact us should you have any queries.</p>
            <p className="pt-1">Many thanks,</p>
            <p className="font-semibold" style={{ color: navy }}>Airwright Midland</p>
          </div>

          {/* Specification / itemised pricing */}
          <div className="mt-8 aw-keep">
            <h2 className="mb-1 text-base font-semibold" style={{ color: navy }}>Specification of quotation</h2>
            <p className="mb-3 text-[12px] text-[#666]">
              The quoted works, priced per lift where applicable. Rates exclude VAT.
            </p>
          </div>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr style={{ background: navy, color: "#fff" }}>
                <th className="px-2 py-2 text-left font-semibold">Item</th>
                <th className="px-2 py-2 text-left font-semibold">Specification &amp; description</th>
                <th className="px-2 py-2 text-right font-semibold">Rate (£)</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-center font-semibold">Lifts</th>
                <th className="px-2 py-2 text-center font-semibold">Hire&nbsp;(wks)</th>
                <th className="px-2 py-2 text-right font-semibold">Amount (£)</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-[#888]">No items.</td></tr>
              )}
              {quote.lines.map((l, i) => (
                <tr key={l.id} className="aw-row border-b border-[#e6e6e6] align-top">
                  <td className="px-2 py-2 text-[#666]">{i + 1}</td>
                  <td className="px-2 py-2 text-[#222]">
                    <span className="font-medium">{l.description}</span>
                    <span className="ml-1 text-[11px] text-[#888]">· {UNIT_LABEL[l.unit as ConstructionUnit] ?? l.unit}</span>
                    {l.note && <span className="block text-[11px] text-[#888]">{l.note}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#444]">{formatGBP(l.rate)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#444]">{l.quantity}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-[#666]">{l.lifts ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-[#666]">{quote.durationWeeks ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-[#111]">{formatGBP(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="aw-row" style={{ borderTop: `2px solid ${navy}` }}>
                <td colSpan={6} className="px-2 py-2.5 text-right text-[13px] font-semibold" style={{ color: navy }}>
                  Grand total (excl. VAT)
                </td>
                <td className="px-2 py-2.5 text-right text-[15px] font-bold tabular-nums" style={{ color: navy }}>
                  {formatGBP(pricing.total)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Hire terms */}
          <div className="mt-4 space-y-1.5 text-[12px] text-[#444] aw-keep">
            {quote.durationWeeks != null && (
              <p><span className="font-semibold text-[#222]">Hire period:</span> {quote.durationWeeks} weeks inclusive from first delivery.</p>
            )}
            {pricing.extraHirePerWeek != null && (
              <p>
                <span className="font-semibold text-[#222]">Extra hire:</span> {formatGBP(pricing.extraHirePerWeek)} per week
                beyond the inclusive period ({quote.extraHirePctPerWeek}% of the job cost per week; a part-week is charged as a full week).
              </p>
            )}
            <p className="text-[11px] text-[#888]">⚠ Rates are placeholders pending Airwright’s construction rate sheet.</p>
          </div>

          {/* Terms & conditions */}
          <div className="mt-8 aw-keep">
            <h2 className="mb-2 text-base font-semibold" style={{ color: navy }}>Terms &amp; conditions</h2>
            <dl className="space-y-2 text-[11.5px] leading-5 text-[#444]">
              <Term term="Insurance">
                Airwright Midland Ltd has Public Liability Insurance up to £5m and Employers Liability Insurance
                up to £10m to cover its operations. Cover is subject to the terms, limitations and conditions of
                the policies. Additional cover can be arranged on request.
              </Term>
              <Term term="Minimum period of hire">
                Commences on first delivery or completion of the 1st lift, and terminates on written instructions
                to dismantle.
              </Term>
              <Term term="Payment terms">
                All prices quoted are subject to VAT, added to the invoice at the current rate. Approved accounts
                are strictly net, due for settlement 14 days from date of invoice.
              </Term>
              <Term term="Trading conditions">
                This quotation is subject to Airwright Midland’s Conditions for Hire, Erection and Dismantling of
                Scaffolding (available on application). Figures quoted are correct to the best of our knowledge,
                errors and omissions excepted.
              </Term>
              <Term term="Safety">
                Boards may be moved after placement. The client must ensure working platforms comply with the
                regulations at all times. Foundations/base must be adequate to support the load. Ties and braces
                must not be removed without reference to Airwright Midland. Weekly inspections under the Work at
                Height Regulations 2005 must be carried out by a competent person.
              </Term>
            </dl>
          </div>

          {/* Assumptions */}
          <div className="mt-6 aw-keep">
            <h3 className="mb-1 text-[12px] font-semibold" style={{ color: navy }}>Assumptions &amp; exclusions</h3>
            <ul className="list-inside list-disc text-[11px] text-[#666]">
              <li>Priced strictly to the scope above. Items not listed are excluded.</li>
              {quote.measurements.some((m) => m.source === "GOOGLE_EARTH") && (
                <li>Some measurements taken from Google Earth; subject to site confirmation.</li>
              )}
              {pricing.flags.filter((f) => f.level === "warn").map((f, i) => (
                <li key={i}>{f.message}</li>
              ))}
            </ul>
          </div>

          {/* Reference attachments */}
          {quote.attachments.length > 0 && (
            <div className="mt-6 aw-keep">
              <h3 className="mb-1 text-[12px] font-semibold" style={{ color: navy }}>Reference drawings / enquiry</h3>
              <ul className="list-inside list-disc text-[11px] text-[#666]">
                {quote.attachments.map((a) => (<li key={a.id}>{a.fileName}</li>))}
              </ul>
            </div>
          )}

          {/* Acceptance */}
          <div className="mt-8 aw-keep">
            <h2 className="mb-2 text-base font-semibold" style={{ color: navy }}>Acceptance</h2>
            <p className="mb-4 text-[11.5px] text-[#444]">
              To accept this quotation, sign below and return by email to {AIRWRIGHT.email}.
            </p>
            <div className="grid grid-cols-2 gap-x-10 gap-y-5 text-[11px] text-[#666]">
              <SignLine label="Signature" />
              <SignLine label="Date" />
              <SignLine label="Name" />
              <SignLine label="Position" />
            </div>
          </div>

          {/* Footer band */}
          <div className="mt-10 border-t border-[#e0e0e0] pt-5 aw-keep">
            <AirwrightFooter />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3">
      <dt className="font-semibold uppercase tracking-wide text-[10.5px] text-[#555]">{term}</dt>
      <dd className="text-[#555]">{children}</dd>
    </div>
  );
}

function SignLine({ label }: { label: string }) {
  return (
    <div>
      <div className="h-6 border-b border-dashed border-[#999]" />
      <p className="mt-1 uppercase tracking-wide">{label}</p>
    </div>
  );
}
