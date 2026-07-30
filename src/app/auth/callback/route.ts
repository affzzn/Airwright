import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";

/** Exchanges the magic-link code for a session, then ensures a User row exists. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    const user = data.user;
    if (user?.email) {
      // Mirror the Supabase auth user into our User table on first login.
      // Never let a DB hiccup break sign-in — log and continue.
      try {
        await prisma.user.upsert({
          where: { id: user.id },
          create: { id: user.id, email: user.email },
          update: { email: user.email },
        });
      } catch (err) {
        console.error("[auth/callback] user upsert failed:", err);
      }
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
