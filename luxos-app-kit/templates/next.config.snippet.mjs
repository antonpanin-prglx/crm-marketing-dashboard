// Merge this into your existing next.config.mjs — don't replace your config.
// Serves the app under the LuxOS gateway path when NEXT_PUBLIC_BASE_PATH is set
// (e.g. "/app/<APP_ID>"), and at root locally when it's empty.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...keep your existing options (headers, images, etc.)...
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
