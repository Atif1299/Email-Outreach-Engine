import gsap from 'gsap'

let scrollTriggerRegistered = false

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(min-width: 768px)').matches
}

export async function registerScrollTrigger(): Promise<typeof import('gsap/ScrollTrigger').ScrollTrigger | null> {
  if (prefersReducedMotion()) return null
  if (scrollTriggerRegistered) {
    const { ScrollTrigger } = await import('gsap/ScrollTrigger')
    return ScrollTrigger
  }
  const { ScrollTrigger } = await import('gsap/ScrollTrigger')
  gsap.registerPlugin(ScrollTrigger)
  scrollTriggerRegistered = true
  return ScrollTrigger
}
