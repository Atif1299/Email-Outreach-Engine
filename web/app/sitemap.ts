import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/marketing-seo'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl()
  const now = new Date()

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/platform`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/deliverability`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ]
}
