// Copy to src/lib/supabase.ts. Needs: npm i @supabase/supabase-js server-only
//
// This app's OWN Supabase project: the only place it may store data (see CLAUDE.md,
// "Data storage"). LuxOS creates the project on approval and sets SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY on the Vercel project.
//
// Server-only: the service-role key bypasses Row Level Security, so this module must
// never reach the browser. `server-only` turns an accidental client import into a
// build error.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Fail loudly: silently falling back to "no storage" loses data.
    throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (LuxOS provisioning sets them on Vercel).");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Usage (server component, route handler or server action):
//   const { data, error } = await db().from("notes").select("*").eq("owner", user.email);
//   if (error) throw error;
