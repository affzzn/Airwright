"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

/** Create a client + project in one step (Week-1 simple flow). */
export async function createProject(formData: FormData) {
  const clientName = String(formData.get("clientName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const mode =
    String(formData.get("mode") ?? "HOUSE_BUILD") === "CONSTRUCTION"
      ? "CONSTRUCTION"
      : "HOUSE_BUILD";

  if (!clientName || !projectName) return;

  // Reuse an existing client of the same name, else create one.
  const client =
    (await prisma.client.findFirst({ where: { name: clientName } })) ??
    (await prisma.client.create({ data: { name: clientName } }));

  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: projectName,
      estimatingMode: mode,
      packs: { create: { version: 1 } }, // start with an empty pack to upload into
    },
  });

  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}
