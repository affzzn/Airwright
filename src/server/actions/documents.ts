"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";

/**
 * Manual override for whether a file is used. Excluding hides its outputs;
 * including a file that was set aside (e.g. the classifier mislabelled a
 * drawing) force-extracts the whole file as one house type.
 */
export async function setDocumentIncluded(
  documentId: string,
  included: boolean,
) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      pack: { include: { project: true } },
      extractions: { select: { id: true } },
    },
  });
  if (!doc) return;

  await prisma.document.update({
    where: { id: documentId },
    data: { included },
  });

  // Including a never-processed file → force-use it: treat the whole file as one
  // house type (fallback, all pages) so the user's override actually does work.
  if (included && doc.extractions.length === 0 && doc.pageCount) {
    const project = doc.pack.project;
    const pageRange = `1-${doc.pageCount}`;
    const houseType = await prisma.houseType.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        name: doc.fileName.replace(/\.pdf$/i, ""),
      },
    });
    const extraction = await prisma.extraction.create({
      data: {
        documentId: doc.id,
        houseTypeId: houseType.id,
        pageRange,
        model: env.extractionModel,
        promptVersion: "pending",
        status: "PENDING",
      },
    });
    const boss = await getBoss();
    await boss.send(EXTRACT_DRAWING_QUEUE, {
      documentId: doc.id,
      extractionId: extraction.id,
      pageRange,
    });
  }

  revalidatePath(`/projects/${doc.pack.projectId}`);
}
