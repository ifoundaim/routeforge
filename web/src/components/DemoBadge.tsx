import React from 'react'

export function DemoBadge({ className }: { className?: string }) {
  const classes = ['demo-badge', className].filter(Boolean).join(' ')
  return (
    <span className={classes || undefined} aria-label="Demo mode">
      <span className="demo-badge__dot" aria-hidden="true" />
      Demo
    </span>
  )
}
