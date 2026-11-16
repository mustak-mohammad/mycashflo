import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { AutomatedRemindersView } from '../components/reminders/AutomatedRemindersView'
import { NotificationHistoryView } from '../components/reminders/NotificationHistoryView'
import { CallHistoryView } from './CallHistoryPage'
import { FollowUpsView } from './FollowUpPage'
import { useAuth } from '../store/AuthContext'

export default function RemindersPage() {
  const { user } = useAuth()
  const isAgent = user?.role === 'AGENT'
  const [searchParams, setSearchParams] = useSearchParams()

  const rawTab = searchParams.get('tab')
  // Agents default to follow-up tasks, Admin/Manager default to automated reminder rules
  const activeTab = (rawTab as 'rules' | 'history' | 'calls' | 'tasks') || (isAgent ? 'tasks' : 'rules')

  const handleTabChange = (tab: 'rules' | 'history' | 'calls' | 'tasks') => {
    setSearchParams({ tab })
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Reminders & Collections"
        subtitle="Automated payment reminders, multi-channel notifications, call logs, and team follow-ups"
      />

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2">
        {!isAgent && (
          <button
            type="button"
            onClick={() => handleTabChange('rules')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2 ${
              activeTab === 'rules'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>⏰ Automated Rules &amp; Preview</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
        )}

        {!isAgent && (
          <button
            type="button"
            onClick={() => handleTabChange('history')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>📨 Sent Notifications</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleTabChange('calls')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'calls'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>📞 Call History &amp; Recordings</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('tasks')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'tasks'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>✅ Follow-Up Action Tasks</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === 'rules' && !isAgent && <AutomatedRemindersView />}
        {activeTab === 'history' && !isAgent && <NotificationHistoryView />}
        {activeTab === 'calls' && <CallHistoryView hideHeader />}
        {activeTab === 'tasks' && <FollowUpsView hideHeader />}
      </div>
    </div>
  )
}
