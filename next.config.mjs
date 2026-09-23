import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the project root so stray lockfiles in parent folders don't confuse Next.js.
  outputFileTracingRoot: root,
};
export default nextConfig;
