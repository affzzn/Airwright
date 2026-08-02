"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createSignedUploadUrl } from "@/lib/supabase/storage";
import { getBoss } from "@/lib/queue/boss";
import { PROCESS_PACK_QUEUE } from "@/lib/queue/jobs";

export interface UploadTarget {
  path: string;
  token: string;
  name: string;
  type: string;
  size: number;
  isArchive: boolean;
}

/**
 * Step 1: mint a signed upload URL per file so the browser can upload directly
 * to Supabase Storage (fast, no server body limit). PDFs and ZIPs only.
 */
export async function createSignedUploads(
  packId: string,
  files: { name: string; type: string; size: number }[],
): Promise<UploadTarget[]> {
  const targets: UploadTarget[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    const isArchive = lower.endsWith(".zip");
    const isPdf = lower.endsWith(".pdf");
    if (!isArchive && !isPdf) continue;

    const path = `${packId}/raw/${randomUUID()}-${f.name}`;
    const { token } = await createSignedUploadUrl(path);
    targets.push({ path, token, name: f.name, type: f.type, size: f.size, isArchive });
  }
  return targets;
}

/**
 * Step 2: after the browser has uploaded, register the raw files and kick off
 * the process-pack job (unzip → classify → segment → extract).
 */
export async function finalizeUploads(
  packId: string,
  uploaded: {
    path: string;
    name: string;
    type: string;
    size: number;
    isArchive: boolean;
  }[],
): Promise<void> {
  if (uploaded.length === 0) return;

  await prisma.packUpload.createMany({
    data: uploaded.map((u) => ({
      packId,
      fileName: u.name,
      storagePath: u.path,
      mimeType: u.type || (u.isArchive ? "application/zip" : "application/pdf"),
      sizeBytes: u.size,
      isArchive: u.isArchive,
    })),
  });

  const boss = await getBoss();
  await boss.send(PROCESS_PACK_QUEUE, { packId });

  const pack = await prisma.tenderPack.findUnique({ where: { id: packId } });
  if (pack) revalidatePath(`/projects/${pack.projectId}`);
}
