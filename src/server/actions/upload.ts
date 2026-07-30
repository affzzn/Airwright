"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { uploadToStorage } from "@/lib/supabase/storage";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";
import { getPdfPageCount, planPageRanges } from "@/lib/pdf";
import { env } from "@/lib/env";

/**
 * Upload one or more PDFs into a pack:
 *   file → Supabase Storage → Document row → one Extraction + queued job per
 *   page-range (oversized packs are split by page).
 */
export async function uploadDocuments(packId: string, formData: FormData) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return;

  const boss = await getBoss();

  for (const file of files) {
    if (file.type !== "application/pdf") continue;

    const buffer = Buffer.from(await file.arrayBuffer());

    let pageCount: number | null = null;
    try {
      pageCount = await getPdfPageCount(buffer);
    } catch {
      pageCount = null; // unreadable — flagged below for a human
    }

    const storagePath = `${packId}/${crypto.randomUUID()}-${file.name}`;
    await uploadToStorage(storagePath, buffer, "application/pdf");

    const document = await prisma.document.create({
      data: {
        packId,
        fileName: file.name,
        storageBucket: env.storageBucket,
        storagePath,
        mimeType: "application/pdf",
        pageCount,
        sizeBytes: buffer.byteLength,
        isReadable: pageCount !== null,
      },
    });

    // Unreadable PDFs skip extraction and wait for manual handling.
    if (pageCount === null) continue;

    const ranges = planPageRanges(pageCount);
    for (const pageRange of ranges) {
      const extraction = await prisma.extraction.create({
        data: {
          documentId: document.id,
          pageRange,
          model: env.extractionModel,
          promptVersion: "pending",
          status: "PENDING",
        },
      });

      await boss.send(EXTRACT_DRAWING_QUEUE, {
        documentId: document.id,
        extractionId: extraction.id,
        pageRange,
      });
    }
  }

  const pack = await prisma.tenderPack.findUnique({ where: { id: packId } });
  if (pack) revalidatePath(`/projects/${pack.projectId}`);
}
