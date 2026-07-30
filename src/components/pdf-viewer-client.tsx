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

export function PdfViewerClient({ url }: { url: string }) {
  return <PdfViewer url={url} />;
}
