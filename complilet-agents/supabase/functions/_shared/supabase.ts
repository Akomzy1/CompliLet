/**
 * Supabase client factory for CompliLet Edge Functions.
 *
 * Always uses the service-role key — Edge Functions run in a trusted server
 * environment and never handle user JWT tokens directly (verify_jwt = false on
 * the webhook-handler function).
 *
 * Import from this module rather than constructing a client inline so that:
 *   1. The client is configured consistently across all functions.
 *   2. Auth session persistence is explicitly disabled (not needed in Deno).
 *   3. The URL and key are sourced from environment variables in one place.
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── Environment variables ─────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL) {
  throw new Error("Missing environment variable: SUPABASE_URL");
}
if (!SUPABASE_SERVICE_KEY) {
  throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
}

// ─── Singleton client ──────────────────────────────────────────────────────

/**
 * A pre-built Supabase service-role client.
 *
 * Import and use directly:
 *   import { supabase } from "../_shared/supabase.ts";
 */
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  {
    auth: {
      // No session persistence — server-side Deno environment.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
