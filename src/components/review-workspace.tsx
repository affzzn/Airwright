"use client";

import { useCallback, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PdfViewerClient } from "@/components/pdf-viewer-client";
import {
  TakeoffEditor,
  type EditorCategoricals,
  type EditorMeasurement,
  type EditorWall,
} from "@/components/takeoff-editor";
import type { ExtractionResult } from "@/lib/extract/schema";
import type { PageRef } from "@/lib/provenance";

/**
 * The two-column review workspace. Owns the one piece of shared state between
 * the drawing (left) and the editable take-off (right): a "go to this page"
 * signal, so a provenance page link on the right jumps the viewer on the left.
 */
export function ReviewWorkspace({
  pdfUrl,
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
  pdfUrl: string | null;
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
  const [flags, setFlags] = useState<string[]>([]);
  const onGoToPage = (page: number) =>
    setGoTo((g) => ({ page, nonce: (g?.nonce ?? 0) + 1 }));
  const onFlagsChange = useCallback((f: string[]) => setFlags(f), []);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {/* Drawing — pinned so it stays in view while the take-off is reviewed */}
      <div className="lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] lg:self-start lg:overflow-y-auto">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Drawing</h2>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-ink-muted hover:text-ink"
              >
                Open original ↗
              </a>
            )}
          </CardHeader>
          <CardBody>
            {pdfUrl ? (
              <PdfViewerClient url={pdfUrl} pages={relevantPages} goTo={goTo} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-subtle">
                Drawing preview unavailable (Storage not configured).
              </p>
            )}

            {(flags.length > 0 || notes) && (
              <div className="mt-5 space-y-5 border-t border-hairline pt-5">
                {flags.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Review flags</p>
                    <ul className="space-y-1.5">
                      {flags.map((f) => (
                        <li
                          key={f}
                          className="text-[11px] leading-snug text-ink-subtle"
                        >
                          ⚠ {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {notes && (
                  <div>
                    <p className="eyebrow mb-2">AI notes</p>
                    <p className="rounded-md border border-hairline bg-surface px-3 py-2.5 text-sm text-ink-muted">
                      {notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Editable take-off, with provenance on hover */}
      <TakeoffEditor
        takeoffId={takeoffId}
        status={status}
        confirmedAt={confirmedAt}
        measurements={measurements}
        walls={walls}
        warnings={warnings}
        categoricals={categoricals}
        raw={raw}
        documentPages={documentPages}
        relevantPages={relevantPages}
        onGoToPage={onGoToPage}
        onFlagsChange={onFlagsChange}
        storeyLiftTemplate={storeyLiftTemplate}
      />
    </div>
  );
}
