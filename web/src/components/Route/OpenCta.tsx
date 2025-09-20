import React from 'react'

type OpenCtaProps = {
  slug?: string | null
  utmSource?: string
}

export function OpenCta({ slug, utmSource = 'twitter' }: OpenCtaProps) {
  if (!slug) return null
  const base = (() => {
    try {
      return `${window.location.origin}/r/${slug}`
    } catch {
      return `/r/${slug}`
    }
  })()
  const href = `${base}?utm_source=${encodeURIComponent(utmSource)}`
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <button type="button">Open route</button>
    </a>
  )
}


