import { useState, useCallback, useRef } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useApi } from '../hooks/useApi'
import { followUpsApi } from '../api/followUps'
import { useToast } from '../store/ToastContext'
import { extractSafeErrorMessage } from '../utils/safeError'
import type { FollowUpTask } from '../types'

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: 'var(--danger)',
  HIGH: 'var(--danger)',
  MEDIUM: 'var(--warning)',
  LOW: 'var(--accent)',
}

export default function FollowUpPage() {
  const toast = useToast()
  const [filterDone, setFilterDone] = useState<boolean | undefined>(undefined)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState(() => new Date().toISOString().split('T')[0])
  const [newPriority, setNewPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<FollowUpTask | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteInFlightRef = useRef(false)

  const fetcher = useCallback(
    () => followUpsApi.list({ done: filterDone }),
    [filterDone],
  )
  const { data, loading, error, refetch } = useApi(fetcher)

  const tasks = data?.data ?? []
  const pendingCount = data?.summary?.pendingCount ?? 0
  const completedCount = data?.summary?.completedCount ?? 0

  async function handleToggleDone(task: FollowUpTask) {
    setActionError(null)
    try {
      await followUpsApi.update(task.id, { done: !task.done })
      toast.success(
        !task.done
          ? `Marked "${task.title}" as completed.`
          : `Reopened "${task.title}" as pending.`,
      )
      refetch()
    } catch (err) {
      const msg = extractSafeErrorMessage(err, 'Failed to update follow-up task status.')
      setActionError(msg)
      toast.error(msg)
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await followUpsApi.create({
        title: newTitle.trim(),
        dueDate: new Date(newDue).toISOString(),
        priority: newPriority,
      })
      toast.success(`Follow-up task "${newTitle.trim()}" created.`)
      setNewTitle('')
      setIsModalOpen(false)
      refetch()
    } catch (err) {
      const msg = extractSafeErrorMessage(err, 'Failed to create follow-up task.')
      setFormError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || deleteInFlightRef.current) return
    deleteInFlightRef.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      await followUpsApi.delete(deleteTarget.id)
      toast.success(`Deleted follow-up task "${deleteTarget.title}".`)
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      const msg = extractSafeErrorMessage(err, 'Failed to delete follow-up task.')
      setDeleteError(msg)
      toast.error(msg)
    } finally {
      setDeleting(false)
      deleteInFlightRef.current = false
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Follow-Up Tasks"
        subtitle="Scheduled tasks and reminders for your collection team"
        action={
          <button
            type="button"
            onClick={() => {
              setFormError(null)
              setIsModalOpen(true)
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
            style={{ background: 'var(--primary)', border: 'none' }}
          >
            + Add Task
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard
          label="Pending Follow-Ups"
          value={loading ? '…' : pendingCount}
          subtext="Requires agent action"
          icon="⏳"
          color="var(--warning)"
        />
        <StatCard
          label="Completed"
          value={loading ? '…' : completedCount}
          subtext="Actioned tasks"
          icon="✅"
          color="var(--accent)"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { label: 'All Tasks', value: undefined },
          { label: 'Pending', value: false },
          { label: 'Completed', value: true },
        ].map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setFilterDone(tab.value)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
            style={{
              background: filterDone === tab.value ? 'var(--primary)' : 'var(--surface)',
              color: filterDone === tab.value ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(error || actionError) && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm mb-4 flex items-center justify-between gap-3"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
          }}
        >
          <span>⚠️ {actionError || error}</span>
          {actionError && (
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="text-xs underline cursor-pointer bg-transparent border-none text-current"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Task list */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse h-20"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            />
          ))
        ) : tasks.length === 0 ? (
          <div
            className="rounded-xl p-8 text-center text-sm"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            🎉 No tasks in this view. Click "+ Add Task" to schedule one.
          </div>
        ) : (
          tasks.map((t) => {
            const customerName = t.collectionCase?.customer?.name ?? 'General Account'
            return (
              <div
                key={t.id}
                className="rounded-xl p-4 flex items-start gap-4 transition-all"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  opacity: t.done ? 0.65 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleToggleDone(t)}
                  aria-label={t.done ? 'Mark pending' : 'Mark done'}
                  className="w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-xs cursor-pointer"
                  style={{
                    background: t.done ? 'var(--accent)' : 'var(--surface-2)',
                    border: `2px solid ${t.done ? 'var(--accent)' : 'var(--border)'}`,
                    color: '#fff',
                  }}
                >
                  {t.done && '✓'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm text-white font-medium ${t.done ? 'line-through' : ''}`}>
                    {t.title}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {customerName}
                    {t.assignedAgent && ` · Assigned to ${t.assignedAgent.name}`}
                  </div>
                  {t.description && (
                    <div className="text-xs mt-1 text-slate-400">{t.description}</div>
                  )}
                </div>
                <div className="flex items-start gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: PRIORITY_COLOR[t.priority] ?? 'var(--text-muted)' }}
                    >
                      {t.priority}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Due{' '}
                      {new Date(t.dueDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete task ${t.title}`}
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteTarget(t)
                    }}
                    className="px-2 py-1 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/30 hover:bg-rose-900/50 border border-rose-800/50 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-followup-title"
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <h3 id="create-followup-title" className="text-base font-semibold text-white mb-4">
              Create Follow-Up Task
            </h3>
            <form onSubmit={handleCreateTask} className="space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg text-xs bg-rose-950/40 border border-rose-800 text-rose-300"
                >
                  ⚠️ {formError}
                </div>
              )}

              <div>
                <label htmlFor="followup-title" className="block text-xs font-medium text-slate-300 mb-1">
                  Task Title *
                </label>
                <input
                  id="followup-title"
                  type="text"
                  required
                  placeholder="e.g. Call Rajesh to confirm wire transfer"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="followup-due" className="block text-xs font-medium text-slate-300 mb-1">
                    Due Date
                  </label>
                  <input
                    id="followup-due"
                    type="date"
                    required
                    value={newDue}
                    onChange={(e) => setNewDue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="followup-priority" className="block text-xs font-medium text-slate-300 mb-1">
                    Priority
                  </label>
                  <select
                    id="followup-priority"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Save Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Follow-Up Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Follow-Up Task"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.title}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Confirm Delete"
        variant="danger"
        loading={deleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
