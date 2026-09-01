import { NextResponse } from "next/server";
import { ensureFullDossier } from "@/server/grouping";

export const dynamic = "force-dynamic";

/**
 * "Open full drawing" (docs/17 §5): builds the complete house-type dossier lazily
 * on first request (caching it), then redirects to a signed URL for the PDF.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const url = await ensureFullDossier(id);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error(`[full-dossier] ${id} failed:`, err instanceof Error ? err.message : err);
    return new NextResponse("Could not build the full drawing.", { status: 500 });
  }
}
