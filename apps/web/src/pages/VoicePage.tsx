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
  const [micActive, setMicActive] = useState<boolean>(false)
  const [audioLevel, setAudioLevel] = useState<number>(0)
  const [isListening, setIsListening] = useState<boolean>(false)
  const [manualInput, setManualInput] = useState<string>('')

  const timerRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const recognitionRef = useRef<any>(null)
  const animFrameRef = useRef<number | null>(null)

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

  // Clean up media on unmount
  useEffect(() => {
    return () => {
      stopMediaStream()
    }
  }, [])

  function stopMediaStream() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (_) {}
      recognitionRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setMicActive(false)
    setIsListening(false)
    setAudioLevel(0)
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  function speakText(text: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    }
  }

  function handleAgentReply(userUtterance: string) {
    const textLower = userUtterance.toLowerCase()
    const custName = selectedCustomer?.name ?? 'Customer'
    let reply = ''
    let newOutcome: 'PROMISE_TO_PAY' | 'RESOLVED' | 'NO_CONTACT' | 'DISPUTE' = outcome

    if (textLower.includes('friday') || textLower.includes('monday') || textLower.includes('tomorrow') || textLower.includes('pay') || textLower.includes('transfer')) {
      newOutcome = 'PROMISE_TO_PAY'
      reply = `Thank you for confirming, ${custName}. I have recorded your commitment to pay. You will receive an acknowledgment confirmation shortly.`
    } else if (textLower.includes('dispute') || textLower.includes('wrong') || textLower.includes('incorrect') || textLower.includes('not received')) {
      newOutcome = 'DISPUTE'
      reply = `I understand there may be an item under review, ${custName}. I have flagged this invoice for immediate account reconciliation with our billing team.`
    } else if (textLower.includes('busy') || textLower.includes('later') || textLower.includes('driving')) {
      newOutcome = 'NO_CONTACT'
      reply = `Understood. I will schedule a follow-up reminder to reach out at a more convenient time later today.`
    } else {
      reply = `Understood. Regarding your outstanding balance, could you specify an estimated date when we can expect the remittance?`
    }

    setOutcome(newOutcome)
    const timeStr = new Date().toTimeString().slice(3, 8)
    setTranscript((prev) => [
      ...prev,
      { speaker: 'agent', text: reply, time: timeStr },
    ])
    speakText(reply)
  }

  async function startMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      setMicActive(true)

      // Audio analysis for live visual pulse
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        const audioCtx = new AudioCtx()
        audioContextRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 64
        source.connect(analyser)

        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const updateVolume = () => {
          analyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]
          }
          const avg = sum / dataArray.length
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)))
          animFrameRef.current = requestAnimationFrame(updateVolume)
        }
        updateVolume()
      }

      // Web Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = false
        recognition.lang = 'en-IN'

        recognition.onresult = (event: any) => {
          const lastIdx = event.results.length - 1
          const userSpeech = event.results[lastIdx][0].transcript.trim()
          if (userSpeech) {
            const timeStr = new Date().toTimeString().slice(3, 8)
            setTranscript((prev) => [
              ...prev,
              { speaker: 'customer', text: userSpeech, time: timeStr },
            ])
            handleAgentReply(userSpeech)
          }
        }

        recognition.onstart = () => setIsListening(true)
        recognition.onend = () => {
          if (status === 'active') {
            try {
              recognition.start()
            } catch (_) {}
          } else {
            setIsListening(false)
          }
        }
        recognition.onerror = () => setIsListening(false)

        recognition.start()
        recognitionRef.current = recognition
      }
    } catch (err) {
      console.warn('Microphone access not granted or not supported:', err)
      setMicActive(false)
    }
  }

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

      setStatus('active')
      const custName = selectedCustomer?.name ?? 'Customer'
      const bal = selectedCustomer?.outstandingBalance
        ? `₹${Number(selectedCustomer.outstandingBalance).toLocaleString('en-IN')}`
        : 'outstanding balance'

      const greeting = `Namaste! Am I speaking with the accounts department at ${custName}? This is Chotu calling from myCashflo regarding pending invoice balance of ${bal}.`

      setTranscript([
        { speaker: 'system', text: `LiveKit Room session token issued: ${tokenData.roomName}`, time: '00:01' },
        { speaker: 'agent', text: greeting, time: '00:02' },
      ])

      // Speak greeting via Web Speech Synthesis
      speakText(greeting)

      // Start actual microphone capture & SpeechRecognition
      await startMicrophone()
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  async function handleEnd() {
    stopMediaStream()
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setStatus('completed')
    const finalDuration = duration || 25
    const custName = selectedCustomer?.name ?? 'Customer'
    const summaryText = `Call conducted with ${custName}. Outcome: ${outcome}. Total duration: ${formatSec(finalDuration)}.`
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
    stopMediaStream()
    setStatus('idle')
    setDuration(0)
    setTranscript([])
    setSavedSuccess(false)
  }

  function handleSendManualMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!manualInput.trim()) return
    const text = manualInput.trim()
    setManualInput('')
    const timeStr = new Date().toTimeString().slice(3, 8)
    setTranscript((prev) => [
      ...prev,
      { speaker: 'customer', text, time: timeStr },
    ])
    handleAgentReply(text)
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
        subtitle="Real-time AI-powered collection conversations with LiveKit protocol and microphone speech recognition"
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
        {/* Agent avatar with dynamic audio scale */}
        <div className="flex items-center justify-center mb-6">
          <div
            className="flex items-center justify-center rounded-full text-5xl transition-all duration-100"
            style={{
              width: 120,
              height: 120,
              transform: status === 'active' ? `scale(${1.0 + (audioLevel / 300)})` : 'scale(1)',
              background: status === 'active'
                ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                : 'var(--surface-2)',
              border: `3px solid ${status === 'active' ? 'var(--primary)' : 'var(--border)'}`,
              boxShadow: status === 'active'
                ? `0 0 ${20 + audioLevel / 2}px rgba(99,102,241,${0.4 + audioLevel / 200})`
                : 'none',
            }}
          >
            🤖
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-1">Chotu AI Collection Agent</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {status === 'idle' && 'Ready to connect live collection call with microphone and speech recognition'}
          {status === 'connecting' && 'Negotiating LiveKit room session token…'}
          {status === 'active' && `Call in progress (${formatSec(duration)})`}
          {status === 'completed' && 'Call ended — summary saved'}
          {status === 'error' && 'Connection failed — please retry'}
        </p>

        {/* Live Status Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-slate-300">{status === 'active' ? 'Live Room Active' : 'Standby'}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className="text-slate-400">🎙️ Mic:</span>
            <span className={micActive ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
              {micActive ? `Active (${audioLevel}%)` : 'Ready'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className="text-slate-400">🗣️ Speech Engine:</span>
            <span className={isListening ? 'text-indigo-400 font-semibold animate-pulse' : 'text-slate-400'}>
              {isListening ? 'Listening' : 'Web Speech API'}
            </span>
          </div>
        </div>

        {/* Controls */}
        {status === 'idle' || status === 'error' ? (
          <button
            onClick={handleStart}
            className="px-8 py-3 rounded-xl text-white font-semibold text-sm cursor-pointer transition-all duration-150"
            style={{ background: 'var(--primary)', border: 'none' }}
          >
            🎙️ Start Voice Session (Microphone Enabled)
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

        {/* Live Transcript Area */}
        {(status === 'active' || status === 'completed') && (
          <div className="mt-8 rounded-xl p-5 text-left text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">
                Live Transcript & Microphone Log
              </span>
              <span className="text-xs font-mono text-slate-400">{formatSec(duration)}</span>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 mb-3">
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
                      {m.speaker === 'agent' ? '🤖 Chotu AI' : '👤 You (Customer)'} · {m.time}
                    </div>
                  )}
                  {m.text}
                </div>
              ))}
            </div>

            {/* Optional text input fallback for testing without voice speaking */}
            {status === 'active' && (
              <form onSubmit={handleSendManualMessage} className="flex gap-2 pt-2 border-t border-slate-700/60">
                <input
                  type="text"
                  placeholder="Or type a reply to Chotu (e.g. 'We will pay this Friday')…"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
