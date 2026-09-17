import { notFound } from "next/navigation";
import { loadConstructionQuote } from "@/server/construction";
import { ConstructionReferenceWindow } from "@/components/construction/construction-reference-window";

export const dynamic = "force-dynamic";

/**
 * The pop-out reference window (docs/19) — a standalone, full-window viewer of a
 * quote's drawings + photos, opened from the builder's "Pop out" button so the
 * estimator can keep it on a second monitor. No app shell — it's just the viewer.
 */
export default async function ConstructionReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { id } = await params;
  const { file } = await searchParams;
  const quote = await loadConstructionQuote(id);
  if (!quote) notFound();

  const attachments = quote.attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
  }));

  return (
    <ConstructionReferenceWindow
      title={quote.reference || quote.customerName || "Reference"}
      attachments={attachments}
      initialFile={file ?? null}
    />
  );
}
