import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS, so never import
 * this into a client component. Used for Storage upload / signed URLs.
 */
function serviceClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Upload a file buffer to the private tender-packs bucket. Returns the object path. */
export async function uploadToStorage(
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const supabase = serviceClient();
  const { error } = await supabase.storage
    .from(env.storageBucket)
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

/** Create a short-lived signed URL for reading a stored object. */
export async function createSignedUrl(
  path: string,
  expiresInSeconds = 60 * 10,
): Promise<string> {
  const supabase = serviceClient();
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

/** Download a stored object as a Buffer (used by the extraction worker). */
export async function downloadFromStorage(path: string): Promise<Buffer> {
  const supabase = serviceClient();
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}
