import React from 'react'

import { usePresentMode } from '../pages/AppLayout'

export function PresentToggle() {
  const context = usePresentMode()

  if (!context) return null

  const { present, forced, togglePresent } = context
  const classes = ['present-toggle']
  if (present) classes.push('present-toggle--active')
  if (forced) classes.push('present-toggle--forced')

  const ariaLabel = forced
    ? 'Present mode is enabled from the URL parameter'
    : present
      ? 'Turn off present mode'
      : 'Turn on present mode'

  const hint = forced ? 'URL lock active' : present ? 'Recording ready' : 'Great for demos'

  return (
    <div className={classes.join(' ')}>
      <div className="present-toggle__meta">
        <span className="present-toggle__title">Present mode</span>
        <span className="present-toggle__hint">{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={present}
        aria-label={ariaLabel}
        aria-disabled={forced ? 'true' : undefined}
        className="present-toggle__button"
        onClick={() => { if (!forced) togglePresent() }}
        disabled={forced}
      />
    </div>
  )
}
