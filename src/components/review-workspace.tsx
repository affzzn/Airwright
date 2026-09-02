"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PdfViewerClient } from "@/components/pdf-viewer-client";
import { Badge } from "@/components/ui/badge";
import {
  TakeoffEditor,
  type EditorCategoricals,
  type EditorMeasurement,
  type EditorWall,
} from "@/components/takeoff-editor";
import type { ExtractionResult } from "@/lib/extract/schema";
import type { PageRef } from "@/lib/provenance";

const STATUS: Record<string, { label: string; variant: "solid" | "muted" | "outline" }> = {
  CONFIRMED: { label: "Confirmed", variant: "solid" },
  IN_REVIEW: { label: "In review", variant: "muted" },
  DRAFT: { label: "Draft", variant: "outline" },
};

/**
 * The review workspace — a single viewport-height frame (no page scroll on
 * desktop): a slim toolbar, then two panes. The drawing (left) is fixed and
 * fit-to-contain so it never needs its own scrollbar; the take-off (right) is
 * the ONLY thing that scrolls. Below `lg` the panes stack and the page scrolls
 * normally. Shares one piece of state: a "go to this page" signal so a
 * provenance link on the right jumps the viewer on the left.
 */
export function ReviewWorkspace({
  backHref,
  title,
  subtitle,
  modelLabel,
  pdfUrl,
  fullDrawingHref,
  relevantPages,
  takeoffId,
  status,
  confirmedAt,
  measurements,
  walls,
  warnings,
  categoricals,
  notes,
  raw,
  documentPages,
  storeyLiftTemplate,
}: {
  backHref: string;
  title: string;
  subtitle: string;
  modelLabel?: string;
  pdfUrl: string | null;
  fullDrawingHref?: string | null;
  relevantPages?: number[];
  takeoffId: string;
  status: string;
  confirmedAt: string | null;
  measurements: EditorMeasurement[];
  walls: EditorWall[];
  warnings: Record<string, unknown>;
  categoricals: EditorCategoricals;
  notes: string | null;
  raw: ExtractionResult | null;
  documentPages: PageRef[];
  storeyLiftTemplate?: Record<string, number>;
}) {
  const [goTo, setGoTo] = useState<{ page: number; nonce: number } | null>(null);
  const onGoToPage = (page: number) =>
    setGoTo((g) => ({ page, nonce: (g?.nonce ?? 0) + 1 }));
  const st = STATUS[status] ?? { label: status, variant: "outline" as const };

  return (
    <div className="flex h-full flex-col">
      {/* Slim toolbar */}
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            aria-label="Back to project"
            className="shrink-0 text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </Link>
          <h1 className="truncate text-base font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <Badge variant={st.variant} className="shrink-0">
            {st.label}
          </Badge>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {modelLabel && (
            <span title="The AI model that read this drawing (chosen when the tender was created).">
              <Badge variant="outline">{modelLabel}</Badge>
            </span>
          )}
          <p className="truncate text-xs text-ink-subtle">{subtitle}</p>
        </div>
      </div>

      {/* Two panes */}
      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:grid-rows-1">
        {/* Drawing — fixed, fit-to-contain, no scrollbar of its own */}
        <div className="flex h-[55vh] flex-col overflow-hidden border-b border-hairline p-4 lg:h-auto lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between pb-3">
            <h2 className="text-sm font-semibold text-ink">Drawing</h2>
            {(fullDrawingHref || pdfUrl) && (
              <a
                href={fullDrawingHref || pdfUrl || "#"}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-ink-muted hover:text-ink"
                title="Open the full drawing (every page of the whole house-type dossier) in a new tab"
              >
                Open full drawing ↗
              </a>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {pdfUrl ? (
              <PdfViewerClient
                url={pdfUrl}
                pages={relevantPages}
                goTo={goTo}
                fit="contain"
              />
            ) : (
              <p className="py-10 text-center text-sm text-ink-subtle">
                Drawing preview unavailable (Storage not configured).
              </p>
            )}
          </div>
        </div>

        {/* Editable take-off — the only scrolling pane */}
        <div className="flex min-h-0 flex-col p-4 lg:overflow-hidden">
          <TakeoffEditor
            takeoffId={takeoffId}
            status={status}
            confirmedAt={confirmedAt}
            measurements={measurements}
            walls={walls}
            warnings={warnings}
            categoricals={categoricals}
            notes={notes}
            raw={raw}
            documentPages={documentPages}
            relevantPages={relevantPages}
            onGoToPage={onGoToPage}
            storeyLiftTemplate={storeyLiftTemplate}
          />
        </div>
      </div>
    </div>
  );
}
