import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This allows you to test the app on your phone or other devices on your local network
  allowedDevOrigins: ['192.168.100.13'],
};

export default nextConfig;