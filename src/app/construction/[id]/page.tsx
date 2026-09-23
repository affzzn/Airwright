import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadConstructionQuote, loadConstructionLibrary, priceLoadedQuote } from "@/server/construction";
import { ConstructionJob } from "@/components/construction/construction-job";
import {
  ConstructionQuoteDocument,
  constructionQuoteNumber,
} from "@/components/construction/construction-quote-document";
import { defaultStep, factsFromQuote, type JobStep } from "@/lib/construction/jobState";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const STEPS: JobStep[] = ["enquiry", "facts", "items", "quote"];

export default async function ConstructionJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const [quote, library] = await Promise.all([
    loadConstructionQuote(id),
    loadConstructionLibrary(),
  ]);
  if (!quote) notFound();

  const initialStep = STEPS.includes(step as JobStep)
    ? (step as JobStep)
    : defaultStep(factsFromQuote(quote));

  return (
    <AppShell variant="wide">
      <ConstructionJob
        quote={quote}
        library={library}
        aiEnabled={env.constructionAI}
        initialStep={initialStep}
        // Rendered on the server and handed to the client shell, so the quote
        // step previews the SAME document the client receives.
        quoteDocument={
          <ConstructionQuoteDocument
            quote={quote}
            pricing={priceLoadedQuote(quote)}
            quoteNo={constructionQuoteNumber(quote.id)}
          />
        }
      />
    </AppShell>
  );
}
