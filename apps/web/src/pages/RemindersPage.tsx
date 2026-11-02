import { PageHeader } from '../components/ui/PageHeader'
import { AutomatedRemindersView } from '../components/reminders/AutomatedRemindersView'

export default function RemindersPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Chotu Automated Reminders"
        subtitle="Configure, preview, and monitor scheduled overdue-payment communications"
      />
      <AutomatedRemindersView />
    </div>
  )
}
