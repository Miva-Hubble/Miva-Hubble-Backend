import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "⚠️ Supabase URL or ANON key not set — supabase client will be unusable in runtime tests",
  );
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️ Supabase URL or SERVICE ROLE key not set — supabaseAdmin will be unusable (storage uploads/downloads will fail)",
  );
}

// Helper to prevent synchronous crash on import if URL/keys are missing.
// It returns a Proxy that throws a helpful error when any property is accessed.
const createSafeClient = (url: string, key: string, options?: any) => {
  if (!url || !key) {
    return new Proxy({} as any, {
      get(target, prop) {
        throw new Error(
          `Supabase client accessed but not initialized. Please ensure SUPABASE_URL and the correct API key are configured in your .env file.`
        );
      }
    });
  }
  return createClient(url, key, options);
};

export const supabase = createSafeClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const supabaseAdmin = createSafeClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default supabase;
