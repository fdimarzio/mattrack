import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://storage.googleapis.com",
              "worker-src 'self' blob:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdn.jsdelivr.net https://storage.googleapis.com http://localhost:7432",
              "img-src 'self' data: blob:",
              "media-src 'self' blob: http://localhost:7432",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
