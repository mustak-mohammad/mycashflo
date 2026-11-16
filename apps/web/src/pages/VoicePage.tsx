import { useState, useEffect, useRef, useMemo } from 'react'
import { Room, Track, RemoteTrack, RoomEvent } from 'livekit-client'
import { PageHeader } from '../components/ui/PageHeader'
import { voiceApi } from '../api/voice'
import { callsApi } from '../api/calls'
import { customersApi } from '../api/customers'
import { promptsApi } from '../api/prompts'
import { isPromptCompatibleWithCallType } from '../utils/promptCategories'
import { useToast } from '../store/ToastContext'
import { extractSafeErrorMessage } from '../utils/safeError'
import type { Customer, VoiceSessionToken, VoicePrompt, ConversationStage, CallOutcome, CallType, StructuredCallSummary } from '../types'

type AgentStatus = 'idle' | 'connecting' | 'active' | 'completed' | 'error'

interface TranscriptMessage {
  speaker: 'agent' | 'customer' | 'system'
  text: string
  time: string
}

export interface SessionVoiceProfile {
  engine: 'backend-tts' | 'browser-speech'
  voiceName: string
  lang: string
  gender: 'female' | 'male' | 'unknown'
  fallbackVoice?: SpeechSynthesisVoice
}

const STAGES: { id: ConversationStage; label: string; step: number }[] = [
  { id: 'GREETING_AND_VERIFICATION', label: '1. Identity', step: 1 },
  { id: 'CONFIRM_BALANCE', label: '2. Balance', step: 2 },
  { id: 'ASK_FULL_PAYMENT', label: '3. Full Pay', step: 3 },
  { id: 'NEGOTIATE_AMOUNT', label: '4. Negotiate', step: 4 },
  { id: 'ASK_PAYMENT_DATE', label: '5. Date', step: 5 },
  { id: 'ASK_DELAY_REASON', label: '6. Reason', step: 6 },
  { id: 'PAYMENT_METHOD', label: '7. Mode', step: 7 },
  { id: 'ASSISTANCE_CHECK', label: '8. Link/Help', step: 8 },
  { id: 'SUMMARIZE_COMMITMENT', label: '9. Summary', step: 9 },
  { id: 'CLOSING', label: '10. Close', step: 10 },
]

function formatSec(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VoicePage() {
  const toast = useToast()
  const [status, setStatus] = useState<AgentStatus>('idle')
  const statusRef = useRef<AgentStatus>('idle')
  const endTimeoutRef = useRef<any>(null)

  const updateStatus = (newStatus: AgentStatus) => {
    setStatus(newStatus)
    statusRef.current = newStatus
  }

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const [customers, setCustomers] = useState<Customer[]>([])
  const [customersError, setCustomersError] = useState<string | null>(null)
  const [deliveryActionError, setDeliveryActionError] = useState<string | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [callType, setCallType] = useState<CallType>('COLLECTIONS')
  const [prompts, setPrompts] = useState<VoicePrompt[]>([])
  const [promptsError, setPromptsError] = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [sessionToken, setSessionToken] = useState<VoiceSessionToken | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const durationRef = useRef<number>(0)
  const callStartTimeRef = useRef<number | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [callSummary, setCallSummary] = useState<string>('')
  const [structuredSummary, setStructuredSummary] = useState<StructuredCallSummary | null>(null)
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [outcome, setOutcome] = useState<CallOutcome>('OTHER')
  const [persistedOutcome, setPersistedOutcome] = useState<CallOutcome>('OTHER')
  const [isUpdatingOutcome, setIsUpdatingOutcome] = useState<boolean>(false)
  const [outcomeUpdateMsg, setOutcomeUpdateMsg] = useState<string | null>(null)
  const [outcomeUpdateError, setOutcomeUpdateError] = useState<string | null>(null)
  const [outcomeNotes, setOutcomeNotes] = useState<string>('')
  const outcomeRef = useRef<CallOutcome>('OTHER')

  const updateOutcome = (newOutcome: CallOutcome) => {
    setOutcome(newOutcome)
    outcomeRef.current = newOutcome
  }

  const getElapsedTimestamp = (): string => {
    if (!callStartTimeRef.current) return '0:00'
    const elapsedSec = Math.max(0, Math.floor((Date.now() - callStartTimeRef.current) / 1000))
    return formatSec(elapsedSec)
  }
  const [micActive, setMicActive] = useState<boolean>(false)
  const [audioLevel, setAudioLevel] = useState<number>(0)
  const [isListening, setIsListening] = useState<boolean>(false)
  const [manualInput, setManualInput] = useState<string>('')

  // 10-Stage Conversation State
  const [currentStage, setCurrentStage] = useState<ConversationStage>('GREETING_AND_VERIFICATION')
  const [extractedData, setExtractedData] = useState<Record<string, any>>({})
  const [turnCount, setTurnCount] = useState<number>(0)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [egressId, setEgressId] = useState<string | undefined>(undefined)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'saving' | 'saved' | 'failed'>('idle')
  const pendingAudioBlobRef = useRef<Blob | null>(null)
  const [isRetryingUpload, setIsRetryingUpload] = useState<boolean>(false)

  // Document Delivery Live State
  const [isCancellingDelivery, setIsCancellingDelivery] = useState<boolean>(false)
  const [isRetryingDelivery, setIsRetryingDelivery] = useState<boolean>(false)
  const [copiedPaymentLink, setCopiedPaymentLink] = useState<boolean>(false)

  const timerRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const chotuGainRef = useRef<GainNode | null>(null)
  const customerGainRef = useRef<GainNode | null>(null)
  const masterBusRef = useRef<GainNode | null>(null)
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const roomRef = useRef<Room | null>(null)
  const [recordingAvailable, setRecordingAvailable] = useState<boolean>(false)

  // Voice Interaction Lifecycle Guards
  const isProcessingRef = useRef<boolean>(false)
  const isSpeakingRef = useRef<boolean>(false)
  const recognitionInstanceRef = useRef<any>(null)
  const restartTimerRef = useRef<any>(null)
  const lastProcessedTranscriptRef = useRef<string>('')

  const currentStageRef = useRef<ConversationStage>('GREETING_AND_VERIFICATION')
  const turnCountRef = useRef<number>(0)
  const extractedDataRef = useRef<Record<string, any>>({})
  const sessionVoiceProfileRef = useRef<SessionVoiceProfile | null>(null)
  const [activeVoiceName, setActiveVoiceName] = useState<string>('Google Indian English (Female - en-IN)')

  function resolveSessionVoice(): SessionVoiceProfile {
    let fallbackVoice: SpeechSynthesisVoice | undefined = undefined
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const voices = window.speechSynthesis.getVoices()
      fallbackVoice =
        voices.find((v) => (v.lang === 'en-IN' || v.lang === 'hi-IN') && /heera|neerja|female|aditi|priya/i.test(v.name)) ||
        voices.find((v) => v.lang === 'en-IN' || v.lang === 'hi-IN') ||
        voices.find((v) => /female|zira|samantha|karen|victoria/i.test(v.name)) ||
        voices.find((v) => v.lang.startsWith('en') && !/david|mark|george/i.test(v.name)) ||
        voices[0]
    }
    return {
      engine: 'backend-tts',
      voiceName: 'Google Indian English (Female - en-IN)',
      lang: 'en-IN',
      gender: 'female',
      fallbackVoice,
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices()
      }
    }
  }, [])

  useEffect(() => {
    currentStageRef.current = currentStage
  }, [currentStage])

  useEffect(() => {
    turnCountRef.current = turnCount
  }, [turnCount])

  useEffect(() => {
    extractedDataRef.current = extractedData
  }, [extractedData])

  // Load customers
  useEffect(() => {
    customersApi
      .list({ limit: 20 })
      .then((res) => {
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
        setCustomers(list)
        setCustomersError(null)
        if (list.length > 0) {
          setSelectedCustomerId(list[0].id)
        }
      })
      .catch((err) => {
        setCustomers([])
        setCustomersError(extractSafeErrorMessage(err, 'Failed to load customer accounts.'))
      })
  }, [])

  // Load saved prompts
  useEffect(() => {
    promptsApi
      .list({ isActive: true })
      .then((data) => {
        setPrompts(data || [])
        setPromptsError(null)
      })
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err instanceof Error ? err.message : 'Could not load custom prompts.')
        setPromptsError(typeof msg === 'string' ? msg : 'Could not load custom prompts.')
      })
  }, [])

  // Filter prompt templates strictly by selected call type to prevent dispute prompts on collection calls
  const matchingPrompts = useMemo(() => {
    return prompts.filter((p) => isPromptCompatibleWithCallType(p.category, callType))
  }, [prompts, callType])

  // Deselect prompt if call type switches and selected prompt is incompatible
  useEffect(() => {
    if (selectedPromptId) {
      const stillValid = matchingPrompts.some((p) => p.id === selectedPromptId)
      if (!stillValid) {
        setSelectedPromptId('')
      }
    }
  }, [callType, matchingPrompts, selectedPromptId])

  useEffect(() => {
    if (status === 'active') {
      if (!callStartTimeRef.current) {
        callStartTimeRef.current = Date.now()
      }
      timerRef.current = setInterval(() => {
        if (callStartTimeRef.current) {
          const elapsed = Math.max(0, Math.floor((Date.now() - callStartTimeRef.current) / 1000))
          setDuration(elapsed)
          durationRef.current = elapsed
        } else {
          setDuration((prev) => {
            const next = prev + 1
            durationRef.current = next
            return next
          })
        }
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

  function cleanupRecognition() {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    if (recognitionInstanceRef.current) {
      try {
        const rec = recognitionInstanceRef.current
        recognitionInstanceRef.current = null
        rec.onstart = null
        rec.onend = null
        rec.onerror = null
        rec.onresult = null
        rec.abort()
      } catch (_) {}
    }
    setIsListening(false)
  }

  function startListeningSession() {
    // Only listen if call session is active and agent is NOT speaking and NOT processing a turn
    if (statusRef.current !== 'active' || isSpeakingRef.current || isProcessingRef.current) {
      setIsListening(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not available in this browser')
      return
    }

    cleanupRecognition()

    try {
      const recognition = new SpeechRecognition()
      recognitionInstanceRef.current = recognition
      // Single-turn mode per listening cycle ensures Chrome never hits the 60s continuous stream limit
      // and never accumulates stale results across long 12+ turn conversations.
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-IN'

      recognition.onstart = () => {
        if (statusRef.current === 'active' && !isSpeakingRef.current && !isProcessingRef.current) {
          setIsListening(true)
        } else {
          try { recognition.abort() } catch (_) {}
        }
      }

      recognition.onresult = (event: any) => {
        if (statusRef.current !== 'active' || isProcessingRef.current || isSpeakingRef.current) {
          return
        }

        const lastIdx = event.results.length - 1
        const result = event.results[lastIdx]
        const userSpeech = result && result[0] ? result[0].transcript.trim() : ''

        if (userSpeech && userSpeech !== lastProcessedTranscriptRef.current) {
          lastProcessedTranscriptRef.current = userSpeech

          // Abort recognition immediately so no duplicate result events fire for this turn
          try {
            recognition.abort()
          } catch (_) {}
          cleanupRecognition()

          const timeStr = getElapsedTimestamp()
          setTranscript((prev) => [
            ...prev,
            { speaker: 'customer', text: userSpeech, time: timeStr },
          ])
          handleAgentReply(userSpeech, currentStageRef.current)
        }
      }

      recognition.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event.error)
        if (event.error === 'not-allowed') {
          setMicActive(false)
          setIsListening(false)
          setTranscript((prev) => [
            ...prev,
            {
              speaker: 'system',
              text: 'ℹ️ Microphone permission was not granted. You can still speak or type your responses in the text input below.',
              time: getElapsedTimestamp(),
            },
          ])
          return
        }
        // 'no-speech' and 'aborted' are normal lifecycle transitions during conversational pauses
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionInstanceRef.current = null

        // Restart fresh recognition cycle if the call is still active and agent isn't talking or processing
        if (statusRef.current === 'active' && !isSpeakingRef.current && !isProcessingRef.current) {
          if (!restartTimerRef.current) {
            restartTimerRef.current = setTimeout(() => {
              restartTimerRef.current = null
              startListeningSession()
            }, 250)
          }
        }
      }

      recognition.start()
    } catch (err: any) {
      console.warn('SpeechRecognition start failed:', err)
      setIsListening(false)
      if (statusRef.current === 'active' && !isSpeakingRef.current && !isProcessingRef.current) {
        if (!restartTimerRef.current) {
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null
            startListeningSession()
          }, 500)
        }
      }
    }
  }

  function stopMediaStream() {
    cleanupRecognition()
    isSpeakingRef.current = false
    isProcessingRef.current = false
    lastProcessedTranscriptRef.current = ''

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch (_) {}
      mediaRecorderRef.current = null
    }
    if (roomRef.current) {
      roomRef.current.disconnect()
      roomRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    chotuGainRef.current = null
    customerGainRef.current = null
    masterBusRef.current = null
    recordingDestinationRef.current = null

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setMicActive(false)
    setIsListening(false)
    setAudioLevel(0)
  }

  const customerList = Array.isArray(customers) ? customers : []
  const selectedCustomer = customerList.find((c) => c.id === selectedCustomerId)

  async function speakText(text: string, onEnded?: () => void) {
    if (!text) {
      onEnded?.()
      return
    }

    isSpeakingRef.current = true
    setIsListening(false)
    cleanupRecognition()

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      isSpeakingRef.current = false
      onEnded?.()
    }

    // Cancel any active SpeechSynthesis utterance to prevent overlapping
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch (_) {}
    }

    const audioCtx = audioContextRef.current
    const chotuGain = chotuGainRef.current

    // If AudioContext and Chotu gain node are active, route speech directly through the balanced Web Audio graph
    if (audioCtx && chotuGain && audioCtx.state !== 'closed') {
      try {
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume()
        }
        const audioArrayBuffer = await voiceApi.synthesize(text)
        if (audioArrayBuffer && audioArrayBuffer.byteLength > 0) {
          const decodedBuffer = await audioCtx.decodeAudioData(audioArrayBuffer.slice(0))
          const sourceNode = audioCtx.createBufferSource()
          sourceNode.buffer = decodedBuffer
          sourceNode.connect(chotuGain)

          const durationMs = (decodedBuffer.duration || 3) * 1000
          const fallbackTimer = setTimeout(finish, durationMs + 600)

          sourceNode.onended = () => {
            clearTimeout(fallbackTimer)
            finish()
          }

          sourceNode.start()
          return
        }
      } catch (synthErr) {
        console.warn('Backend TTS playback fallback to window.speechSynthesis:', synthErr)
      }
    }

    // Graceful fallback to browser SpeechSynthesis with locked voice profile
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      const profile = sessionVoiceProfileRef.current || resolveSessionVoice()
      if (profile.fallbackVoice) {
        utterance.voice = profile.fallbackVoice
      }
      utterance.lang = profile.lang || 'en-IN'
      utterance.rate = 0.95
      utterance.pitch = 1.05

      const approxDurationMs = Math.max(2000, text.length * 85)
      const fallbackTimer = setTimeout(finish, approxDurationMs + 1000)

      utterance.onend = () => {
        clearTimeout(fallbackTimer)
        finish()
      }
      utterance.onerror = () => {
        clearTimeout(fallbackTimer)
        finish()
      }

      window.speechSynthesis.speak(utterance)
      return
    }

    // If no synthesis engine is supported, proceed after 1s
    setTimeout(finish, 1000)
  }

  // Multi-turn 10-stage handler via backend API
  async function handleAgentReply(userUtterance: string, stageAtTimeOfInput: ConversationStage) {
    isProcessingRef.current = true
    setIsListening(false)
    cleanupRecognition()

    try {
      const res = await voiceApi.processTurn({
        userSpeech: userUtterance,
        currentStage: stageAtTimeOfInput,
        customerId: selectedCustomerId || undefined,
        promptId: selectedPromptId || undefined,
        sessionId,
        extractedData: extractedDataRef.current,
        turnCount: turnCountRef.current,
      })

      setCurrentStage(res.nextStage)
      currentStageRef.current = res.nextStage
      setExtractedData(res.extractedData || {})
      extractedDataRef.current = res.extractedData || {}
      setTurnCount((prev) => prev + 1)
      turnCountRef.current = turnCountRef.current + 1

      if (res.outcome) {
        const raw = res.outcome as string
        if (raw === 'PROMISE_TO_PAY') updateOutcome('PROMISE_TO_PAY')
        else if (raw === 'WILL_PAY_LATER') updateOutcome('WILL_PAY_LATER')
        else if (raw === 'UNABLE_TO_PAY' || raw === 'HARDSHIP_ACKNOWLEDGED') updateOutcome('UNABLE_TO_PAY')
        else if (raw === 'CALLBACK_REQUESTED') updateOutcome('CALLBACK_REQUESTED')
        else if (raw === 'PAYMENT_CLAIMED') updateOutcome('PAYMENT_CLAIMED')
        else if (raw === 'DISPUTE') updateOutcome('DISPUTE')
        else if (raw === 'NO_CONTACT' || raw === 'WRONG_CONTACT') updateOutcome('NO_CONTACT')
        else if (raw === 'RESOLVED') updateOutcome('RESOLVED')
        else if (raw === 'TRANSFERRED_TO_AGENT') updateOutcome('OTHER')
        else if (raw === 'OTHER') updateOutcome('OTHER')
      }

      const timeStr = getElapsedTimestamp()
      setTranscript((prev) => [
        ...prev,
        { speaker: 'agent', text: res.reply, time: timeStr },
      ])

      isProcessingRef.current = false

      await speakText(res.reply, () => {
        lastProcessedTranscriptRef.current = '' // Reset deduplicator for next turn

        if (statusRef.current === 'active') {
          // Auto-end if stage is terminal or outcome is NO_CONTACT / TRANSFERRED_TO_AGENT
          if (res.shouldEnd && (res.nextStage === 'CALL_ENDED' || res.outcome === 'NO_CONTACT' || res.outcome === 'TRANSFERRED_TO_AGENT')) {
            handleEnd()
          } else {
            // Fresh recognition session ready for customer's next turn!
            startListeningSession()
          }
        }
      })
    } catch (err: any) {
      isProcessingRef.current = false
      console.error('Error in agent turn:', err)
      const fallbackReply = `I apologize, I didn't catch that clearly. Could you please repeat that?`
      const timeStr = getElapsedTimestamp()
      setTranscript((prev) => [
        ...prev,
        { speaker: 'agent', text: fallbackReply, time: timeStr },
      ])
      await speakText(fallbackReply, () => {
        lastProcessedTranscriptRef.current = ''
        if (statusRef.current === 'active') {
          startListeningSession()
        }
      })
    }
  }

  async function startMicrophone() {
    try {
      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mediaStreamRef.current = stream
        setMicActive(true)
      } catch (micErr) {
        console.warn('Microphone permission not granted or no audio device:', micErr)
        setMicActive(false)
      }

      // Audio analysis for live visual pulse and balanced audio destination for recording
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      let recordingStream: MediaStream | null = stream

      if (AudioCtx) {
        const audioCtx = new AudioCtx()
        audioContextRef.current = audioCtx
        const destination = audioCtx.createMediaStreamDestination()
        recordingDestinationRef.current = destination

        // Master mix bus
        const masterBus = audioCtx.createGain()
        masterBus.gain.value = 1.0
        masterBusRef.current = masterBus

        // Brickwall limiter / DynamicsCompressorNode to prevent clipping, distortion, and double amplification
        const limiter = audioCtx.createDynamicsCompressor()
        limiter.threshold.value = -3.0 // dB
        limiter.knee.value = 3.0
        limiter.ratio.value = 20.0 // brickwall peak limiting
        limiter.attack.value = 0.003 // 3ms
        limiter.release.value = 0.100 // 100ms

        masterBus.connect(limiter)
        limiter.connect(destination)

        // Chotu AI Gain Node (1.85 = +5.3 dB boost for presence and audibility)
        const chotuGain = audioCtx.createGain()
        chotuGain.gain.value = 1.85
        chotuGainRef.current = chotuGain
        // Route Chotu to both recording mix bus and user speakers
        chotuGain.connect(masterBus)
        chotuGain.connect(audioCtx.destination)

        // Customer Mic Gain Node (0.85 = -1.4 dB for headroom)
        const customerGain = audioCtx.createGain()
        customerGain.gain.value = 0.85
        customerGainRef.current = customerGain
        // Route Customer mic ONLY to the recording mix bus (NEVER to audioCtx.destination, preventing speaker feedback loop)
        customerGain.connect(masterBus)

        if (stream) {
          const micSource = audioCtx.createMediaStreamSource(stream)
          micSource.connect(customerGain)

          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 64
          micSource.connect(analyser)

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
        } else {
          // Synthetic carrier so MediaRecorder produces valid audio frames even without physical mic
          const osc = audioCtx.createOscillator()
          const gain = audioCtx.createGain()
          gain.gain.value = 0.0001
          osc.connect(gain)
          gain.connect(masterBus)
          osc.start()
        }
        recordingStream = destination.stream
      }

      // Initialize MediaRecorder to capture audio for backend storage & download
      if (typeof MediaRecorder !== 'undefined' && recordingStream) {
        try {
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
              ? 'audio/webm'
              : ''
          const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream)
          recordedChunksRef.current = []
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunksRef.current.push(e.data)
            }
          }
          recorder.start(500)
          mediaRecorderRef.current = recorder
        } catch (recErr) {
          console.warn('MediaRecorder audio capture fallback:', recErr)
        }
      }
    } catch (err) {
      console.warn('Microphone access not granted or not supported:', err)
      setMicActive(false)
    }
  }

  async function handleStart() {
    updateStatus('connecting')
    callStartTimeRef.current = Date.now()
    durationRef.current = 0
    const lockedProfile = resolveSessionVoice()
    sessionVoiceProfileRef.current = lockedProfile
    setActiveVoiceName(lockedProfile.voiceName)
    setSavedSuccess(false)
    setDuration(0)
    setTranscript([])
    setCurrentStage('GREETING_AND_VERIFICATION')
    currentStageRef.current = 'GREETING_AND_VERIFICATION'
    setExtractedData({})
    extractedDataRef.current = {}
    setTurnCount(0)
    turnCountRef.current = 0
    setOutcomeUpdateMsg(null)
    setOutcomeUpdateError(null)
    setOutcomeNotes('')
    updateOutcome('OTHER')

    try {
      const tokenData = await voiceApi.getToken({
        customerId: selectedCustomerId || undefined,
      })
      setSessionToken(tokenData)
      setRecordingError(null)

      // Connect to LiveKit room if available (with graceful fallback to browser-native voice)
      if (!tokenData.isMock && tokenData.url && tokenData.token) {
        try {
          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          })
          roomRef.current = room

          // Route remote audio from Chotu AI participant into the balanced Web Audio graph
          room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
              const mediaStreamTrack = track.mediaStreamTrack
              if (mediaStreamTrack && audioContextRef.current && chotuGainRef.current) {
                try {
                  const remoteStream = new MediaStream([mediaStreamTrack])
                  const remoteSource = audioContextRef.current.createMediaStreamSource(remoteStream)
                  remoteSource.connect(chotuGainRef.current)
                  console.log('Successfully routed remote LiveKit audio track to Chotu gain node')
                } catch (routeErr) {
                  console.warn('Could not route LiveKit remote track to Web Audio graph:', routeErr)
                }
              }
            }
          })

          await room.connect(tokenData.url, tokenData.token)
          console.log('Connected to LiveKit room:', tokenData.roomName)
          
          try {
            await room.localParticipant.enableCameraAndMicrophone()
            console.log('Published local audio to room')
          } catch (pubErr) {
            console.warn('Microphone publish to room skipped:', pubErr)
          }
        } catch (livekitErr) {
          console.warn('LiveKit cloud connection skipped, running in local browser voice mode:', livekitErr)
          if (roomRef.current) {
            try {
              roomRef.current.disconnect()
            } catch (_) {}
            roomRef.current = null
          }
        }
      }

      updateStatus('active')
      const custName = selectedCustomer?.name ?? 'Customer'
      const bal = selectedCustomer?.outstandingBalance
        ? `₹${Number(selectedCustomer.outstandingBalance).toLocaleString('en-IN')}`
        : 'outstanding balance'

      // Opening Greeting: authoritative customer-facing greeting resolved from backend
      let greeting = ''
      try {
        const initData = await voiceApi.getInitialGreeting({
          callType,
          customerId: selectedCustomerId || undefined,
          promptId: selectedPromptId || undefined,
        })
        greeting = initData.greeting
        if (initData.conversationalGoal) {
          extractedDataRef.current.conversationalGoal = initData.conversationalGoal
        }
      } catch (initErr) {
        console.warn('Initial greeting resolution fallback:', initErr)
        if (callType === 'COLLECTIONS') {
          greeting = `Namaste! Am I speaking with the accounts department at ${custName}? This is Chotu from myCashFlo regarding the pending balance of ${bal}. Is this a convenient time to speak?`
        } else if (callType === 'DISPUTE') {
          greeting = `Namaste! Am I speaking with the accounts department at ${custName}? This is Chotu from myCashFlo regarding your billing query on invoice INV-CURRENT. I am here to help reconcile any discrepancies or register an official dispute for management review. Could you share the details of the issue?`
        } else {
          greeting = `Namaste! Am I speaking with ${custName}? This is Chotu from myCashFlo following up on your requested callback. Is this a convenient time to speak, or would you like me to connect you directly with a representative?`
        }
      }

      setTranscript([
        { speaker: 'system', text: `Voice session active (${tokenData.roomName})`, time: '0:00' },
        { speaker: 'agent', text: greeting, time: '0:01' },
      ])

      // Start recording the room session if LiveKit is active
      if (roomRef.current) {
        voiceApi.startRecording({ roomName: tokenData.roomName }).then((res) => {
          setEgressId(res.egressId)
          console.log(`Recording started: ${res.egressId}`)
        }).catch(err => {
          const msg = err.response?.data?.message || err.message
          console.warn('LiveKit recording skipped:', msg)
        })
      }

      // Initialize microphone and balanced Web Audio graph BEFORE speaking so greeting is captured in recording
      try {
        await startMicrophone()
      } catch (micErr) {
        console.warn('Microphone initialization fallback:', micErr)
        setMicActive(false)
      }
      speakText(greeting, () => {
        if (statusRef.current === 'active') {
          startListeningSession()
        }
      })
    } catch (err) {
      console.error('Failed to start voice session:', err)
      updateStatus('error')
    }
  }

  async function handleEnd() {
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }

    const recorder = mediaRecorderRef.current
    const recorderMimeType = recorder?.mimeType || 'audio/webm'

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        try {
          if (recorder.state === 'recording') {
            recorder.requestData()
          }
          recorder.stop()
        } catch {
          resolve()
        }
      })
    }

    stopMediaStream()
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setRecordingStatus('saving')
    updateStatus('completed')
    const elapsedFromStart = callStartTimeRef.current
      ? Math.max(1, Math.round((Date.now() - callStartTimeRef.current) / 1000))
      : Math.max(1, durationRef.current || duration)
    const finalDuration = elapsedFromStart
    const custName = selectedCustomer?.name ?? 'Customer'
    const finalOutcome = outcomeRef.current

    let structured: StructuredCallSummary | null = null
    try {
      structured = await voiceApi.generateSummary({
        customerName: custName,
        customerId: selectedCustomerId || undefined,
        invoiceNumber: extractedData.invoiceNumber,
        durationSeconds: finalDuration,
        callType,
        outcome: finalOutcome,
        context: extractedData,
        transcript,
      })
      setStructuredSummary(structured)
    } catch (sumErr) {
      console.warn('Summary generation fallback:', sumErr)
    }

    if (structured?.outcomeCategory) {
      updateOutcome(structured.outcomeCategory as CallOutcome)
    }
    const resolvedOutcome = (structured?.outcomeCategory || finalOutcome) as CallOutcome

    const summaryText = structured?.shortSummary || `Chotu AI call with ${custName}. Final Stage: ${currentStage}. Total duration: ${formatSec(finalDuration)}.`
    setCallSummary(summaryText)

    // Stop recording if active
    if (egressId) {
      voiceApi.stopRecording({ egressId }).catch(err => {
        console.warn('Failed to stop recording:', err)
      })
    }

    try {
      const created = await callsApi.create({
        customerId: selectedCustomerId || undefined,
        duration: finalDuration,
        outcome: resolvedOutcome,
        stage: currentStage,
        metadata: {
          structuredSummary: structured,
          extractedData,
          callType,
        },
        livekitRoom: sessionToken?.roomName,
        recordingEgressId: egressId,
        summary: summaryText,
        transcript: transcript.map((m) => `[${m.speaker.toUpperCase()}]: ${m.text}`).join('\n'),
      })
      if (created && (created as any).id) {
        const newSessionId = (created as any).id
        setSessionId(newSessionId)
        setPersistedOutcome(((created as any).outcome || resolvedOutcome) as CallOutcome)

        // Upload client-recorded audio blob to backend via multipart FormData
        if (recordedChunksRef.current && recordedChunksRef.current.length > 0) {
          const audioBlob = new Blob(recordedChunksRef.current, { type: recorderMimeType })
          pendingAudioBlobRef.current = audioBlob
          try {
            await callsApi.uploadRecording(newSessionId, audioBlob)
            setRecordingAvailable(true)
            setRecordingStatus('saved')
            setRecordingError(null)
            pendingAudioBlobRef.current = null
            console.log('Call audio recording successfully stored on server for call session:', newSessionId)
          } catch (uploadErr: any) {
            const errMsg = uploadErr?.response?.data?.message || uploadErr?.message || 'Upload failed'
            console.error('Could not upload client audio recording to server:', errMsg)
            setRecordingStatus('failed')
            setRecordingError(`Recording upload failed: ${errMsg}`)
          }
        } else {
          setRecordingStatus('idle')
        }
      }
      setSavedSuccess(true)
    } catch (err) {
      console.error('Failed to save call session', err)
    }
  }

  async function handleSaveOutcome() {
    if (!sessionId) return
    setIsUpdatingOutcome(true)
    setOutcomeUpdateMsg(null)
    setOutcomeUpdateError(null)

    if (outcome === 'PROMISE_TO_PAY') {
      const commitmentStatus = structuredSummary?.paymentCommitment || extractedData?.commitmentStatus
      if (commitmentStatus !== 'CONFIRMED' && (!outcomeNotes || outcomeNotes.trim().length < 5)) {
        setIsUpdatingOutcome(false)
        setOutcomeUpdateError('To set outcome to Promise to Pay, please provide notes explaining the customer commitment.')
        return
      }
    }

    try {
      await callsApi.updateOutcome(sessionId, outcome, outcomeNotes || undefined)
      setPersistedOutcome(outcome)
      setOutcomeUpdateMsg(`Outcome successfully updated to ${outcome}!`)
      setTimeout(() => setOutcomeUpdateMsg(null), 3500)
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to update call outcome'
      setOutcomeUpdateError(msg)
    } finally {
      setIsUpdatingOutcome(false)
    }
  }

  async function handleRetryUpload() {
    if (!sessionId || !pendingAudioBlobRef.current) return
    setIsRetryingUpload(true)
    setRecordingStatus('saving')
    try {
      await callsApi.uploadRecording(sessionId, pendingAudioBlobRef.current)
      setRecordingAvailable(true)
      setRecordingStatus('saved')
      setRecordingError(null)
      pendingAudioBlobRef.current = null
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || err?.message || 'Upload retry failed'
      setRecordingStatus('failed')
      setRecordingError(`Recording upload failed: ${errMsg}`)
    } finally {
      setIsRetryingUpload(false)
    }
  }

  function handleReset() {
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }
    stopMediaStream()
    updateStatus('idle')
    callStartTimeRef.current = null
    durationRef.current = 0
    setDuration(0)
    setTranscript([])
    setSavedSuccess(false)
    setStructuredSummary(null)
    setRecordingStatus('idle')
    setRecordingError(null)
    pendingAudioBlobRef.current = null
    setCurrentStage('GREETING_AND_VERIFICATION')
    currentStageRef.current = 'GREETING_AND_VERIFICATION'
    setExtractedData({})
    extractedDataRef.current = {}
    setTurnCount(0)
    turnCountRef.current = 0
    setEgressId(undefined)
    setOutcomeUpdateMsg(null)
    setOutcomeUpdateError(null)
    setOutcomeNotes('')
    setPersistedOutcome('OTHER')
    updateOutcome('OTHER')
  }

  function handleSendManualMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!manualInput.trim()) return
    const text = manualInput.trim()
    setManualInput('')
    cleanupRecognition()
    lastProcessedTranscriptRef.current = text
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }
    const timeStr = getElapsedTimestamp()
    setTranscript((prev) => [
      ...prev,
      { speaker: 'customer', text, time: timeStr },
    ])
    handleAgentReply(text, currentStageRef.current)
  }

  const handleCancelDelivery = async (requestId: string) => {
    setDeliveryActionError(null)
    try {
      setIsCancellingDelivery(true)
      const updated = await voiceApi.cancelDocumentDelivery(requestId)
      setExtractedData((prev) => ({
        ...prev,
        documentDelivery: {
          ...prev.documentDelivery,
          status: updated.status,
        },
      }))
      toast.info('Document delivery request cancelled.')
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to cancel document delivery request.')
      setDeliveryActionError(msg)
      toast.error(msg)
    } finally {
      setIsCancellingDelivery(false)
    }
  }

  const handleRetryDelivery = async () => {
    const doc = extractedData.documentDelivery
    if (!doc || !selectedCustomerId) return
    setDeliveryActionError(null)
    try {
      setIsRetryingDelivery(true)
      const res = await voiceApi.requestDocumentDelivery({
        customerId: selectedCustomerId,
        invoiceId: doc.invoiceId,
        callSessionId: sessionId,
        requestType: doc.requestType,
        deliveryChannel: doc.deliveryChannel,
        resend: true,
        requestedBy: 'CUSTOMER_VOICE_RETRY',
      })
      setExtractedData((prev) => ({
        ...prev,
        documentDelivery: {
          ...prev.documentDelivery,
          requestId: res.request.id,
          status: res.request.status,
          attempts: res.request.attempts?.map((a) => ({
            channel: a.channel,
            destinationMasked: a.destinationMasked,
            status: a.status,
            provider: a.provider,
            errorMessage: a.errorMessage,
          })),
        },
      }))
      toast.success('Document delivery retry initiated.')
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to retry document delivery.')
      setDeliveryActionError(msg)
      toast.error(msg)
    } finally {
      setIsRetryingDelivery(false)
    }
  }

  const handleCopyPaymentLink = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedPaymentLink(true)
    setTimeout(() => setCopiedPaymentLink(false), 2000)
  }

  function getChannelStatusBadge(status?: string) {
    switch (status) {
      case 'SIMULATED':
        return { bg: 'bg-amber-950/80', border: 'border-amber-700/60', text: 'text-amber-300', icon: '🧪', label: 'Simulated' }
      case 'DELIVERED':
        return { bg: 'bg-emerald-950/80', border: 'border-emerald-700/60', text: 'text-emerald-300', icon: '✓', label: 'Delivered' }
      case 'SENT':
        return { bg: 'bg-sky-950/80', border: 'border-sky-700/60', text: 'text-sky-300', icon: '↗', label: 'Sent' }
      case 'PENDING':
      case 'QUEUED':
        return { bg: 'bg-indigo-950/80', border: 'border-indigo-700/60', text: 'text-indigo-300', icon: '⏳', label: 'Queued' }
      case 'FAILED':
        return { bg: 'bg-rose-950/80', border: 'border-rose-700/60', text: 'text-rose-300', icon: '❌', label: 'Failed' }
      case 'SUPPRESSED':
        return { bg: 'bg-purple-950/80', border: 'border-purple-700/60', text: 'text-purple-300', icon: '🛡️', label: 'Suppressed' }
      case 'SKIPPED':
        return { bg: 'bg-slate-800/80', border: 'border-slate-700', text: 'text-slate-400', icon: '—', label: 'Skipped' }
      default:
        return { bg: 'bg-slate-800/80', border: 'border-slate-700', text: 'text-slate-400', icon: '•', label: status || 'Pending' }
    }
  }

  function getDeliveryOverallStatusBadge(status?: string) {
    switch (status) {
      case 'COMPLETED':
        return { bg: 'bg-emerald-950', border: 'border-emerald-700', text: 'text-emerald-300', label: 'Completed' }
      case 'PARTIAL_SUCCESS':
        return { bg: 'bg-amber-950', border: 'border-amber-700', text: 'text-amber-300', label: 'Partial Success' }
      case 'FAILED':
        return { bg: 'bg-rose-950', border: 'border-rose-700', text: 'text-rose-300', label: 'Failed' }
      case 'SUPPRESSED':
        return { bg: 'bg-purple-950', border: 'border-purple-700', text: 'text-purple-300', label: 'Suppressed' }
      case 'CANCELLED':
        return { bg: 'bg-slate-800', border: 'border-slate-700', text: 'text-slate-400', label: 'Cancelled' }
      case 'PROCESSING':
        return { bg: 'bg-sky-950', border: 'border-sky-700', text: 'text-sky-300', label: 'Processing' }
      case 'PENDING':
      default:
        return { bg: 'bg-indigo-950', border: 'border-indigo-700', text: 'text-indigo-300', label: 'Queued' }
    }
  }

  function formatRequestType(type?: string) {
    if (type === 'BOTH') return 'Invoice & Payment Link'
    if (type === 'PAYMENT_LINK') return 'Payment Link'
    if (type === 'INVOICE') return 'Invoice Copy'
    return type || 'Document'
  }

  const currentStepObj = STAGES.find((s) => s.id === currentStage)
  const token = typeof window !== 'undefined' ? localStorage.getItem('mcf_access_token') || localStorage.getItem('token') || '' : ''

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Chotu AI Voice Assistant"
        subtitle="Configurable 10-stage structured collection conversation engine with LiveKit room and speech synthesis"
      />

      {/* Target Customer, Call Purpose & Prompt Selection Card */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Target Customer Account</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              disabled={status === 'active' || status === 'connecting' || customerList.length === 0}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              {customerList.length > 0 ? (
                customerList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — ₹{Number(c.outstandingBalance || 0).toLocaleString('en-IN')} overdue
                  </option>
                ))
              ) : (
                <option value="">No customer accounts found</option>
              )}
            </select>
            {customersError && (
              <p role="alert" className="text-[11px] text-rose-400 mt-1">
                ⚠️ {customersError}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Call Purpose / Call Type</label>
            <select
              value={callType}
              onChange={(e) => setCallType(e.target.value as CallType)}
              disabled={status === 'active' || status === 'connecting'}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="COLLECTIONS">Collections / Payment Follow-up</option>
              <option value="DISPUTE">Invoice Dispute / Reconciliation</option>
              <option value="CALLBACK">Callback / Human Handoff</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Voice Prompt Template ({callType})
            </label>
            <select
              value={selectedPromptId}
              onChange={(e) => setSelectedPromptId(e.target.value)}
              disabled={status === 'active' || status === 'connecting'}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Standard Flow ({callType})</option>
              {matchingPrompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category})
                </option>
              ))}
            </select>
            {promptsError && (
              <p className="mt-1 text-[11px] text-amber-400" role="alert">
                Custom prompts unavailable ({promptsError}). Standard flow remains active.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 10-Stage Progressive Flow Visualizer */}
      {(status === 'active' || status === 'completed') && (
        <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Collection Stage: {currentStepObj?.label || currentStage}
            </span>
            <span className="text-xs px-2 py-0.5 rounded font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
              Turn {turnCount}
            </span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {STAGES.map((s) => {
              const isActiveStage = currentStage === s.id
              const isPastStage = currentStepObj ? s.step < currentStepObj.step : false
              return (
                <div
                  key={s.id}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold whitespace-nowrap transition-all ${
                    isActiveStage
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30 ring-1 ring-indigo-400'
                      : isPastStage
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                      : 'bg-slate-900/60 text-slate-500 border border-slate-800'
                  }`}
                >
                  {isPastStage ? '✓ ' : ''}{s.label}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Voice Interface */}
      <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Agent Avatar */}
        <div className="flex items-center justify-center mb-6">
          <div
            className="flex items-center justify-center rounded-full text-5xl transition-all duration-100"
            style={{
              width: 120,
              height: 120,
              transform: status === 'active' ? `scale(${1.0 + audioLevel / 300})` : 'scale(1)',
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
          {status === 'idle' && 'Ready to connect structured multi-stage call with audio synthesis and live transcript'}
          {status === 'connecting' && 'Negotiating LiveKit room session token…'}
          {status === 'active' && `Call in progress (${formatSec(duration)})`}
          {status === 'completed' && 'Call completed — commitment and transcript logged'}
          {status === 'error' && 'Connection failed — please retry'}
        </p>

        {/* Live Status Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-slate-300">{status === 'active' ? 'Room Active' : 'Standby'}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className="text-slate-400">🎙️ Mic:</span>
            <span className={micActive ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
              {micActive ? `Active (${audioLevel}%)` : 'Ready'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className="text-slate-400">🗣️ Engine:</span>
            <span className={isListening ? 'text-indigo-400 font-semibold animate-pulse' : 'text-slate-400'}>
              {isListening ? 'Listening' : 'Ready'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-700">
            <span className="text-slate-400">🔊 Voice:</span>
            <span className="text-indigo-300 font-semibold">{activeVoiceName}</span>
          </div>
        </div>

        {/* Controls */}
        {status === 'idle' || status === 'error' ? (
          <button
            onClick={handleStart}
            className="px-8 py-3 rounded-xl text-white font-semibold text-sm cursor-pointer transition-all duration-150"
            style={{ background: 'var(--primary)', border: 'none' }}
          >
            🎙️ Start Structured Voice Session
          </button>
        ) : status === 'active' ? (
          <button
            onClick={handleEnd}
            className="px-8 py-3 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-150"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            ⏹ End & Save Call Session
          </button>
        ) : status === 'completed' ? (
          <div className="flex flex-wrap justify-center items-center gap-3">
            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl font-semibold text-xs cursor-pointer text-white"
              style={{ background: 'var(--primary)', border: 'none' }}
            >
              Start New Call
            </button>
            {(recordingAvailable || recordingStatus === 'saved') && sessionId && (
              <button
                onClick={() => callsApi.downloadRecording(sessionId, 'call')}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs cursor-pointer flex items-center gap-1.5"
                style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', border: '1px solid var(--border)' }}
              >
                <span>🎙️</span> Download Call Recording (.webm)
              </button>
            )}
            {recordingStatus === 'failed' && pendingAudioBlobRef.current && (
              <button
                onClick={handleRetryUpload}
                disabled={isRetryingUpload}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs cursor-pointer flex items-center gap-1.5 bg-rose-600 text-white hover:bg-rose-500"
              >
                <span>🔄</span> {isRetryingUpload ? 'Retrying...' : 'Retry Upload Recording'}
              </button>
            )}
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

        {/* Live Document Delivery Panel */}
        {extractedData.documentDelivery && (
          <div className="mt-5 p-4 rounded-xl text-left bg-slate-900 border border-indigo-700/60 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">📄</span>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Customer Document Delivery Request
                </h4>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {formatRequestType(extractedData.documentDelivery.requestType)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Simulation Badge */}
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/90 text-amber-300 border border-amber-700/70 flex items-center gap-1">
                  <span>🧪</span> Simulation Mode (No real message sent)
                </span>
                {/* Overall Status */}
                {(() => {
                  const st = getDeliveryOverallStatusBadge(extractedData.documentDelivery.status)
                  return (
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${st.bg} ${st.border} ${st.text} border`}>
                      {st.label}
                    </span>
                  )
                })()}
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
              <div>
                <span className="text-slate-400 block text-[11px]">Customer:</span>
                <span className="text-white font-medium">{selectedCustomer?.name || extractedData.customerName || 'Customer'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Invoice Number:</span>
                <span className="text-white font-mono font-medium">{extractedData.documentDelivery.invoiceNumber || 'INV-CURRENT'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Outstanding Balance:</span>
                <span className="text-rose-400 font-semibold font-mono">
                  {extractedData.documentDelivery.outstanding ? `₹${Number(extractedData.documentDelivery.outstanding).toLocaleString('en-IN')}` : '₹25,000'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Requested Channels:</span>
                <span className="text-slate-200 font-medium">
                  {extractedData.documentDelivery.deliveryChannel === 'WHATSAPP_AND_EMAIL'
                    ? 'WhatsApp & Email'
                    : extractedData.documentDelivery.deliveryChannel === 'EMAIL'
                    ? 'Email Only'
                    : 'WhatsApp Only'}
                </span>
              </div>
            </div>

            {/* Channel Delivery Statuses */}
            <div className="p-2.5 rounded-lg bg-black/40 border border-slate-800 space-y-2 mb-3">
              <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Channel Delivery Status
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* WhatsApp Channel */}
                {(() => {
                  const waAttempt = extractedData.documentDelivery.attempts?.find((a: any) => a.channel === 'WHATSAPP')
                  const isRequested = extractedData.documentDelivery.deliveryChannel !== 'EMAIL'
                  const status = waAttempt?.status || (isRequested ? (extractedData.documentDelivery.status === 'COMPLETED' ? 'SIMULATED' : 'PENDING') : 'SKIPPED')
                  const badge = getChannelStatusBadge(status)
                  return (
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">💬 WhatsApp</span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {waAttempt?.destinationMasked || selectedCustomer?.phone || '+91 ****3210'}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 ${badge.bg} ${badge.border} ${badge.text}`}>
                        <span>{badge.icon}</span> {badge.label}
                      </span>
                    </div>
                  )
                })()}

                {/* Email Channel */}
                {(() => {
                  const emailAttempt = extractedData.documentDelivery.attempts?.find((a: any) => a.channel === 'EMAIL')
                  const isRequested = extractedData.documentDelivery.deliveryChannel !== 'WHATSAPP'
                  const status = emailAttempt?.status || (isRequested ? (extractedData.documentDelivery.status === 'COMPLETED' ? 'SIMULATED' : 'PENDING') : 'SKIPPED')
                  const badge = getChannelStatusBadge(status)
                  return (
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sky-400 font-bold">✉️ Email</span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {emailAttempt?.destinationMasked || selectedCustomer?.email || 'c****@domain.com'}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 ${badge.bg} ${badge.border} ${badge.text}`}>
                        <span>{badge.icon}</span> {badge.label}
                      </span>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Actions: Cancel if in-flight, Retry if failed */}
            {deliveryActionError && (
              <div role="alert" className="p-2 rounded text-xs bg-rose-950/50 border border-rose-800 text-rose-300">
                ⚠️ {deliveryActionError}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between pt-1 text-xs gap-2">
              <div className="text-[11px] text-slate-400">
                {extractedData.documentDelivery.status === 'CANCELLED' ? (
                  <span className="text-slate-400 italic">Request was cancelled per customer instruction.</span>
                ) : extractedData.documentDelivery.status === 'COMPLETED' ? (
                  <span className="text-emerald-400">✓ Delivery simulation dispatched for active session.</span>
                ) : (
                  <span>Dispatched via Chotu conversational engine.</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {(extractedData.documentDelivery.status === 'PENDING' || extractedData.documentDelivery.status === 'PROCESSING') && extractedData.documentDelivery.requestId && (
                  <button
                    onClick={() => handleCancelDelivery(extractedData.documentDelivery.requestId)}
                    disabled={isCancellingDelivery}
                    className="px-2.5 py-1 rounded text-xs font-semibold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 cursor-pointer disabled:opacity-50"
                  >
                    {isCancellingDelivery ? 'Cancelling...' : 'Cancel Request'}
                  </button>
                )}

                {(extractedData.documentDelivery.status === 'FAILED' || extractedData.documentDelivery.status === 'PARTIAL_SUCCESS' || extractedData.documentDelivery.attempts?.some((a: any) => a.status === 'FAILED')) && (
                  <button
                    onClick={handleRetryDelivery}
                    disabled={isRetryingDelivery}
                    className="px-2.5 py-1 rounded text-xs font-semibold bg-amber-900/80 hover:bg-amber-800 text-amber-200 border border-amber-700 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                  >
                    <span>🔄</span> {isRetryingDelivery ? 'Retrying...' : 'Retry Failed Channel'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recording Status & In-Page Audio Player */}
        {status === 'completed' && sessionId && (
          <div className="mt-5 p-4 rounded-xl text-left bg-slate-900 border border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">Call Audio Recording:</span>
                {recordingStatus === 'saved' || recordingAvailable ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                    <span>✓</span> Saved & Available
                  </span>
                ) : recordingStatus === 'saving' ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                    <span>⏳</span> Saving to Server...
                  </span>
                ) : recordingStatus === 'failed' ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950 text-rose-400 border border-rose-800 flex items-center gap-1">
                    <span>⚠️</span> Upload Failed
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Processing</span>
                )}
              </div>

              {(recordingStatus === 'saved' || recordingAvailable) && (
                <button
                  onClick={() => callsApi.downloadRecording(sessionId, 'call')}
                  className="px-2.5 py-1 rounded text-xs font-medium text-indigo-300 hover:text-white bg-indigo-950/80 border border-indigo-800 flex items-center gap-1"
                >
                  <span>📥</span> Download
                </button>
              )}
            </div>

            {(recordingStatus === 'saved' || recordingAvailable) && (
              <div className="mt-2 p-1.5 rounded bg-black/40 border border-slate-700">
                <audio
                  controls
                  className="w-full h-8 rounded"
                  src={`/api/calls/${sessionId}/recording/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`}
                >
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}

            {recordingError && (
              <div className="mt-2 text-xs text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-800 flex items-center justify-between">
                <span>{recordingError}</span>
                {pendingAudioBlobRef.current && (
                  <button
                    onClick={handleRetryUpload}
                    disabled={isRetryingUpload}
                    className="ml-2 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-700 text-white"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Structured Post-Call Summary Card */}
        {status === 'completed' && structuredSummary && (
          <div className="mt-6 p-5 rounded-xl text-left bg-slate-900 border border-indigo-900/60 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📋</span> Structured Call Summary
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {structuredSummary.callType}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {structuredSummary.outcomeCategory}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-4">
              <div className="space-y-2">
                <div>
                  <span className="text-slate-400">Customer & Invoice:</span>
                  <div className="text-white font-medium">{structuredSummary.customerName} ({structuredSummary.invoiceNumber})</div>
                </div>
                <div>
                  <span className="text-slate-400">Duration & Time:</span>
                  <div className="text-white font-mono">{structuredSummary.formattedDuration} • {new Date(structuredSummary.callDateTime).toLocaleTimeString()}</div>
                </div>
                <div>
                  <span className="text-slate-400">Reason for Call:</span>
                  <div className="text-slate-200">{structuredSummary.reasonForCall}</div>
                </div>
                <div>
                  <span className="text-slate-400">Customer Main Response:</span>
                  <div className="text-slate-100 font-medium italic bg-slate-950/60 p-2 rounded border border-slate-800">
                    "{structuredSummary.customerMainResponse}"
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-slate-400">Payment Commitment:</span>
                  <div>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold mt-0.5 ${
                        structuredSummary.paymentCommitment === 'CONFIRMED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : structuredSummary.paymentCommitment === 'TENTATIVE'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {structuredSummary.paymentCommitment}
                    </span>
                  </div>
                </div>

                {structuredSummary.paymentCommitment === 'CONFIRMED' && (
                  <div className="grid grid-cols-2 gap-2 bg-emerald-950/20 p-2 rounded border border-emerald-900/40">
                    <div>
                      <span className="text-slate-400">Promised Amount:</span>
                      <div className="text-emerald-300 font-bold">{structuredSummary.commitmentAmount}</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Remittance Date:</span>
                      <div className="text-emerald-300 font-bold">{structuredSummary.commitmentDate}</div>
                    </div>
                  </div>
                )}

                {structuredSummary.customerReportedPayment && (
                  <div className="bg-sky-950/30 p-2 rounded border border-sky-800 text-slate-200">
                    <span className="text-sky-400 font-semibold">Customer-Reported Payment:</span>
                    <div>Claimed: {structuredSummary.customerReportedPayment.claimedAmount}</div>
                    <div>UTR/Ref: {structuredSummary.customerReportedPayment.utrOrReference}</div>
                  </div>
                )}

                {structuredSummary.disputeDetails && (
                  <div className="bg-rose-950/30 p-2 rounded border border-rose-800 text-slate-200">
                    <span className="text-rose-400 font-semibold">Dispute Logged:</span>
                    <div>Reason: {structuredSummary.disputeDetails.reason}</div>
                  </div>
                )}

                {structuredSummary.callbackRequest && (
                  <div className="bg-purple-950/30 p-2 rounded border border-purple-800 text-slate-200">
                    <span className="text-purple-400 font-semibold">Callback Scheduled:</span>
                    <div>Time: {structuredSummary.callbackRequest.requestedTime}</div>
                  </div>
                )}

                <div>
                  <span className="text-slate-400">Next Action:</span>
                  <div className="text-indigo-300 font-semibold">{structuredSummary.nextAction}</div>
                </div>
              </div>
            </div>

            {/* Document Delivery Section */}
            {structuredSummary.documentDelivery && (
              <div className="mt-3 p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-900/60 pb-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-400 font-bold">📄 Document Delivery Summary</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-900 text-indigo-200 border border-indigo-700">
                      {formatRequestType(structuredSummary.documentDelivery.requestType)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                      🧪 Simulated
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700">
                      {structuredSummary.documentDelivery.status}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-[11px] mb-2">
                  <div>
                    <span className="text-slate-400">Invoice Number:</span>
                    <div className="text-white font-mono font-medium">{structuredSummary.documentDelivery.invoiceNumber}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Requested Channels:</span>
                    <div className="text-slate-200">{structuredSummary.documentDelivery.deliveryChannel}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Requested At:</span>
                    <div className="text-slate-300 font-mono">
                      {structuredSummary.documentDelivery.requestedAt ? new Date(structuredSummary.documentDelivery.requestedAt).toLocaleTimeString() : 'During Call'}
                    </div>
                  </div>
                </div>

                {/* Channel Delivery Results */}
                {structuredSummary.documentDelivery.attempts && structuredSummary.documentDelivery.attempts.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-indigo-900/40">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Delivery Attempts:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {structuredSummary.documentDelivery.attempts.map((att: any, idx: number) => {
                        const badge = getChannelStatusBadge(att.status)
                        return (
                          <div key={idx} className="p-1.5 rounded bg-slate-900/60 border border-slate-800 flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span>{att.channel === 'WHATSAPP' ? '💬' : '✉️'}</span>
                              <span className="font-semibold text-slate-300">{att.channel}</span>
                              <span className="text-slate-400 font-mono text-[10px]">({att.destinationMasked})</span>
                            </div>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${badge.bg} ${badge.border} ${badge.text}`}>
                              {badge.icon} {badge.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Payment Link Copy Button if applicable */}
                {structuredSummary.documentDelivery.paymentLinkUrl && (
                  <div className="mt-2 pt-2 border-t border-indigo-900/40 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400">Payment Link:</span>
                      <span className="font-mono text-indigo-300 truncate max-w-xs">{structuredSummary.documentDelivery.paymentLinkUrl}</span>
                    </div>
                    <button
                      onClick={() => handleCopyPaymentLink(structuredSummary.documentDelivery!.paymentLinkUrl!)}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                    >
                      {copiedPaymentLink ? '✓ Copied!' : 'Copy Link'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400">Executive Narrative:</span>
              <div className="text-slate-300 mt-0.5">{structuredSummary.shortSummary}</div>
            </div>
          </div>
        )}

        {/* Outcome Selector & Persistence */}
        {(status === 'active' || status === 'completed') && (
          <div className="mt-4 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="text-slate-400 font-medium">Call Outcome:</span>
              <select
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value as any)
                  setOutcomeUpdateError(null)
                }}
                className="px-2.5 py-1 rounded bg-slate-950 border border-slate-700 text-white text-xs font-medium"
              >
                <option value="PROMISE_TO_PAY">Promise to Pay</option>
                <option value="CALLBACK_REQUESTED">Callback Requested</option>
                <option value="DISPUTE">Dispute</option>
                <option value="NO_CONTACT">No Contact / Disconnected</option>
                <option value="RESOLVED">Resolved</option>
                <option value="OTHER">Other / Incomplete</option>
              </select>

              {status === 'completed' && sessionId && (
                <>
                  {outcome !== persistedOutcome ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                        Unsaved Edits (Persisted: {persistedOutcome})
                      </span>
                      <button
                        onClick={handleSaveOutcome}
                        disabled={isUpdatingOutcome}
                        className="px-3 py-1 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isUpdatingOutcome ? 'Saving...' : 'Save Outcome'}
                      </button>
                    </div>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                      ✓ Persisted in DB: {persistedOutcome}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Note input if agent manually overrides to PROMISE_TO_PAY */}
            {status === 'completed' && outcome === 'PROMISE_TO_PAY' && outcome !== persistedOutcome && (
              <div className="mt-2 text-left max-w-md mx-auto">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Commitment Note / Rationale (required for Promise to Pay manual override):
                </label>
                <input
                  type="text"
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  placeholder="e.g., Customer verbally agreed to transfer via NEFT by tomorrow"
                  className="w-full px-2.5 py-1 text-xs rounded bg-black/60 border border-slate-700 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {outcomeUpdateMsg && (
              <div className="mt-2 text-emerald-400 text-center font-medium">
                ✅ {outcomeUpdateMsg}
              </div>
            )}

            {outcomeUpdateError && (
              <div className="mt-2 text-rose-400 text-center font-medium">
                ⚠️ {outcomeUpdateError}
              </div>
            )}
          </div>
        )}

        {/* Success & Error Banners */}
        {savedSuccess && (
          <div className="mt-4 rounded-xl p-3 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 text-left">
            <div>✅ Call session saved and logged to Call History with outcome: <strong>{persistedOutcome}</strong></div>
            {callSummary && <div className="mt-1 text-slate-300">Summary: {callSummary}</div>}
          </div>
        )}

        {recordingError && status === 'active' && (
          <div className="mt-4 rounded-xl p-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-800 text-left">
            <div>⚠️ {recordingError}. Recordings require valid LiveKit Egress configuration.</div>
          </div>
        )}

        {/* Live Transcript Area */}
        {(status === 'active' || status === 'completed') && (
          <div className="mt-8 rounded-xl p-5 text-left text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">
                Live Conversation Transcript
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

            {/* Manual text input for testing without microphone */}
            {status === 'active' && (
              <form onSubmit={handleSendManualMessage} className="flex gap-2 pt-2 border-t border-slate-700/60">
                <input
                  type="text"
                  placeholder="Type a response to Chotu (e.g. 'Yes speaking', 'We can pay ₹25,000 today', 'By Friday via UPI')…"
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
