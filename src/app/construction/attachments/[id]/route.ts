import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSignedUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

/**
 * View a construction attachment: redirect to a short-lived signed URL for the
 * stored file (email / drawing / photo). Read-only — the file is never parsed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const att = await prisma.constructionAttachment.findUnique({ where: { id } });
  if (!att) return new NextResponse("Not found", { status: 404 });
  try {
    const url = await createSignedUrl(att.storagePath, 60 * 60);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error(`[construction-attachment] ${id} failed:`, err instanceof Error ? err.message : err);
    return new NextResponse("Could not open the file.", { status: 500 });
  }
}
