import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient } from "@supabase/supabase-js";

/** Idempotently create the private Storage bucket used for tender packs. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "tender-packs";

// Desired per-file upload limit for the bucket. Tender packs are uploaded as
// ZIPs and can be large (150MB+), so default well above the 50MB free-tier cap.
// NOTE: a bucket's limit CANNOT exceed the PROJECT-WIDE global upload limit
// (Dashboard → Storage → Settings → "Upload file size limit"). Raise that first
// on Pro, otherwise this value is silently clamped / rejected.
const DESIRED_LIMIT = process.env.SUPABASE_BUCKET_FILE_SIZE_LIMIT ?? "250MB";

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
  );
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const EXCEEDS_GLOBAL = /exceeded the maximum allowed size|maximum allowed/i;

function warnGlobalLimit() {
  console.warn(
    [
      "",
      `⚠  Could not set the bucket limit to ${DESIRED_LIMIT}.`,
      "   The PROJECT-WIDE upload limit is lower, and a bucket cannot exceed it.",
      "   Fix: Supabase Dashboard → Storage → Settings → 'Upload file size limit'",
      "        → raise it (Pro allows well over 250MB), then re-run:",
      "        npm run setup:bucket",
      "",
    ].join("\n"),
  );
}

async function main() {
  const { data: existing } = await supabase.storage.getBucket(bucket);

  if (existing) {
    const { error } = await supabase.storage.updateBucket(bucket, {
      public: false,
      fileSizeLimit: DESIRED_LIMIT,
    });
    if (error) {
      if (EXCEEDS_GLOBAL.test(error.message)) {
        warnGlobalLimit();
        const mb = (existing.file_size_limit ?? 0) / 1_048_576;
        console.log(`Bucket "${bucket}" unchanged — limit stays ${mb.toFixed(0)}MB.`);
        return;
      }
      throw new Error(`Failed to update bucket: ${error.message}`);
    }
    console.log(`Bucket "${bucket}" exists — limit set to ${DESIRED_LIMIT}.`);
    return;
  }

  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: DESIRED_LIMIT,
  });
  if (error) {
    if (EXCEEDS_GLOBAL.test(error.message)) {
      // Create the bucket at the default limit so the app still works, then warn.
      const fallback = await supabase.storage.createBucket(bucket, {
        public: false,
      });
      if (fallback.error && !/already exists/i.test(fallback.error.message)) {
        throw new Error(`Failed to create bucket: ${fallback.error.message}`);
      }
      warnGlobalLimit();
      console.log(`Created private bucket "${bucket}" at the project default limit.`);
      return;
    }
    throw new Error(`Failed to create bucket: ${error.message}`);
  }
  console.log(`Created private bucket "${bucket}" (limit ${DESIRED_LIMIT}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
