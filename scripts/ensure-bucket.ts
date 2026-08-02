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
  // Supabase free tier caps per-file uploads at 50MB globally; a bucket limit
// cannot exceed the project limit. Raise the project limit (or use resumable
// uploads) if you need larger ZIP packs.
const FILE_SIZE_LIMIT = "50MB";
  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (existing) {
    const { error } = await supabase.storage.updateBucket(bucket, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
    });
    if (error) throw new Error(`Failed to update bucket: ${error.message}`);
    console.log(`Bucket "${bucket}" exists — raised size limit to ${FILE_SIZE_LIMIT}.`);
    return;
  }
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
  });
  if (error) throw new Error(`Failed to create bucket: ${error.message}`);
  console.log(`Created private bucket "${bucket}" (limit ${FILE_SIZE_LIMIT}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
