'use client'

import { useEffect, useState } from 'react'
import HeroPipelineMotion from '@/components/marketing/animations/HeroPipelineMotion'

const STEP_IDS = ['connect', 'import', 'leads', 'campaign', 'preview', 'queue', 'replies']

export default function PlatformPipelineNav() {
  const [activeId, setActiveId] = useState(STEP_IDS[0])

  useEffect(() => {
    const sections = STEP_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (!sections.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-40% 0px -45% 0px', threshold: [0, 0.25, 0.5] }
    )

    sections.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return <HeroPipelineMotion variant="nav" activeId={activeId} />
}
