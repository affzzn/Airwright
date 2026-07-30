"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";

/**
 * Step 1: email a 6-digit OTP code. We use a typed code rather than a clickable
 * magic link because email scanners / browser prefetch consume single-use links
 * before the user clicks, producing the "otp_expired" error.
 */
export async function sendOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/login?step=code&email=${encodeURIComponent(email)}`);
}

/** Step 2: verify the typed code, set the session, mirror the User row. */
export async function verifyOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!email || !token) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    redirect(
      `/login?step=code&email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  const user = data.user;
  if (user?.email) {
    try {
      await prisma.user.upsert({
        where: { id: user.id },
        create: { id: user.id, email: user.email },
        update: { email: user.email },
      });
    } catch (err) {
      console.error("[auth] user upsert failed:", err);
    }
  }

  redirect("/");
}

/** Sign out and return to the login screen. */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
