import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { RequireAuth } from './components/auth/RequireAuth'
import { AuthProvider } from './store/AuthContext'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

// Lazy-load pages for better performance
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

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
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

              {/* Protected */}
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/collections" element={<CollectionsPage />} />
                  <Route path="/payments" element={<PaymentsPage />} />
                  <Route path="/voice" element={<VoicePage />} />
                  <Route path="/calls" element={<CallHistoryPage />} />
                  <Route path="/follow-ups" element={<FollowUpPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>

              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </ErrorBoundary>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
