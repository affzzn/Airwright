"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";

/** Mirror the Supabase auth user into our User table on first sign-in. */
async function ensureUser(id: string, email: string) {
  try {
    await prisma.user.upsert({
      where: { id },
      create: { id, email },
      update: { email },
    });
  } catch (err) {
    console.error("[auth] user upsert failed:", err);
  }
}

/** Sign in with email + password (no email round-trip once confirmed). */
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  if (data.user?.email) await ensureUser(data.user.id, data.user.email);
  redirect("/");
}

/**
 * Create an account. If email confirmation is ON in Supabase, the user gets a
 * "Confirm sign up" email and must confirm before signing in. If it's OFF, they
 * are signed in immediately.
 */
export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return;

  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });
  if (error) {
    redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);
  }

  if (data.session && data.user?.email) {
    // Confirmation is OFF — signed in straight away.
    await ensureUser(data.user.id, data.user.email);
    redirect("/");
  }

  // Confirmation is ON — tell them to confirm, then sign in.
  redirect("/login?checkEmail=1");
}

/** Sign out and return to the login screen. */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
