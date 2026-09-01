"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createSignedUploadUrl } from "@/lib/supabase/storage";
import { getBoss } from "@/lib/queue/boss";
import { PROCESS_PACK_QUEUE } from "@/lib/queue/jobs";
import { isUploadableName, isArchiveName } from "@/lib/upload/plan";

export interface UploadTarget {
  index: number; // position in the input list (client zips back by index, not name)
  path: string;
  token: string;
  signedUrl: string;
  name: string;
  relativePath: string;
  type: string;
  size: number;
  isArchive: boolean;
}

export interface PrepareResult {
  targets: UploadTarget[]; // files that still need uploading
  alreadyDone: number; // files already uploaded in a previous (interrupted) session
}

/**
 * Step 1: prepare an upload. Mints a signed upload URL per file that still needs
 * uploading, and SKIPS files already registered for this pack by relative path —
 * so re-dropping the same folder after an interruption RESUMES (finished files
 * are skipped) rather than re-uploading everything (docs/17 §11).
 *
 * Accepts a `relativePath` per file so a whole FOLDER can be uploaded and its
 * structure preserved for cross-file grouping.
 */
export async function createSignedUploads(
  packId: string,
  files: { name: string; type: string; size: number; relativePath?: string }[],
): Promise<PrepareResult> {
  // What's already uploaded (registered) for this pack — the resume set.
  const existing = await prisma.packUpload.findMany({
    where: { packId },
    select: { relativePath: true, fileName: true },
  });
  const done = new Set(existing.map((u) => u.relativePath ?? u.fileName));

  const targets: UploadTarget[] = [];
  let alreadyDone = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isUploadableName(f.name)) continue; // PDFs and ZIPs only

    const relativePath = f.relativePath || f.name;
    if (done.has(relativePath)) {
      alreadyDone++;
      continue; // uploaded in a prior session → resume: skip
    }

    // A unique storage key (names collide across folders); the human-readable
    // relative path is kept separately on the PackUpload for grouping.
    const path = `${packId}/raw/${randomUUID()}-${f.name}`;
    const { token, signedUrl } = await createSignedUploadUrl(path);
    targets.push({
      index: i,
      path,
      token,
      signedUrl,
      name: f.name,
      relativePath,
      type: f.type,
      size: f.size,
      isArchive: isArchiveName(f.name),
    });
  }
  return { targets, alreadyDone };
}

/**
 * Step 2 (incremental): register a batch of files the moment they finish
 * uploading — NOT all at the end — so an interrupted session still records the
 * files it managed to upload (durability + resume). Idempotent: skips relative
 * paths already registered for this pack.
 */
export async function registerUploads(
  packId: string,
  uploaded: {
    path: string;
    name: string;
    relativePath?: string;
    type: string;
    size: number;
    isArchive: boolean;
  }[],
): Promise<void> {
  if (uploaded.length === 0) return;

  const existing = await prisma.packUpload.findMany({
    where: { packId },
    select: { relativePath: true, fileName: true },
  });
  const done = new Set(existing.map((u) => u.relativePath ?? u.fileName));

  const fresh = uploaded.filter((u) => !done.has(u.relativePath || u.name));
  if (fresh.length === 0) return;

  await prisma.packUpload.createMany({
    data: fresh.map((u) => ({
      packId,
      fileName: u.name,
      relativePath: u.relativePath || u.name,
      storagePath: u.path,
      mimeType: u.type || (u.isArchive ? "application/zip" : "application/pdf"),
      sizeBytes: u.size,
      isArchive: u.isArchive,
    })),
  });
}

/**
 * Step 3: kick off processing once all files are uploaded + registered. Enqueues
 * the process-pack job (unzip → classify → group → assemble → extract). Safe to
 * call more than once — ingestion is idempotent and grouping is guarded.
 */
export async function startProcessing(packId: string): Promise<void> {
  const pending = await prisma.packUpload.count({
    where: { packId, status: "PENDING" },
  });
  if (pending === 0) return; // nothing new to process

  const boss = await getBoss();
  await boss.send(PROCESS_PACK_QUEUE, { packId });

  const pack = await prisma.tenderPack.findUnique({ where: { id: packId } });
  if (pack) revalidatePath(`/projects/${pack.projectId}`);
}
