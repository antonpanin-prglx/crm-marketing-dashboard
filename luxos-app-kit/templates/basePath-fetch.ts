// basePath-aware client fetch helper.
//
// Why: when the app is mounted under the LuxOS gateway it runs at /app/<APP_ID>.
// next/link & the router prepend that automatically, but raw fetch() does NOT —
// so `fetch('/api/x')` from the browser hits the gateway origin root and 404s.
// Prefix every client-side absolute path with this. Empty when running standalone.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative URL with the basePath. e.g. apiUrl("/api/admin/x"). */
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

// Usage:
//   import { apiUrl } from "@/lib/basePath-fetch";
//   const res = await fetch(apiUrl("/api/admin/users"), { ... });
//   const es  = new EventSource(apiUrl("/api/stream"));
