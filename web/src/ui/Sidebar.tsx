import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { usePresentMode } from './AppLayout'

interface NavItem {
  href: string
  label: string
  icon?: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/app/projects', label: 'Projects', icon: '📁' },
  { href: '/app/releases', label: 'Releases', icon: '🚀' },
  { href: '/app/webhooks', label: 'Webhooks', icon: '🔗' },
  { href: '/app/settings', label: 'Settings', icon: '⚙️' },
]

interface SidebarProps {
  className?: string
}

export function Sidebar({ className = '' }: SidebarProps) {
  const location = useLocation()
  const { present } = usePresentMode() || { present: false }
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Handle responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (mobile) {
        setIsCollapsed(true)
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCollapsed && isMobile) {
        setIsCollapsed(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isCollapsed, isMobile])

  const toggleCollapsed = () => {
    setIsCollapsed(!isCollapsed)
  }

  const isActive = (href: string) => {
    if (href === '/app/dashboard') {
      return location.pathname === '/app/dashboard' || location.pathname.startsWith('/app/routes/')
    }
    return location.pathname.startsWith(href)
  }

  const sidebarClasses = [
    'sidebar',
    isCollapsed && 'sidebar--collapsed',
    isMobile && 'sidebar--mobile',
    present && 'sidebar--present',
    className
  ].filter(Boolean).join(' ')

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && !isCollapsed && (
        <div 
          className="sidebar__overlay" 
          onClick={() => setIsCollapsed(true)}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar */}
      <aside className={sidebarClasses} role="navigation" aria-label="Primary navigation">
        {/* Toggle button */}
        <button
          className="sidebar__toggle"
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
        >
          <span className="sidebar__toggle-icon">
            {isCollapsed ? '▶' : '◀'}
          </span>
        </button>

        {/* Navigation items */}
        <nav className="sidebar__nav" aria-label="Main navigation">
          <ul className="sidebar__nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.href} className="sidebar__nav-item">
                <a
                  href={item.href}
                  className={`sidebar__nav-link ${isActive(item.href) ? 'sidebar__nav-link--active' : ''}`}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className="sidebar__nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  <span className="sidebar__nav-label">
                    {item.label}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Collapsed state indicator */}
        {isCollapsed && (
          <div className="sidebar__collapsed-indicator" aria-hidden="true">
            <span className="sidebar__collapsed-text">RouteForge</span>
          </div>
        )}
      </aside>
    </>
  )
}
