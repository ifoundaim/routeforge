import React from 'react'
import { createRoot } from 'react-dom/client'

import { Landing } from './pages/Landing'
import { PublicProject } from './pages/PublicProject'
import { PublicRelease } from './pages/PublicRelease'
import { App } from './ui/App'
import './styles.css'

const path = window.location.pathname
const isAppRoute = path === '/app' || path.startsWith('/app/')
const isReleaseRoute = path.startsWith('/rel/')
const isProjectRoute = path.startsWith('/p/')
const isLandingRoute = !isAppRoute && !isReleaseRoute && !isProjectRoute

if (isLandingRoute) {
  document.body.classList.add('landing-page')
} else {
  document.body.classList.remove('landing-page')
}

let view: React.ReactNode
if (isAppRoute) {
  view = <App />
} else if (isReleaseRoute) {
  view = <PublicRelease />
} else if (isProjectRoute) {
  view = <PublicProject />
} else {
  view = <Landing />
}

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    {view}
  </React.StrictMode>
)
