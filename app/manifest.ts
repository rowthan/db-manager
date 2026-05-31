import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'db-manager',
    short_name: 'DB Manager',
    description: 'A fast MongoDB database manager for dashboards, publishing, and mail workflows.',
    start_url: '/db',
    scope: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#159957',
    orientation: 'any',
    categories: ['productivity', 'developer', 'business'],
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: '192x192 512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.svg',
        sizes: '192x192 512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'Open database dashboard',
        url: '/dashboard',
      },
      {
        name: 'Mail workspace',
        short_name: 'Mail',
        description: 'Open mail workspace',
        url: '/mail',
      },
    ],
  }
}
