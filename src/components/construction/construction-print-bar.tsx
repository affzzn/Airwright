"use client";

import Link from "next/link";
import { ChevronLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Toolbar above the printable construction quote (hidden when printing). */
export function ConstructionPrintBar({ quoteId }: { quoteId: string }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
      <Link
        href={`/construction/${quoteId}`}
        className="inline-flex items-center gap-1 text-sm text-ink-subtle hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} /> Back to builder
      </Link>
      <div className="flex items-center gap-2">
        <a href={`/construction/${quoteId}/quote/export`}>
          <Button variant="secondary" className="gap-2">
            <Download className="h-4 w-4" strokeWidth={1.75} /> Export Excel
          </Button>
        </a>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" strokeWidth={1.75} /> Print / Save PDF
        </Button>
      </div>
    </div>
  );
}
