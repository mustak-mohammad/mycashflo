import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { getDisplayName } from '../../utils/user'

const PLATFORM_NAV_ITEMS = [
  { to: '/platform/overview',   icon: '🌐', label: 'Platform Overview' },
  { to: '/platform/tenants',    icon: '🏢', label: 'Tenant Management' },
  { to: '/platform/users',      icon: '👥', label: 'User Management' },
  { to: '/platform/analytics',  icon: '📈', label: 'Platform Analytics' },
  { to: '/platform/settings',   icon: '⚙️', label: 'Settings' },
  { to: '/platform/audit-logs', icon: '📜', label: 'Audit Logs' },
]

export function SuperAdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  const currentNav = PLATFORM_NAV_ITEMS.find((item) =>
    location.pathname.startsWith(item.to),
  )

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Super Admin Dedicated Sidebar */}
      <aside
        className="flex flex-col transition-all duration-300 shrink-0"
        style={{
          width: collapsed ? '68px' : '256px',
          background: '#0b1120',
          borderRight: '1px solid #1e293b',
        }}
      >
        {/* Platform Brand Header */}
        <div
          className="flex items-center gap-3 px-4 py-5 shrink-0"
          style={{ borderBottom: '1px solid #1e293b' }}
        >
          <div
            className="flex items-center justify-center rounded-xl text-white font-black shrink-0 shadow-md"
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
              boxShadow: '0 0 12px rgba(14, 165, 233, 0.25)',
              fontSize: 16,
            }}
          >
            🛡️
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="font-bold text-sm tracking-wide text-white truncate flex items-center gap-1.5">
                <span>myCashflo</span>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-800/80 text-sky-400">
                  Platform
                </span>
              </div>
              <div className="text-[11px] font-medium text-slate-400 truncate">
                Super Admin Console
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {PLATFORM_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 no-underline font-medium ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`
              }
              style={({ isActive }) => ({
                background: isActive
                  ? 'linear-gradient(90deg, rgba(14, 165, 233, 0.16) 0%, rgba(2, 132, 199, 0.06) 100%)'
                  : 'transparent',
                borderLeft: isActive ? '3px solid #0ea5e9' : '3px solid transparent',
              })}
            >
              <span className="text-base shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Super Admin Account Identity & Controls */}
        <div
          className="shrink-0 px-2 pb-3 space-y-2"
          style={{ borderTop: '1px solid #1e293b', paddingTop: '0.75rem' }}
        >
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs transition-colors hover:bg-slate-800/60 text-slate-400 cursor-pointer border-none bg-transparent"
          >
            <span className="text-sm shrink-0">{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse Sidebar</span>}
          </button>

          {!collapsed && user && (
            <div
              className="rounded-xl p-3 text-xs border"
              style={{
                background: '#111827',
                borderColor: 'rgba(56, 189, 248, 0.2)',
              }}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="font-semibold truncate text-slate-100 text-[13px]">
                  {getDisplayName(user)}
                </div>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0"
                  style={{
                    background: 'rgba(14, 165, 233, 0.16)',
                    color: '#38bdf8',
                    border: '1px solid rgba(14, 165, 233, 0.3)',
                  }}
                >
                  SUPER ADMIN
                </span>
              </div>
              <div className="truncate text-slate-400 text-[11px] mb-2.5">
                {user.email}
              </div>
              <button
                onClick={handleLogout}
                className="w-full py-1.5 px-2 text-center text-xs font-medium rounded text-slate-300 bg-slate-800/80 border border-slate-700 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-900 transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </div>
          )}

          {collapsed && (
            <button
              onClick={handleLogout}
              title="Sign out of Platform"
              className="flex items-center justify-center w-full py-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 cursor-pointer border-none bg-transparent"
            >
              🚪
            </button>
          )}
        </div>
      </aside>

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Dedicated Super Admin Top Header Bar */}
        <header
          className="h-16 px-6 shrink-0 flex items-center justify-between border-b"
          style={{
            background: '#0b1120',
            borderColor: '#1e293b',
          }}
        >
          {/* Breadcrumb / Active View */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 bg-sky-950/60 px-2.5 py-0.5 rounded border border-sky-800/60">
              Platform Governance
            </span>
            <span className="text-slate-600">/</span>
            <h2 className="text-sm font-semibold text-slate-200">
              {currentNav?.label || 'Platform Management'}
            </h2>
          </div>

          {/* Engine Status & Super Admin Identity Header Pill */}
          <div className="flex items-center gap-4">
            {/* System Status Indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/40 border border-emerald-800/60 text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Platform Core: Operational</span>
            </div>

            {/* User identity & sign out */}
            <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-200">
                  {getDisplayName(user)}
                </div>
                <div className="text-[10px] text-sky-400/90 font-mono uppercase tracking-wide">
                  Super Admin
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:text-white transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Content Outlet */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
