/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      'ws',
      'bufferutil',
      'utf-8-validate',
      '@neondatabase/serverless',
      '@prisma/adapter-neon',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = config.externals ?? []
      config.externals = [
        ...(Array.isArray(externals) ? externals : [externals]),
        'ws',
        'bufferutil',
        'utf-8-validate',
      ]
    }
    return config
  },
}

export default nextConfig
