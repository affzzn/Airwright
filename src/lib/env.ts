/**
 * Small, lazy env accessor. We don't hard-validate at import time so the app
 * and `next build` still work before Supabase/Anthropic are configured; each
 * getter throws only when the feature that needs it is actually used.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get storageBucket() {
    return process.env.SUPABASE_STORAGE_BUCKET ?? "tender-packs";
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get extractionModel() {
    return process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-opus-4-8";
  },
  /** Model for the AI grouping structure pass (docs/17 §4) — text-only, so a
   *  smaller/faster model is fine. Defaults to the extraction model (guaranteed
   *  available); override with a cheaper model to cut cost. */
  get groupingModel() {
    return process.env.ANTHROPIC_GROUPING_MODEL ?? this.extractionModel;
  },
  /** AI-first grouping (docs/17). Set INGEST_GROUPING_AI=false to force the
   *  deterministic profile path (offline / cost-free). */
  get groupingAI() {
    return process.env.INGEST_GROUPING_AI !== "false";
  },
  get directUrl() {
    return required("DIRECT_URL");
  },
  /** True when Supabase auth/storage is configured — used to no-op gracefully locally. */
  get supabaseConfigured() {
    return Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
};
