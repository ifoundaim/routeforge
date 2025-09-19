import { useEffect } from 'react'

type MaybeString = string | null | undefined

export type ShareMeta = {
  title?: MaybeString
  description?: MaybeString
  image?: MaybeString
  url?: MaybeString
}

type AppliedMeta = {
  element: HTMLMetaElement
  previous: string | null
  created: boolean
}

function applyMeta(attr: 'name' | 'property', key: string, value: MaybeString, list: AppliedMeta[]): void {
  const selector = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`
  let element = document.head.querySelector(selector) as HTMLMetaElement | null
  let created = false

  if (!element && value != null) {
    element = document.createElement('meta')
    element.setAttribute(attr, key)
    document.head.appendChild(element)
    created = true
  }

  if (!element) return

  const previous = created ? null : element.getAttribute('content')

  if (value == null) {
    element.removeAttribute('content')
  } else {
    element.setAttribute('content', value)
  }

  list.push({ element, previous, created })
}

export function useShareMeta(meta: ShareMeta): void {
  const { title, description, image, url } = meta

  useEffect(() => {
    const applied: AppliedMeta[] = []
    const previousTitle = document.title

    if (title) {
      document.title = title
    }

    applyMeta('name', 'description', description, applied)
    applyMeta('property', 'og:title', title, applied)
    applyMeta('property', 'og:description', description, applied)
    applyMeta('property', 'og:image', image, applied)
    applyMeta('property', 'og:url', url, applied)

    const card = image ? 'summary_large_image' : null
    applyMeta('name', 'twitter:card', card, applied)
    applyMeta('name', 'twitter:title', title, applied)
    applyMeta('name', 'twitter:description', description, applied)
    applyMeta('name', 'twitter:image', image, applied)

    return () => {
      document.title = previousTitle
      applied.forEach(({ element, previous, created }) => {
        if (created) {
          element.parentElement?.removeChild(element)
        } else if (previous == null) {
          element.removeAttribute('content')
        } else {
          element.setAttribute('content', previous)
        }
      })
    }
  }, [title, description, image, url])
}
