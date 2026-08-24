"use client";

import { useTransition } from "react";
import { FileText, Loader2, Printer } from "lucide-react";
import { generateQuote } from "@/server/actions/quotes";
import { Button } from "@/components/ui/button";

export function GenerateQuoteButton({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          await generateQuote(projectId);
        })
      }
      disabled={pending || disabled}
      className="gap-2"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <FileText className="h-4 w-4" strokeWidth={1.75} />
      )}
      Generate quote
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="gap-2">
      <Printer className="h-4 w-4" strokeWidth={1.75} /> Print / Save PDF
    </Button>
  );
}
