import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadConstructionQuote, priceLoadedQuote } from "@/server/construction";
import { ConstructionPrintBar } from "@/components/construction/construction-print-bar";
import {
  ConstructionQuoteDocument,
  constructionQuoteNumber,
} from "@/components/construction/construction-quote-document";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

/**
 * The printable client quotation. The document itself lives in
 * `ConstructionQuoteDocument`, shared with the in-app preview on the quote step.
 */
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

        <ConstructionQuoteDocument
          quote={quote}
          pricing={pricing}
          quoteNo={constructionQuoteNumber(quote.id)}
        />
      </div>
    </AppShell>
  );
}
