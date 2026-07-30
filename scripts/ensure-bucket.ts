import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient } from "@supabase/supabase-js";

/** Idempotently create the private Storage bucket used for tender packs. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "tender-packs";

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
  );
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (existing) {
    console.log(`Bucket "${bucket}" already exists.`);
    return;
  }
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "30MB",
  });
  if (error) throw new Error(`Failed to create bucket: ${error.message}`);
  console.log(`Created private bucket "${bucket}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
