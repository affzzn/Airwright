"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDocumentIncluded } from "@/server/actions/documents";
import { cn } from "@/lib/utils";

/** Small Use/Exclude toggle for a file's manual relevance override. */
export function DocumentToggle({
  documentId,
  included,
}: {
  documentId: string;
  included: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setDocumentIncluded(documentId, !included);
          router.refresh();
        })
      }
      className={cn(
        "rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        included
          ? "border-hairline-strong bg-canvas text-ink-muted hover:bg-surface"
          : "border-transparent bg-ink text-canvas hover:opacity-90",
      )}
    >
      {pending ? "…" : included ? "Exclude" : "Use file"}
    </button>
  );
}
