import { useState, useEffect, useRef } from 'react'
import { Room, Track, RemoteTrack, RoomEvent } from 'livekit-client'
import { PageHeader } from '../components/ui/PageHeader'
import { voiceApi } from '../api/voice'
import { callsApi } from '../api/calls'
import { customersApi } from '../api/customers'
import { promptsApi } from '../api/prompts'
import type { Customer, VoiceSessionToken, VoicePrompt, ConversationStage, CallOutcome } from '../types'

type AgentStatus = 'idle' | 'connecting' | 'active' | 'completed' | 'error'

interface TranscriptMessage {
  speaker: 'agent' | 'customer' | 'system'
  text: string
  time: string
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

export default function VoicePage() {
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [prompts, setPrompts] = useState<VoicePrompt[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [sessionToken, setSessionToken] = useState<VoiceSessionToken | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [callSummary, setCallSummary] = useState<string>('')
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [outcome, setOutcome] = useState<CallOutcome>('OTHER')
  const outcomeRef = useRef<CallOutcome>('OTHER')

  const updateOutcome = (newOutcome: CallOutcome) => {
    setOutcome(newOutcome)
    outcomeRef.current = newOutcome
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

  const timerRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const chotuGainRef = useRef<GainNode | null>(null)
  const customerGainRef = useRef<GainNode | null>(null)
  const masterBusRef = useRef<GainNode | null>(null)
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const recognitionRef = useRef<any>(null)
  const animFrameRef = useRef<number | null>(null)
  const roomRef = useRef<Room | null>(null)
  const [recordingAvailable, setRecordingAvailable] = useState<boolean>(false)

  const currentStageRef = useRef<ConversationStage>('GREETING_AND_VERIFICATION')
  const turnCountRef = useRef<number>(0)
  const extractedDataRef = useRef<Record<string, any>>({})

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
        if (list.length > 0) {
          setSelectedCustomerId(list[0].id)
        }
      })
      .catch((err) => {
        console.error('Failed to load customers for voice assistant', err)
        setCustomers([])
      })
  }, [])

  // Load saved prompts
  useEffect(() => {
    promptsApi
      .list({ isActive: true })
      .then((data) => {
        setPrompts(data || [])
        if (data && data.length > 0) {
          setSelectedPromptId(data[0].id)
        }
      })
      .catch((err) => {
        console.error('Failed to load saved prompts', err)
      })
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

  const customerList = Array.isArray(customers) ? customers : []
  const selectedCustomer = customerList.find((c) => c.id === selectedCustomerId)
  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId)

  async function speakText(text: string) {
    if (!text) return

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
          sourceNode.start()
          return
        }
      } catch (synthErr) {
        console.warn('Backend TTS playback fallback to window.speechSynthesis:', synthErr)
      }
    }

    // Graceful fallback to browser SpeechSynthesis
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    }
  }

  // Multi-turn 10-stage handler via backend API
  async function handleAgentReply(userUtterance: string, stageAtTimeOfInput: ConversationStage) {
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

      const timeStr = new Date().toTimeString().slice(3, 8)
      setTranscript((prev) => [
        ...prev,
        { speaker: 'agent', text: res.reply, time: timeStr },
      ])

      speakText(res.reply)

      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current)
        endTimeoutRef.current = null
      }

      // Only schedule auto-end when the conversation has explicitly ended (e.g. user hung up, DND, or agent transfer)
      // Allow 5000ms for speech synthesis to complete. If user speaks again in the meantime, timeout is cleared and conversation continues!
      if (res.shouldEnd && (res.nextStage === 'CALL_ENDED' || res.outcome === 'NO_CONTACT' || res.outcome === 'TRANSFERRED_TO_AGENT')) {
        endTimeoutRef.current = setTimeout(() => {
          if (statusRef.current === 'active') {
            handleEnd()
          }
        }, 5000)
      }
    } catch (err: any) {
      console.error('Error in agent turn:', err)
      const fallbackReply = `Thank you. Regarding your account balance, could you specify what date we can expect the remittance?`
      const timeStr = new Date().toTimeString().slice(3, 8)
      setTranscript((prev) => [
        ...prev,
        { speaker: 'agent', text: fallbackReply, time: timeStr },
      ])
      speakText(fallbackReply)
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

      // Web Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = false
        recognition.lang = 'en-IN'

        recognition.onresult = (event: any) => {
          if (endTimeoutRef.current) {
            clearTimeout(endTimeoutRef.current)
            endTimeoutRef.current = null
          }
          const lastIdx = event.results.length - 1
          const userSpeech = event.results[lastIdx][0].transcript.trim()
          if (userSpeech) {
            console.log('Speech recognized:', userSpeech)
            const timeStr = new Date().toTimeString().slice(3, 8)
            setTranscript((prev) => [
              ...prev,
              { speaker: 'customer', text: userSpeech, time: timeStr },
            ])
            handleAgentReply(userSpeech, currentStageRef.current)
          }
        }

        recognition.onstart = () => {
          console.log('SpeechRecognition started')
          setIsListening(true)
        }
        recognition.onend = () => {
          console.log('SpeechRecognition ended, status:', statusRef.current)
          if (statusRef.current === 'active') {
            // Small delay before restart to avoid browser rate limits and ensure clean state
            setTimeout(() => {
              try {
                if (statusRef.current === 'active' && recognitionRef.current) {
                  recognition.start()
                  setIsListening(true)
                }
              } catch (err: any) {
                if (err.name === 'InvalidStateError') {
                  // Already running, ignore
                } else {
                  console.warn('SpeechRecognition restart failed:', err)
                }
              }
            }, 300)
          } else {
            setIsListening(false)
          }
        }
        recognition.onerror = (event: any) => {
          console.error('SpeechRecognition error:', event.error)
          if (event.error === 'not-allowed') {
            setMicActive(false)
            setTranscript((prev) => [
              ...prev,
              {
                speaker: 'system',
                text: 'ℹ️ Microphone permission was not granted. You can still speak or type your responses in the text input below.',
                time: new Date().toTimeString().slice(3, 8),
              },
            ])
            setIsListening(false)
            return
          }
          if (event.error === 'no-speech') {
            // No speech detected, will cleanly restart on onend
            return
          }
          // For network or recoverable errors, do not permanently disable recognition; let onend restart it if active
        }

        recognition.start()
        recognitionRef.current = recognition
      }
    } catch (err) {
      console.warn('Microphone access not granted or not supported:', err)
      setMicActive(false)
    }
  }

  async function handleStart() {
    updateStatus('connecting')
    setSavedSuccess(false)
    setDuration(0)
    setTranscript([])
    setCurrentStage('GREETING_AND_VERIFICATION')
    currentStageRef.current = 'GREETING_AND_VERIFICATION'
    setExtractedData({})
    extractedDataRef.current = {}
    setTurnCount(0)
    turnCountRef.current = 0
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

      // Opening Greeting: customizable via selectedPrompt template or default
      let greeting = `Namaste! Am I speaking with the accounts department at ${custName}? This is Chotu calling from myCashflo regarding pending balance of ${bal}.`
      if (selectedPrompt && selectedPrompt.promptText) {
        greeting = selectedPrompt.promptText
          .replace(/\{\{customerName\}\}/g, custName)
          .replace(/\{\{outstandingAmount\}\}/g, bal)
          .replace(/\{\{invoiceNumber\}\}/g, 'INV-CURRENT')
          .replace(/\{\{dueDate\}\}/g, 'immediate')
          .replace(/\{\{companyName\}\}/g, selectedCustomer?.company || custName)
      }

      setTranscript([
        { speaker: 'system', text: `Voice session active (${tokenData.roomName})`, time: '00:01' },
        { speaker: 'agent', text: greeting, time: '00:02' },
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
      speakText(greeting)
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

    updateStatus('completed')
    const finalDuration = duration || 25
    const custName = selectedCustomer?.name ?? 'Customer'
    const finalOutcome = outcomeRef.current

    let outcomeSummary = `Outcome: ${finalOutcome}.`
    if (finalOutcome === 'PROMISE_TO_PAY') {
      outcomeSummary = `Promise to pay recorded for ${extractedData.agreedAmount || 'outstanding balance'} by ${extractedData.promisedDate || 'agreed date'} via ${extractedData.paymentMethod || 'electronic transfer'}.`
    } else if (finalOutcome === 'WILL_PAY_LATER') {
      outcomeSummary = `Customer stated intention to pay later (${extractedData.tentativeTimeframe || 'date pending follow-up'}).`
    } else if (finalOutcome === 'UNABLE_TO_PAY') {
      outcomeSummary = `Customer reported inability to pay / financial hardship: ${extractedData.hardshipReason || 'cash flow constraints'}.`
    } else if (finalOutcome === 'CALLBACK_REQUESTED') {
      outcomeSummary = `Customer requested callback; currently busy or in a meeting.`
    } else if (finalOutcome === 'DISPUTE') {
      outcomeSummary = `Customer raised billing dispute: ${extractedData.disputeReason || 'invoice discrepancy'}.`
    } else if (finalOutcome === 'PAYMENT_CLAIMED') {
      outcomeSummary = `Customer claimed prior payment (${extractedData.claimedAmount || ''}) with UTR: ${extractedData.claimedUtrOrRef || 'pending verification'}.`
    } else if (finalOutcome === 'NO_CONTACT') {
      outcomeSummary = `No contact established or DND requested.`
    }

    const summaryText = `Chotu AI call with ${custName}. Final Stage: ${currentStage}. ${outcomeSummary} Total duration: ${formatSec(finalDuration)}.`
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
        outcome: finalOutcome,
        livekitRoom: sessionToken?.roomName,
        recordingEgressId: egressId,
        summary: summaryText,
        transcript: transcript.map((m) => `[${m.speaker.toUpperCase()}]: ${m.text}`).join('\n'),
      })
      if (created && (created as any).id) {
        const newSessionId = (created as any).id
        setSessionId(newSessionId)

        // Upload client-recorded audio blob to backend
        if (recordedChunksRef.current && recordedChunksRef.current.length > 0) {
          try {
            const audioBlob = new Blob(recordedChunksRef.current, { type: recorderMimeType })
            await callsApi.uploadRecording(newSessionId, audioBlob)
            setRecordingAvailable(true)
            console.log('Call audio recording successfully stored on server for call session:', newSessionId)
          } catch (uploadErr: any) {
            const errMsg = uploadErr?.response?.data?.message || uploadErr?.message || 'Upload failed'
            console.error('Could not upload client audio recording to server:', errMsg)
            setRecordingError(`Recording upload failed: ${errMsg}`)
          }
        }
      }
      setSavedSuccess(true)
    } catch (err) {
      console.error('Failed to save call session', err)
    }
  }

  function handleReset() {
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }
    stopMediaStream()
    updateStatus('idle')
    setDuration(0)
    setTranscript([])
    setSavedSuccess(false)
    setCurrentStage('GREETING_AND_VERIFICATION')
    currentStageRef.current = 'GREETING_AND_VERIFICATION'
    setExtractedData({})
    extractedDataRef.current = {}
    setTurnCount(0)
    turnCountRef.current = 0
    setEgressId(undefined)
    updateOutcome('OTHER')
  }

  function handleSendManualMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!manualInput.trim()) return
    const text = manualInput.trim()
    setManualInput('')
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }
    const timeStr = new Date().toTimeString().slice(3, 8)
    setTranscript((prev) => [
      ...prev,
      { speaker: 'customer', text, time: timeStr },
    ])
    handleAgentReply(text, currentStageRef.current)
  }

  const formatSec = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const currentStepObj = STAGES.find((s) => s.id === currentStage)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Chotu AI Voice Assistant"
        subtitle="Configurable 10-stage structured collection conversation engine with LiveKit room and speech synthesis"
      />

      {/* Target Customer & Prompt Selection Card */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Voice Prompt Template / Strategy</label>
            <select
              value={selectedPromptId}
              onChange={(e) => setSelectedPromptId(e.target.value)}
              disabled={status === 'active' || status === 'connecting'}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-900 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Standard 10-Stage Progressive Flow</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category})
                </option>
              ))}
            </select>
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
            {recordingAvailable && sessionId && (
              <button
                onClick={() => callsApi.downloadRecording(sessionId, 'call')}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs cursor-pointer flex items-center gap-1.5"
                style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', border: '1px solid var(--border)' }}
              >
                <span>🎙️</span> Download Call Recording
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

        {/* Extracted Commitment Card */}
        {(extractedData.agreedAmount || extractedData.promisedDate || extractedData.paymentMethod) && (
          <div className="mt-6 p-4 rounded-xl text-left bg-slate-900/90 border border-indigo-900/50">
            <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">
              📝 Extracted Payment Commitment
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-400">Promised Amount:</span>
                <div className="text-white font-bold">{extractedData.agreedAmount || '—'}</div>
              </div>
              <div>
                <span className="text-slate-400">Remittance Date:</span>
                <div className="text-white font-bold">{extractedData.promisedDate || '—'}</div>
              </div>
              <div>
                <span className="text-slate-400">Payment Mode:</span>
                <div className="text-white font-bold">{extractedData.paymentMethod || '—'}</div>
              </div>
              <div>
                <span className="text-slate-400">Instant Link:</span>
                <div className="text-white font-bold">{extractedData.sendLink ? 'Yes (Requested)' : 'No'}</div>
              </div>
            </div>
          </div>
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
              <option value="NO_CONTACT">No Contact / Callback</option>
            </select>
          </div>
        )}

        {/* Success & Error Banners */}
        {savedSuccess && (
          <div className="mt-4 rounded-xl p-3 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 text-left">
            <div>✅ Call session saved and logged to Call History with outcome: <strong>{outcome}</strong></div>
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
