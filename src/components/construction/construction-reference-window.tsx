"use client";

import { useState } from "react";
import {
  ReferenceViewerBody,
  isPreviewable,
  type RefAttachment,
} from "@/components/construction/construction-reference-viewer";

/**
 * The standalone pop-out reference window — a full-window drawings/photos viewer
 * (no app shell), for a second monitor. Wraps the shared ReferenceViewerBody.
 */
export function ConstructionReferenceWindow({
  title,
  attachments,
  initialFile,
}: {
  title: string;
  attachments: RefAttachment[];
  initialFile: string | null;
}) {
  const previewable = attachments.filter(isPreviewable);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialFile ?? previewable[0]?.id ?? null,
  );

  return (
    <div className="flex h-screen flex-col bg-page">
      <header className="flex shrink-0 items-center justify-between border-b border-hairline bg-canvas px-4 py-2">
        <span className="text-sm font-semibold text-ink">Reference · {title}</span>
        <span className="text-xs text-ink-subtle">Drawings &amp; photos</span>
      </header>
      <div className="min-h-0 flex-1">
        <ReferenceViewerBody
          attachments={previewable}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}
