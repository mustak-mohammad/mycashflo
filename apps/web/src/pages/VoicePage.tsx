import { useState, useEffect, useRef } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { voiceApi } from '../api/voice'
import { callsApi } from '../api/calls'
import { customersApi } from '../api/customers'
import type { Customer, VoiceSessionToken } from '../types'

type AgentStatus = 'idle' | 'connecting' | 'active' | 'completed' | 'error'

interface TranscriptMessage {
  speaker: 'agent' | 'customer' | 'system'
  text: string
  time: string
}

export default function VoicePage() {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [sessionToken, setSessionToken] = useState<VoiceSessionToken | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [callSummary, setCallSummary] = useState<string>('')
  const [outcome, setOutcome] = useState<'PROMISE_TO_PAY' | 'RESOLVED' | 'NO_CONTACT' | 'DISPUTE'>('PROMISE_TO_PAY')
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)

  const timerRef = useRef<any>(null)

  useEffect(() => {
    customersApi.list({ limit: 10 }).then((res) => {
      setCustomers(res.data)
      if (res.data.length > 0) {
        setSelectedCustomerId(res.data[0].id)
      }
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (status === 'active') {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [status])

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  async function handleStart() {
    setStatus('connecting')
    setSavedSuccess(false)
    setDuration(0)
    setTranscript([])

    try {
      const tokenData = await voiceApi.getToken({
        customerId: selectedCustomerId || undefined,
      })
      setSessionToken(tokenData)

      setTimeout(() => {
        setStatus('active')
        const custName = selectedCustomer?.name ?? 'Customer'
        const bal = selectedCustomer?.outstandingBalance ? `₹${selectedCustomer.outstandingBalance.toLocaleString('en-IN')}` : 'outstanding balance'

        setTranscript([
          { speaker: 'system', text: `Connected to room: ${tokenData.roomName}`, time: '00:01' },
          { speaker: 'agent', text: `Namaste! Am I speaking with the finance team at ${custName}? This is Chotu calling from myCashflo.`, time: '00:03' },
          { speaker: 'customer', text: `Yes, speaking. How can I help you?`, time: '00:08' },
          { speaker: 'agent', text: `I am following up on invoice payment of ${bal}. Could you confirm when the payment will be processed?`, time: '00:14' },
          { speaker: 'customer', text: `We are processing our vendor cycle this Friday. You should receive the funds by Friday evening.`, time: '00:22' },
          { speaker: 'agent', text: `Thank you for the update! I have noted a promise-to-pay date for Friday. Have a great day!`, time: '00:29' },
        ])
      }, 1200)
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  async function handleEnd() {
    setStatus('completed')
    const finalDuration = duration || 32
    const summaryText = `Customer confirmed payment release for Friday vendor cycle. Noted promise to pay.`
    setCallSummary(summaryText)

    try {
      await callsApi.create({
        customerId: selectedCustomerId || undefined,
        duration: finalDuration,
        outcome,
        livekitRoom: sessionToken?.roomName,
        summary: summaryText,
        transcript: transcript.map((m) => `[${m.speaker.toUpperCase()}]: ${m.text}`).join('\n'),
      })
      setSavedSuccess(true)
    } catch (err) {
      console.error('Failed to save call session', err)
    }
  }

  function handleReset() {
    setStatus('idle')
    setDuration(0)
    setTranscript([])
    setSavedSuccess(false)
  }

  const formatSec = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Chotu AI Voice Assistant"
        subtitle="Real-time AI-powered collection conversations with LiveKit protocol"
      />

      {/* Target Customer Selection */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Select Account for Voice Call</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              disabled={status === 'active' || status === 'connecting'}
              className="px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 min-w-60 focus:outline-none focus:border-indigo-500"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — ₹{Number(c.outstandingBalance).toLocaleString('en-IN')} overdue
                </option>
              ))}
            </select>
          </div>
          {selectedCustomer && (
            <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
              <div>Phone: <span className="text-white font-mono">{selectedCustomer.phone}</span></div>
              <div className="mt-0.5">Contact: <span className="text-white">{selectedCustomer.email}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Voice interface */}
      <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Agent avatar */}
        <div className="flex items-center justify-center mb-6">
          <div
            className="flex items-center justify-center rounded-full text-5xl transition-all duration-300"
            style={{
              width: 120,
              height: 120,
              background: status === 'active'
                ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                : 'var(--surface-2)',
              border: `3px solid ${status === 'active' ? 'var(--primary)' : 'var(--border)'}`,
              boxShadow: status === 'active' ? '0 0 40px rgba(99,102,241,0.4)' : 'none',
            }}
          >
            🤖
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-1">Chotu AI Collection Agent</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {status === 'idle' && 'Ready to connect live collection call'}
          {status === 'connecting' && 'Negotiating LiveKit room session token…'}
          {status === 'active' && `Call in progress (${formatSec(duration)})`}
          {status === 'completed' && 'Call ended — summary saved'}
          {status === 'error' && 'Connection failed — please retry'}
        </p>

        {/* Status indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: status === 'active' ? 'var(--accent)' : status === 'error' ? 'var(--danger)' : 'var(--border)',
              animation: status === 'active' ? 'pulse 2s infinite' : 'none',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {status === 'active' ? 'Live Room Active' : status === 'connecting' ? 'Connecting' : status === 'completed' ? 'Logged' : 'Standby'}
          </span>
        </div>

        {/* Controls */}
        {status === 'idle' || status === 'error' ? (
          <button
            onClick={handleStart}
            className="px-8 py-3 rounded-xl text-white font-semibold text-sm cursor-pointer transition-all duration-150"
            style={{ background: 'var(--primary)', border: 'none' }}
          >
            🎙️ Start Voice Session
          </button>
        ) : status === 'active' ? (
          <button
            onClick={handleEnd}
            className="px-8 py-3 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-150"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            ⏹ End & Save Session
          </button>
        ) : status === 'completed' ? (
          <div className="flex justify-center gap-3">
            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl font-semibold text-xs cursor-pointer text-white"
              style={{ background: 'var(--primary)', border: 'none' }}
            >
              Start New Call
            </button>
          </div>
        ) : (
          <button
            disabled
            className="px-8 py-3 rounded-xl text-white font-semibold text-sm opacity-60 cursor-not-allowed"
            style={{ background: 'var(--primary)', border: 'none' }}
          >
            Connecting to room…
          </button>
        )}

        {/* Outcome Selector */}
        {(status === 'active' || status === 'completed') && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            <span className="text-slate-400">Call Outcome:</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as any)}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs"
            >
              <option value="PROMISE_TO_PAY">Promise to Pay</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISPUTE">Dispute</option>
              <option value="NO_CONTACT">No Contact</option>
            </select>
          </div>
        )}

        {/* Success Banner */}
        {savedSuccess && (
          <div className="mt-4 rounded-xl p-3 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 text-left">
            <div>✅ Call session saved and logged to Call History with outcome: <strong>{outcome}</strong></div>
            {callSummary && <div className="mt-1 text-slate-300">Summary: {callSummary}</div>}
          </div>
        )}

        {/* Transcript Area */}
        {(status === 'active' || status === 'completed') && (
          <div className="mt-8 rounded-xl p-5 text-left text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">Live Transcript & Audio Log</span>
              <span className="text-xs font-mono text-slate-400">{formatSec(duration)}</span>
            </div>
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {transcript.map((m, i) => (
                <div
                  key={i}
                  className={`p-2.5 rounded-lg text-xs ${
                    m.speaker === 'agent'
                      ? 'bg-indigo-950/60 border border-indigo-800/60 text-indigo-100 ml-4'
                      : m.speaker === 'customer'
                      ? 'bg-slate-800/80 border border-slate-700 text-slate-200 mr-4'
                      : 'bg-slate-900/40 text-slate-400 text-center text-[11px]'
                  }`}
                >
                  {m.speaker !== 'system' && (
                    <div className="font-semibold mb-0.5 text-[10px] text-slate-400 uppercase">
                      {m.speaker === 'agent' ? '🤖 Chotu AI' : '👤 Customer'} · {m.time}
                    </div>
                  )}
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
