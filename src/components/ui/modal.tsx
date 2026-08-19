"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Minimal, monochrome modal. Portals to <body>, dims with an ink scrim, closes
 * on Escape or a click on the backdrop, and locks body scroll while open.
 * The panel styling lives in `className` so callers control size/shape.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <div className="absolute inset-0 bg-ink/70" onClick={onClose} aria-hidden />
      <div
        className={cn(
          "relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-hairline bg-canvas",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
