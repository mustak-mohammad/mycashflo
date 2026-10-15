import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'

const NAV_ITEMS = [
  { to: '/dashboard',   icon: '⊞',  label: 'Dashboard' },
  { to: '/customers',   icon: '👥', label: 'Customers' },
  { to: '/invoices',    icon: '🧾', label: 'Invoices' },
  { to: '/payments',    icon: '💳', label: 'Payments' },
  { to: '/collections', icon: '📋', label: 'Collections' },
  { to: '/intelligence',icon: '🧠', label: 'Intelligence' },
  { to: '/voice',       icon: '🤖', label: 'Chotu AI' },
  { to: '/voice-prompts', icon: '🎙️', label: 'Voice Prompts' },
  { to: '/calls',       icon: '📞', label: 'Call History' },
  { to: '/follow-ups',  icon: '✅', label: 'Follow-Ups' },
  { to: '/reports',     icon: '📊', label: 'Reports' },
  { to: '/settings',    icon: '⚙️', label: 'Settings' },
]

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

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
          {NAV_ITEMS.map((item) => (
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
              <div className="font-medium truncate" style={{ color: 'var(--text)' }}>
                {user.name}
              </div>
              <div className="truncate" style={{ color: 'var(--text-muted)' }}>
                {user.email}
              </div>
              <button
                onClick={handleLogout}
                className="mt-2 text-xs underline cursor-pointer bg-transparent border-none p-0"
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
    </div>
  )
}
