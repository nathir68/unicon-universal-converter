import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only use standalone for local Electron packaging; Vercel handles serverless output natively
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  serverExternalPackages: ['sharp', 'pdf-parse', 'pdf-lib', 'mammoth', 'fluent-ffmpeg', 'ffmpeg-static', 'pdf2json', 'docx'],
};

export default nextConfig;
