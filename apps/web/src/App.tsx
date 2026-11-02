import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { SuperAdminLayout } from './components/layout/SuperAdminLayout'
import { RequireAuth } from './components/auth/RequireAuth'
import { RequireRole } from './components/auth/RequireRole'
import { AuthProvider, useAuth } from './store/AuthContext'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

// Lazy-load tenant pages
const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'))
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const VoicePage = lazy(() => import('./pages/VoicePage'))
const CallHistoryPage = lazy(() => import('./pages/CallHistoryPage'))
const FollowUpPage = lazy(() => import('./pages/FollowUpPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'))
const VoicePromptsPage = lazy(() => import('./pages/VoicePromptsPage'))
const RemindersPage = lazy(() => import('./pages/RemindersPage'))

// Lazy-load dedicated Super Admin platform pages
const PlatformOverviewPage = lazy(() => import('./pages/platform/PlatformOverviewPage'))
const TenantManagementPage = lazy(() => import('./pages/platform/TenantManagementPage'))
const UserManagementPage = lazy(() => import('./pages/platform/UserManagementPage'))
const PlatformAnalyticsPage = lazy(() => import('./pages/platform/PlatformAnalyticsPage'))
const SystemSettingsPage = lazy(() => import('./pages/platform/SystemSettingsPage'))
const PlatformAuditLogsPage = lazy(() => import('./pages/platform/PlatformAuditLogsPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RootRedirect() {
  const { user } = useAuth()
  if (user?.role === 'SUPER_ADMIN') {
    return <Navigate to="/platform/overview" replace />
  }
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <ErrorBoundary>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected Routes */}
              <Route element={<RequireAuth />}>
                {/* Dedicated Platform Governance Layout for Super Admins */}
                <Route
                  path="/platform"
                  element={
                    <RequireRole allowedRoles={['SUPER_ADMIN']}>
                      <SuperAdminLayout />
                    </RequireRole>
                  }
                >
                  <Route index element={<Navigate to="/platform/overview" replace />} />
                  <Route path="overview" element={<PlatformOverviewPage />} />
                  <Route path="tenants" element={<TenantManagementPage />} />
                  <Route path="users" element={<UserManagementPage />} />
                  <Route path="analytics" element={<PlatformAnalyticsPage />} />
                  <Route path="settings" element={<SystemSettingsPage />} />
                  <Route path="audit-logs" element={<PlatformAuditLogsPage />} />
                  <Route path="*" element={<Navigate to="/platform/overview" replace />} />
                </Route>

                {/* Tenant Application Layout for Admin, Manager, and Agent */}
                <Route element={<AppLayout />}>
                  <Route index element={<RootRedirect />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/collections" element={<CollectionsPage />} />
                  <Route path="/payments" element={<PaymentsPage />} />
                  <Route
                    path="/intelligence"
                    element={
                      <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                        <IntelligencePage />
                      </RequireRole>
                    }
                  />
                  <Route path="/voice" element={<VoicePage />} />
                  <Route
                    path="/voice-prompts"
                    element={
                      <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                        <VoicePromptsPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/reminders"
                    element={
                      <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                        <RemindersPage />
                      </RequireRole>
                    }
                  />
                  <Route path="/calls" element={<CallHistoryPage />} />
                  <Route path="/follow-ups" element={<FollowUpPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route
                    path="/settings"
                    element={
                      <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                        <SettingsPage />
                      </RequireRole>
                    }
                  />
                </Route>
              </Route>

              {/* Catch-all */}
              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </ErrorBoundary>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
