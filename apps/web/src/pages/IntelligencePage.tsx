import { useState, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import {
  getAiTools,
  getPendingActionProposals,
  getAllActionProposals,
  approveActionProposal,
  rejectActionProposal,
  executeAiTool,
  sendIntelligenceChat,
} from '../api/intelligence'
import {
  getNotifications,
  getNotificationTemplates,
  dispatchNotification,
  triggerAutomatedReminders,
  type NotificationTemplate,
  type TriggerRemindersResult,
} from '../api/notifications'
import { getAuditLogs } from '../api/auditLogs'
import { customersApi } from '../api/customers'
import type {
  ActionProposal,
  AiToolDefinition,
  Notification,
  AuditLog,
  Customer,
  NotificationChannel,
} from '../../../../packages/shared-types'

export default function IntelligencePage() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'reminders' | 'tools' | 'audit'>('approvals')

  // Approvals State
  const [pendingProposals, setPendingProposals] = useState<ActionProposal[]>([])
  const [allProposals, setAllProposals] = useState<ActionProposal[]>([])
  const [loadingApprovals, setLoadingApprovals] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectReasonPrompt, setRejectReasonPrompt] = useState<{ id: string } | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Reminders State
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [dispatchCustomer, setDispatchCustomer] = useState('')
  const [dispatchChannel, setDispatchChannel] = useState<NotificationChannel>('WHATSAPP')
  const [dispatchTemplate, setDispatchTemplate] = useState('PAYMENT_REMINDER_OVERDUE')
  const [dispatchCustomMsg, setDispatchCustomMsg] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [reminderEngineResult, setReminderEngineResult] = useState<TriggerRemindersResult | null>(null)
  const [runningEngine, setRunningEngine] = useState(false)

  // Tools & Chat State
  const [tools, setTools] = useState<AiToolDefinition[]>([])
  const [selectedTool, setSelectedTool] = useState<AiToolDefinition | null>(null)
  const [toolParamsInput, setToolParamsInput] = useState('{\n  "customerId": ""\n}')
  const [toolResult, setToolResult] = useState<any>(null)
  const [runningTool, setRunningTool] = useState(false)
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string; toolCalled?: string }>>([
    { sender: 'ai', text: 'Hello! I am Chotu Collections Intelligence. Ask me about any customer balance, overdue invoices, or account summaries.' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditFilterAction, setAuditFilterAction] = useState('')

  // Success / Error banner
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  function showAlert(message: string, type: 'success' | 'error' = 'success') {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 5000)
  }

  // Load Initial Data
  useEffect(() => {
    loadApprovals()
    loadReminders()
    loadTools()
    loadAuditLogs()
  }, [])

  async function loadApprovals() {
    setLoadingApprovals(true)
    try {
      const [pending, all] = await Promise.all([
        getPendingActionProposals(),
        getAllActionProposals(),
      ])
      setPendingProposals(pending)
      setAllProposals(all)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoadingApprovals(false)
    }
  }

  async function loadReminders() {
    try {
      const [notifsRes, tpls, custsRes] = await Promise.all([
        getNotifications({ limit: 50 }),
        getNotificationTemplates(),
        customersApi.list({ limit: 100 }),
      ])
      setNotifications(notifsRes.data)
      setTemplates(tpls)
      setCustomers(custsRes.data as any)
      if (custsRes.data.length > 0 && !dispatchCustomer) {
        setDispatchCustomer(custsRes.data[0].id)
      }
    } catch (err: any) {
      console.error(err)
    }
  }

  async function loadTools() {
    try {
      const list = await getAiTools()
      setTools(list)
      if (list.length > 0) {
        setSelectedTool(list[0])
      }
    } catch (err: any) {
      console.error(err)
    }
  }

  async function loadAuditLogs(actionFilter?: string) {
    try {
      const res = await getAuditLogs({ limit: 50, action: actionFilter || undefined })
      setAuditLogs(res.data)
    } catch (err: any) {
      console.error(err)
    }
  }

  // Handle Approvals
  async function handleApprove(id: string) {
    setProcessingId(id)
    try {
      await approveActionProposal(id)
      showAlert(`Action approved and executed successfully!`)
      loadApprovals()
      loadAuditLogs()
    } catch (err: any) {
      showAlert(err.response?.data?.message || err.message, 'error')
    } finally {
      setProcessingId(null)
    }
  }

  async function handleReject(id: string) {
    setProcessingId(id)
    try {
      await rejectActionProposal(id, rejectReason || undefined)
      showAlert('Action proposal rejected.')
      setRejectReasonPrompt(null)
      setRejectReason('')
      loadApprovals()
      loadAuditLogs()
    } catch (err: any) {
      showAlert(err.response?.data?.message || err.message, 'error')
    } finally {
      setProcessingId(null)
    }
  }

  // Handle Manual Dispatch
  async function handleDispatch(e: React.FormEvent) {
    e.preventDefault()
    if (!dispatchCustomer) return
    setDispatching(true)
    try {
      const res = await dispatchNotification({
        customerId: dispatchCustomer,
        channel: dispatchChannel,
        template: dispatchTemplate,
        payload: dispatchCustomMsg ? { customMessage: dispatchCustomMsg } : {},
      })
      showAlert(`Dispatched via ${res.channel} — Status: ${res.status}`)
      loadReminders()
      loadAuditLogs()
      setDispatchCustomMsg('')
    } catch (err: any) {
      showAlert(err.response?.data?.message || err.message, 'error')
    } finally {
      setDispatching(false)
    }
  }

  // Handle Automated Reminders Trigger
  async function handleRunAutomatedReminders() {
    setRunningEngine(true)
    try {
      const res = await triggerAutomatedReminders()
      setReminderEngineResult(res)
      showAlert(`Evaluated ${res.evaluatedInvoices} invoices: ${res.dispatchedCount} reminders sent!`)
      loadReminders()
      loadAuditLogs()
    } catch (err: any) {
      showAlert(err.response?.data?.message || err.message, 'error')
    } finally {
      setRunningEngine(false)
    }
  }

  // Handle Tool Execution
  async function handleExecuteTool() {
    if (!selectedTool) return
    setRunningTool(true)
    setToolResult(null)
    try {
      let parsed = {}
      try {
        parsed = JSON.parse(toolParamsInput)
      } catch (e) {
        throw new Error('Invalid JSON format in parameters')
      }
      const res = await executeAiTool({
        toolName: selectedTool.name,
        parameters: parsed,
        confirmed: false,
      })
      setToolResult(res)
      if (res.status === 'REQUIRES_CONFIRMATION') {
        showAlert(`Action requires confirmation: Proposal #${res.proposal?.id} created`, 'error')
        loadApprovals()
      } else {
        showAlert(`Tool '${selectedTool.name}' executed successfully!`)
      }
      loadAuditLogs()
    } catch (err: any) {
      setToolResult({ error: err.response?.data?.message || err.message })
      showAlert(err.response?.data?.message || err.message, 'error')
    } finally {
      setRunningTool(false)
    }
  }

  // Handle Assistant Chat
  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault()
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatMessages((prev) => [...prev, { sender: 'user', text: msg }])
    setChatInput('')
    setChatLoading(true)
    try {
      const res = await sendIntelligenceChat(msg)
      setChatMessages((prev) => [
        ...prev,
        { sender: 'ai', text: res.reply, toolCalled: res.toolCalled ?? undefined },
      ])
      loadAuditLogs()
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'ai', text: `Error: ${err.response?.data?.message || err.message}` },
      ])
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Collections Intelligence"
        subtitle="AI tool execution, human-in-the-loop action approval, multi-channel reminders, and audit logging."
      />

      {/* Alert Banner */}
      {alert && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-sm transition-all duration-200 ${
            alert.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
          }`}
        >
          <span>{alert.message}</span>
          <button onClick={() => setAlert(null)} className="text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-white/10 gap-2">
        {[
          { key: 'approvals', label: `Pending Approvals (${pendingProposals.length})`, icon: '🛡️' },
          { key: 'reminders', label: 'Multi-Channel Reminders', icon: '📬' },
          { key: 'tools', label: 'AI Tools & Assistant', icon: '⚡' },
          { key: 'audit', label: 'Audit Trail', icon: '📜' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
              activeTab === tab.key
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab 1: Action Approvals (Confirmation Guard) ────────────────────── */}
      {activeTab === 'approvals' && (
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-white">
                  Human-in-the-Loop Action Approvals
                </h3>
                <p className="text-xs text-white/50 mt-1">
                  Financial or customer-facing operations proposed by Chotu AI require explicit confirmation before execution.
                </p>
              </div>
              <button
                onClick={loadApprovals}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                Refresh
              </button>
            </div>

            {loadingApprovals ? (
              <div className="py-12 text-center text-white/40">Loading action proposals...</div>
            ) : pendingProposals.length === 0 ? (
              <div className="py-12 text-center text-white/40 bg-white/[0.02] rounded-xl border border-dashed border-white/10">
                <span className="text-3xl block mb-2">✅</span>
                No pending AI action proposals. All proposed actions have been reviewed.
              </div>
            ) : (
              <div className="space-y-4">
                {pendingProposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="p-5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                            proposal.riskLevel === 'HIGH'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : proposal.riskLevel === 'MEDIUM'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {proposal.riskLevel} RISK
                        </span>
                        <span className="text-xs font-mono text-indigo-400">
                          {proposal.toolName}
                        </span>
                        <span className="text-xs text-white/40">
                          Proposed by: {proposal.proposedBy} • {new Date(proposal.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-white">{proposal.summary}</p>
                      <details className="text-xs text-white/50 cursor-pointer">
                        <summary className="hover:text-white/80">View Action Parameters</summary>
                        <pre className="mt-2 p-3 bg-black/40 rounded-lg overflow-x-auto text-indigo-200 font-mono text-xs">
                          {JSON.stringify(proposal.parameters, null, 2)}
                        </pre>
                      </details>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        disabled={processingId === proposal.id}
                        onClick={() => handleApprove(proposal.id)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors shadow-lg shadow-emerald-900/30 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        ✓ Approve & Execute
                      </button>
                      <button
                        disabled={processingId === proposal.id}
                        onClick={() => setRejectReasonPrompt({ id: proposal.id })}
                        className="px-4 py-2 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/30 text-xs transition-colors disabled:opacity-50"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rejection Reason Modal */}
          {rejectReasonPrompt && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-[#18181b] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4">
                <h4 className="text-sm font-semibold text-white">Reject AI Action Proposal</h4>
                <p className="text-xs text-white/60">
                  Please provide a reason for rejecting this proposed collection action. This will be recorded in the tenant audit log.
                </p>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g., Customer requested call next month, or incorrect invoice..."
                  className="w-full h-24 p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setRejectReasonPrompt(null)
                      setRejectReason('')
                    }}
                    className="px-4 py-2 text-xs text-white/60 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleReject(rejectReasonPrompt.id)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-medium"
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Historical Proposals */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Action Proposal History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 uppercase">
                    <th className="py-2.5">Date</th>
                    <th className="py-2.5">Action</th>
                    <th className="py-2.5">Summary</th>
                    <th className="py-2.5">Status</th>
                    <th className="py-2.5">Reviewed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {allProposals.slice(0, 10).map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 text-white/50">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 font-mono text-indigo-400">{p.toolName}</td>
                      <td className="py-2.5 text-white/80 max-w-xs truncate">{p.summary}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            p.status === 'EXECUTED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : p.status === 'REJECTED'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-white/50">{p.reviewedBy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: Multi-Channel Reminders ─────────────────────────────────── */}
      {activeTab === 'reminders' && (
        <div className="space-y-6">
          {/* Automated Reminders Engine Hero */}
          <div className="bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-zinc-900/40 border border-indigo-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full uppercase tracking-wider">
                Automated Rules Engine
              </span>
              <h3 className="text-base font-bold text-white mt-2">
                Automated Overdue Escalation Engine
              </h3>
              <p className="text-xs text-white/60 mt-1 max-w-2xl">
                Scans overdue tenant invoices and dispatches reminders matching ageing rules:
                <strong className="text-white"> 1–14 days overdue → Email</strong>,{' '}
                <strong className="text-white"> 15–30 days → SMS</strong>,{' '}
                <strong className="text-white"> 30+ days → WhatsApp</strong>.
              </p>
            </div>
            <button
              disabled={runningEngine}
              onClick={handleRunAutomatedReminders}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-medium text-xs transition-all shadow-lg shadow-indigo-900/40 disabled:opacity-50 shrink-0 cursor-pointer"
            >
              {runningEngine ? 'Evaluating Rules...' : '⚡ Run Automated Reminders'}
            </button>
          </div>

          {/* Engine Results modal/card if triggered */}
          {reminderEngineResult && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">Execution Summary</h4>
                <button
                  onClick={() => setReminderEngineResult(null)}
                  className="text-xs text-white/40 hover:text-white"
                >
                  ✕ Close
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="text-xs text-white/50">Invoices Evaluated</div>
                  <div className="text-lg font-bold text-white mt-1">{reminderEngineResult.evaluatedInvoices}</div>
                </div>
                <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="text-xs text-white/50">Reminders Dispatched</div>
                  <div className="text-lg font-bold text-emerald-400 mt-1">{reminderEngineResult.dispatchedCount}</div>
                </div>
                <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="text-xs text-white/50">Exceptions / Missing Info</div>
                  <div className="text-lg font-bold text-rose-400 mt-1">{reminderEngineResult.failedCount}</div>
                </div>
              </div>
            </div>
          )}

          {/* Manual Notification Dispatch Form */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 md:col-span-1 space-y-4">
              <h3 className="text-sm font-semibold text-white">Dispatch Notification</h3>
              <form onSubmit={handleDispatch} className="space-y-4 text-xs">
                <div>
                  <label className="block text-white/60 mb-1">Target Customer</label>
                  <select
                    value={dispatchCustomer}
                    onChange={(e) => setDispatchCustomer(e.target.value)}
                    className="w-full p-2.5 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.company || 'Individual'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-white/60 mb-1">Delivery Channel</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['WHATSAPP', 'SMS', 'EMAIL'] as NotificationChannel[]).map((ch) => (
                      <button
                        type="button"
                        key={ch}
                        onClick={() => setDispatchChannel(ch)}
                        className={`p-2 rounded-xl text-center text-xs font-medium border transition-colors cursor-pointer ${
                          dispatchChannel === ch
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-white/[0.02] border-white/10 text-white/60 hover:text-white'
                        }`}
                      >
                        {ch === 'WHATSAPP' ? '💬 WhatsApp' : ch === 'SMS' ? '📱 SMS' : '✉️ Email'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-white/60 mb-1">Template</label>
                  <select
                    value={dispatchTemplate}
                    onChange={(e) => setDispatchTemplate(e.target.value)}
                    className="w-full p-2.5 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-white/60 mb-1">Custom Notes / Message (Optional)</label>
                  <textarea
                    value={dispatchCustomMsg}
                    onChange={(e) => setDispatchCustomMsg(e.target.value)}
                    placeholder="Additional context or custom message..."
                    className="w-full h-20 p-2.5 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={dispatching || !dispatchCustomer}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-900/30 disabled:opacity-50 cursor-pointer"
                >
                  {dispatching ? 'Sending...' : '🚀 Send Notification'}
                </button>
              </form>
            </div>

            {/* Notification History */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 md:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Recent Notification Logs</h3>
                <span className="text-xs text-white/40">{notifications.length} records</span>
              </div>
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[#18181b] z-10 border-b border-white/10 text-white/40 uppercase">
                    <tr>
                      <th className="py-2.5">Date</th>
                      <th className="py-2.5">Customer</th>
                      <th className="py-2.5">Channel</th>
                      <th className="py-2.5">Template</th>
                      <th className="py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {notifications.map((n) => (
                      <tr key={n.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 text-white/50">{new Date(n.createdAt).toLocaleTimeString()}</td>
                        <td className="py-2.5 text-white font-medium">{n.customer?.name ?? '—'}</td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 border border-white/10 text-indigo-300">
                            {n.channel}
                          </span>
                        </td>
                        <td className="py-2.5 text-white/70 max-w-xs truncate">{n.template}</td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              n.status === 'DELIVERED'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : n.status === 'SENT'
                                ? 'bg-blue-500/20 text-blue-300'
                                : n.status === 'FAILED'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {n.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 3: AI Tools & Assistant ────────────────────────────────────── */}
      {activeTab === 'tools' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tool Executor Bench */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">AI Tools Catalog & Test Bench</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Select AI Tool</label>
                <select
                  value={selectedTool?.name}
                  onChange={(e) => {
                    const t = tools.find((item) => item.name === e.target.value)
                    if (t) {
                      setSelectedTool(t)
                      const sampleParams: any = {}
                      for (const k of t.parameters.required || []) {
                        sampleParams[k] = k === 'customerId' && customers.length > 0 ? customers[0].id : ''
                      }
                      setToolParamsInput(JSON.stringify(sampleParams, null, 2))
                    }
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 font-mono"
                >
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} {t.isConsequential ? '⚠️ (Consequential)' : '✓ (Safe)'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTool && (
                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1 text-xs">
                  <div className="text-white/80">{selectedTool.description}</div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-white/50">
                    <span>
                      Type:{' '}
                      <strong className={selectedTool.isConsequential ? 'text-amber-400' : 'text-emerald-400'}>
                        {selectedTool.isConsequential ? 'Consequential (Needs Confirmation)' : 'Read-Only (Auto-run)'}
                      </strong>
                    </span>
                    <span>Risk: {selectedTool.riskLevel}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-white/60 mb-1">Parameters (JSON)</label>
                <textarea
                  value={toolParamsInput}
                  onChange={(e) => setToolParamsInput(e.target.value)}
                  className="w-full h-32 p-3 bg-black/60 border border-white/10 rounded-xl text-xs font-mono text-indigo-200 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <button
                onClick={handleExecuteTool}
                disabled={runningTool || !selectedTool}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors shadow-lg shadow-indigo-900/30 disabled:opacity-50 cursor-pointer"
              >
                {runningTool ? 'Executing...' : '▶ Execute Tool'}
              </button>

              {toolResult && (
                <div className="space-y-1">
                  <span className="text-[10px] text-white/40 uppercase font-mono">Execution Response</span>
                  <pre className="p-3 bg-black/60 border border-white/10 rounded-xl text-xs font-mono text-emerald-300 overflow-x-auto max-h-48">
                    {JSON.stringify(toolResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Natural Language Collections Assistant */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col h-[560px]">
            <h3 className="text-sm font-semibold text-white mb-2">Chotu Collections Assistant</h3>
            <p className="text-xs text-white/50 mb-4">
              Ask natural language queries like <span className="text-indigo-300">"What is the balance for Raj Enterprises?"</span> or <span className="text-indigo-300">"Show overdue invoices for Mehta"</span>.
            </p>

            <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-black/30 border border-white/5 rounded-xl mb-4 text-xs">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`p-3 rounded-2xl max-w-[85%] whitespace-pre-line ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-white/10 text-white/90 rounded-bl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                  {msg.toolCalled && (
                    <span className="text-[9px] font-mono text-indigo-400 mt-1">
                      ⚡ Tool invoked: {msg.toolCalled}
                    </span>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="text-white/40 text-xs italic">Chotu is analyzing ledger...</div>
              )}
            </div>

            <form onSubmit={handleSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about a customer balance or overdue bills..."
                className="flex-1 p-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium disabled:opacity-50 cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Tab 4: Tenant Audit Trail ──────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Tenant Audit Log Trail</h3>
              <p className="text-xs text-white/50 mt-1">
                Tamper-resistant, tenant-isolated activity trail tracking AI actions, notifications, and ledger updates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={auditFilterAction}
                onChange={(e) => {
                  setAuditFilterAction(e.target.value)
                  loadAuditLogs(e.target.value)
                }}
                placeholder="Filter by action..."
                className="p-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => loadAuditLogs(auditFilterAction)}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-white"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase">
                  <th className="py-2.5">Timestamp</th>
                  <th className="py-2.5">User</th>
                  <th className="py-2.5">Action</th>
                  <th className="py-2.5">Entity</th>
                  <th className="py-2.5">Details (Metadata)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 text-white/50">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 text-white font-medium">
                      {log.user?.name ?? log.userId}
                    </td>
                    <td className="py-2.5 font-mono text-indigo-400">
                      {log.action}
                    </td>
                    <td className="py-2.5 text-white/60">
                      {log.entityType ? `${log.entityType} ${log.entityId ? `#${log.entityId.slice(-6)}` : ''}` : '—'}
                    </td>
                    <td className="py-2.5 text-white/70 max-w-xs truncate">
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
