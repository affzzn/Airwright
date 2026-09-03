import { ClientQuote } from "@/components/client-quote";

/**
 * Shared client quote view — STATIC front-end mockup (front-end only, wired to
 * nothing). The "unique link a builder opens to see their quotation" concept.
 *
 * ⚠ No data fetch, no DB, no pricing engine — all figures are hardcoded in
 * `client-quote.tsx`. Renders standalone (no app shell / nav): this is the
 * client's own view. Public route (see middleware). `ref` is shown as-is so the
 * link reads like a real quote reference.
 */
export default async function ClientQuotePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  return <ClientQuote reference={decodeURIComponent(ref)} />;
}
