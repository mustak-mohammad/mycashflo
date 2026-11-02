import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { FloatingChatWidget } from '../chat/FloatingChatWidget'
import { getDisplayName } from '../../utils/user'

const NAV_ITEMS: Array<{
  to: string
  icon: string
  label: string
  roles?: Array<'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT'>
}> = [
  { to: '/dashboard',   icon: '⊞',  label: 'Dashboard' },
  { to: '/customers',   icon: '👥', label: 'Customers' },
  { to: '/invoices',    icon: '🧾', label: 'Invoices' },
  { to: '/payments',    icon: '💳', label: 'Payments' },
  { to: '/collections', icon: '📋', label: 'Collections' },
  { to: '/intelligence',icon: '🧠', label: 'Intelligence', roles: ['ADMIN', 'MANAGER'] },
  { to: '/voice',       icon: '🤖', label: 'Chotu AI' },
  { to: '/reminders',   icon: '⏰', label: 'Reminders',    roles: ['ADMIN', 'MANAGER'] },
  { to: '/voice-prompts', icon: '🎙️', label: 'Voice Prompts', roles: ['ADMIN', 'MANAGER'] },
  { to: '/calls',       icon: '📞', label: 'Call History' },
  { to: '/follow-ups',  icon: '✅', label: 'Follow-Ups' },
  { to: '/reports',     icon: '📊', label: 'Reports' },
  { to: '/settings',    icon: '⚙️', label: 'Settings',     roles: ['ADMIN', 'MANAGER'] },
]

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const currentRole = user?.role || 'AGENT'
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true
    if (currentRole === 'SUPER_ADMIN') return true
    return item.roles.includes(currentRole as any)
  })

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col transition-all duration-300 shrink-0"
        style={{
          width: collapsed ? '64px' : '240px',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-4 py-5 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div
            className="flex items-center justify-center rounded-lg text-white font-bold shrink-0"
            style={{ width: 36, height: 36, background: 'var(--primary)', fontSize: 14 }}
          >
            MC
          </div>
          {!collapsed && (
            <div>
              <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                myCashflo
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Collections Platform
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm transition-all duration-150 no-underline ${
                  isActive
                    ? 'text-white font-medium'
                    : 'hover:opacity-80'
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
              })}
            >
              <span className="text-base shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle + User */}
        <div
          className="shrink-0 px-2 pb-3 space-y-1"
          style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}
        >
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all duration-150 hover:opacity-80 cursor-pointer"
            style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none' }}
          >
            <span className="text-base shrink-0">{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse</span>}
          </button>

          {!collapsed && user && (
            <div
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="font-medium truncate" style={{ color: 'var(--text)' }}>
                  {getDisplayName(user)}
                </div>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0"
                  style={
                    user.role === 'SUPER_ADMIN'
                      ? { background: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', border: '1px solid rgba(14, 165, 233, 0.35)' }
                      : user.role === 'ADMIN'
                      ? { background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
                      : user.role === 'MANAGER'
                      ? { background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }
                      : { background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }
                  }
                >
                  {user.role}
                </span>
              </div>
              <div className="truncate" style={{ color: 'var(--text-muted)' }}>
                {user.email}
              </div>
              {user.role === 'SUPER_ADMIN' && (
                <button
                  onClick={() => navigate('/platform/overview')}
                  className="mt-2 text-xs font-semibold cursor-pointer rounded px-2.5 py-1.5 w-full text-left transition-colors flex items-center justify-between"
                  style={{
                    background: 'rgba(14, 165, 233, 0.12)',
                    color: '#38bdf8',
                    border: '1px solid rgba(14, 165, 233, 0.3)',
                  }}
                >
                  <span>🛡️ Platform Console</span>
                  <span>→</span>
                </button>
              )}
              <button
                onClick={handleLogout}
                className="mt-2 text-xs underline cursor-pointer bg-transparent border-none p-0 block"
                style={{ color: 'var(--danger)' }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Application-Wide Chotu AI Floating Chatbot */}
      <FloatingChatWidget />
    </div>
  )
}
