import React from 'react'
import { createRoot } from 'react-dom/client'

import { Landing } from './pages/Landing'
import { App } from './ui/App'
import './styles.css'

const path = window.location.pathname
const isAppRoute = path === '/app' || path.startsWith('/app/')

if (!isAppRoute) {
  document.body.classList.add('landing-page')
}

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    {isAppRoute ? <App /> : <Landing />}
  </React.StrictMode>
)
