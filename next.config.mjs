/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true }, // 若用了 <Image/>
  eslint: {
    ignoreDuringBuilds: true,
  },
};
export default nextConfig;
