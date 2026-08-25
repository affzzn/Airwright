"use client";

import dynamic from "next/dynamic";

// react-pdf is browser-only — load it without SSR.
const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-ink-subtle">
      Loading viewer…
    </div>
  ),
});

export function PdfViewerClient({
  url,
  pages,
  goTo,
  fit,
}: {
  url: string;
  pages?: number[];
  goTo?: { page: number; nonce: number } | null;
  fit?: "width" | "contain";
}) {
  return <PdfViewer url={url} pages={pages} goTo={goTo} fit={fit} />;
}
