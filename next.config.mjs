/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf-lib / pdfjs and pg-boss are server-only; keep them external to the RSC bundle.
  serverExternalPackages: ["pg-boss", "pdf-lib"],
  experimental: {
    // Server Actions receive whole tender packs — raise the body limit.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
