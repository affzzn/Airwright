"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { deleteConstructionQuote } from "@/server/actions/construction";
import type { ConstructionQuoteListItem } from "@/server/construction";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { formatDate, formatGBP } from "@/lib/utils";
import { BAND_LABEL, type RateBand } from "@/lib/construction/types";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  QUOTED: "Quoted",
};

export function ConstructionWorkspace({ quotes }: { quotes: ConstructionQuoteListItem[] }) {
  const [deleteTarget, setDeleteTarget] = useState<ConstructionQuoteListItem | null>(null);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Construction</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Construction quotes</h1>
          <p className="mt-1 max-w-2xl text-xs text-ink-subtle">
            Bespoke, per-job scaffolding priced off the picking list. You enter the
            measurements; the tool does the maths and the paperwork.
          </p>
        </div>
        <Link href="/construction/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> New quote
          </Button>
        </Link>
      </div>

      {quotes.length === 0 ? (
        <Card>
          <CardBody className="py-16 text-center">
            <p className="text-sm text-ink-muted">No construction quotes yet.</p>
            <Link href="/construction/new" className="mt-3 inline-block">
              <Button variant="secondary" className="gap-2">
                <Plus className="h-4 w-4" strokeWidth={1.75} /> New quote
              </Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                  <th className="px-5 py-3 font-medium">Quote</th>
                  <th className="px-3 py-3 font-medium">Site</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Band</th>
                  <th className="px-3 py-3 text-right font-medium">Items</th>
                  <th className="px-3 py-3 text-right font-medium">Total</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link href={`/construction/${q.id}`} className="block font-medium text-ink hover:underline">
                        {q.reference || q.customerName || "Untitled quote"}
                      </Link>
                      {q.reference && q.customerName && (
                        <span className="text-xs text-ink-subtle">{q.customerName}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">{q.siteAddress ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Badge variant={q.status === "DRAFT" ? "muted" : "solid"}>
                        {STATUS_LABEL[q.status] ?? q.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-ink-muted">{BAND_LABEL[q.band as RateBand] ?? q.band}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-muted">{q.lineCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">{formatGBP(q.total)}</td>
                    <td className="px-3 py-3 text-ink-subtle">{formatDate(q.createdAt)}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        aria-label="Delete quote"
                        onClick={() => setDeleteTarget(q)}
                        className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-canvas hover:text-ink"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <DeleteQuoteModal target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

function DeleteQuoteModal({
  target,
  onClose,
}: {
  target: ConstructionQuoteListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = () => {
    if (!target) return;
    start(async () => {
      await deleteConstructionQuote(target.id);
      onClose();
      router.refresh();
    });
  };
  return (
    <Modal open={target !== null} onClose={() => (pending ? null : onClose())} label="Delete quote" className="max-w-md">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Delete quote</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-ink-muted">
          Delete <span className="font-medium text-ink">{target?.reference || target?.customerName || "this quote"}</span>{" "}
          and its measurements, lines and attachment records. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={pending} onClick={confirm} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />} Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
