import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import AvatarModel from './components/AvatarModel'
import BackLogo from './components/BackLogo'
import ChatPanel, { type ChatMessage } from './components/ChatPanel'
import SpeechInput from './components/SpeechInput'
// Frontend TTS removed; relying solely on backend audio_base64

const ANIMATIONS = [
  { name: 'Chill', path: '/chill.fbx' },
  { name: 'Idle', path: '/Idle.fbx' },
  { name: 'Bow', path: '/bow.fbx' },
  { name: 'Break', path: '/Dwarf.fbx' },
]

const INITIAL_MESSAGES: ChatMessage[] = []

const AGENT_ENDPOINT: string = (import.meta as any)?.env?.VITE_AGENT_ENDPOINT || 'https://icecreamemultiagent-production.up.railway.app/agent/'
const AGENT_TEXT_ENDPOINT: string = (import.meta as any)?.env?.VITE_AGENT_TEXT_ENDPOINT || (AGENT_ENDPOINT.endsWith('/agent/') ? AGENT_ENDPOINT + 'text' : (AGENT_ENDPOINT.replace(/\/?$/, '') + '/text'))
const BG_MUSIC_PATH = '/background-music.mp3'

// Phoneme to mouth openness mapping (IPA from Piper)
// Removed phoneme maps and Piper/Web Speech fallback.

export default function App() {
  const [currentAnim, setCurrentAnim] = useState(0) // 0=Chill, 1=Idle
  const [chatStarted, setChatStarted] = useState(false)
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false)
  const [freezeBody, setFreezeBody] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)

  const [autoListenToken, setAutoListenToken] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [mouthOpen, setMouthOpen] = useState(0)
  const [smile, setSmile] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ 
    kind: 'cart' | 'order' | 'empty'; 
    cart?: { items: Array<{ code: number; name: string; qty: number; price: number; amount: number }>; subtotal: number }; 
    order?: { id: string; customer_name: string; items: Array<{ code: number; name: string; qty: number; price: number; amount: number }>; total: number; status: string; created_at: string } 
  } | null>(null)
  const [facialDataCaptured, setFacialDataCaptured] = useState(false)
  const [localTtsOnly, setLocalTtsOnly] = useState(false)
  // Web Speech voices for browser TTS
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const webSpeechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const [preferredVoiceName, setPreferredVoiceName] = useState<string | null>('Microsoft Emily Online (Natural) - English (Ireland)')

  const pendingAudioRef = useRef<HTMLAudioElement | null>(null)
  const base64ResolveRef = useRef<(() => void) | null>(null)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const bowResolveRef = useRef<(() => void) | null>(null)
  const inactivityTimeoutRef = useRef<number | null>(null)
  const [breakActive, setBreakActive] = useState(false)
  const breakActiveRef = useRef(false) // Sync ref for immediate checks
  const isSpeakingRef = useRef(false) // Track if assistant is speaking
  // Removed speech timeout scheduling (no frontend phoneme timeline).

  // Clear any stored session data on fresh app start
  useEffect(() => {
    try {
      localStorage.removeItem('sofia_session_id')
      localStorage.removeItem('sofia_facial_captured')
      console.log('[Session] Cleared stored session data for fresh start')
    } catch (err) {
      console.warn('[Session] Failed to clear session data:', err)
    }
  }, [])

  // Fetch cart/order summary based on session id
  const fetchSummary = useCallback(async (sid?: string | null) => {
    const effectiveSession = typeof sid === 'string' ? sid : sessionId
    console.log('[Summary] fetchSummary called with sid:', sid, 'effectiveSession:', effectiveSession)
    if (!effectiveSession) return
    try {
      const base = ((import.meta as any)?.env?.VITE_AGENT_BASE) || (AGENT_ENDPOINT.replace(/\/agent\/?$/, ''))
      const url = `${base.replace(/\/?$/, '')}/session/${effectiveSession}/summary`
      console.log('[Summary] Fetching from:', url)
      const resp = await fetch(url, { method: 'GET' })
      console.log('[Summary] Response status:', resp.status)
      if (!resp.ok) throw new Error('Summary request failed')
      const data = await resp.json()
      console.log('[Summary] Raw response data:', data)
      
      const kind = data?.kind || 'empty'
      if (kind === 'order' && data.order) {
        console.log('[Summary] Order detected:', data.order)
        setSummary({ kind: 'order', order: data.order })
      } else if (kind === 'cart' && data.cart) {
        const items = Array.isArray(data.cart.cart) ? data.cart.cart : []
        const subtotal = typeof data.cart.subtotal === 'number' ? data.cart.subtotal : 0
        console.log('[Summary] Cart detected, items:', items, 'subtotal:', subtotal)
        setSummary({ kind: 'cart', cart: { items, subtotal } })
      } else {
        console.log('[Summary] Empty state')
        setSummary({ kind: 'empty' })
      }
    } catch (err) {
      console.warn('[Summary] Fetch failed:', err)
    }
  }, [sessionId])

  // Capture facial data (age/gender) and send to backend - runs once per session
  const captureAndSendFacialData = useCallback(async (sid: string) => {
    // Double check if already done for this session
    if (localStorage.getItem('sofia_facial_captured') === sid) {
      setFacialDataCaptured(true)
      return
    }

    try {
      console.log('[Facial] Capturing age/gender...')
      // 1. Capture from local service
      const captureResp = await fetch("http://localhost:8001/capture-age-gender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          user_id: null, 
        }),
      })
      
      if (!captureResp.ok) throw new Error('Capture failed')
      const captureData = await captureResp.json()
      console.log('[Facial] Captured:', captureData)

      // 2. Send to Backend
      const base = ((import.meta as any)?.env?.VITE_AGENT_BASE) || (AGENT_ENDPOINT.replace(/\/agent\/?$/, ''))
      const url = `${base.replace(/\/?$/, '')}/session/${sid}/facial`
      
      const payload = {
        emotion: "happy", // Hardcoded for now
        confidence: 0.85,
        age_group: captureData.age_group, // "child" | "teen" | "adult" | "senior"
        gender_guess: captureData.gender // "male" | "female"
      }

      console.log('[Facial] Sending to backend:', url, payload)
      const sendResp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!sendResp.ok) throw new Error('Send facial data failed')
      const sendData = await sendResp.json()
      console.log('[Facial] Backend response:', sendData)

      // Mark as done
      localStorage.setItem('sofia_facial_captured', sid)
      setFacialDataCaptured(true)

    } catch (err) {
      console.warn('[Facial] Error:', err)
    }
  }, [])

  // Trigger facial capture when session starts
  useEffect(() => {
    if (sessionId && !facialDataCaptured) {
       if (localStorage.getItem('sofia_facial_captured') === sessionId) {
         setFacialDataCaptured(true)
       } else {
         void captureAndSendFacialData(sessionId)
       }
    }
  }, [sessionId, facialDataCaptured, captureAndSendFacialData])

  // Refresh summary whenever sessionId changes (and exists)
  useEffect(() => {
    console.log('[Summary] useEffect triggered, sessionId:', sessionId)
    if (sessionId) { void fetchSummary(sessionId) }
  }, [sessionId, fetchSummary])

  const appendMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message])
  }, [])

  const bumpAutoListen = useCallback(() => {
    setAutoListenToken((prev) => prev + 1)
  }, [])

  // Reset inactivity timer (clears and restarts, only in conversation mode, not during Break or speaking)
  const resetInactivityTimer = useCallback(() => {
    // Check current state synchronously via ref
    if (breakActiveRef.current) {
      console.log('[Timer] Not resetting - in Break mode')
      return
    }
    if (isSpeakingRef.current) {
      console.log('[Timer] Not resetting - assistant is speaking')
      return
    }
    if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
    console.log('[Timer] Resetting 10s inactivity timer')
    inactivityTimeoutRef.current = window.setTimeout(() => {
      console.log('[Timer] 10s elapsed - triggering Break')
      const breakIdx = ANIMATIONS.findIndex(a => a.name === 'Break')
      if (breakIdx !== -1) {
        setCurrentAnim(breakIdx)
        setFreezeBody(false)
        setBreakActive(true)
        breakActiveRef.current = true
        // Stop timer when entering Break
        if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
      }
    }, 10000)
  }, [])

  // Explicitly stop/clear inactivity timer (used when assistant starts speaking or certain user actions)
  const stopInactivityTimer = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      console.log('[Timer] Clearing inactivity timer')
      window.clearTimeout(inactivityTimeoutRef.current)
      inactivityTimeoutRef.current = null
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    if (pendingAudioRef.current) {
      pendingAudioRef.current.pause()
      pendingAudioRef.current.currentTime = 0
      pendingAudioRef.current = null
    }
    base64ResolveRef.current?.()
    base64ResolveRef.current = null

    // Stop Web Speech utterance if active
    try {
      if (webSpeechUtteranceRef.current) {
        window.speechSynthesis.cancel()
        webSpeechUtteranceRef.current = null
      }
    } catch {}

    setIsSpeaking(false)
    setMouthOpen(0)
  }, [])

  // Load Web Speech voices and keep list updated
  useEffect(() => {
    const update = () => {
      try {
        const v = window.speechSynthesis.getVoices()
        setVoices(v || [])
      } catch {}
    }
    update()
    try { window.speechSynthesis.onvoiceschanged = update } catch {}
    return () => { try { window.speechSynthesis.onvoiceschanged = null as any } catch {} }
  }, [])

  // Control smile based on conversation state
  useEffect(() => {
    const inConversation = chatStarted && welcomeDone && !breakActive
    const isBowing = currentAnim === ANIMATIONS.findIndex(a => a.name === 'Bow')
    let smileValue = 0

    if (breakActive) {
      smileValue = 0.1 // Low smile in break mode
    } else if (isBowing) {
      smileValue = 0.15 // Low smile when bowing
    } else if (inConversation) {
      smileValue = isSpeaking ? 0.15 : 0.3 // Lower smile when speaking, normal when listening
    }

    setSmile(smileValue)
  }, [chatStarted, welcomeDone, breakActive, isSpeaking, currentAnim])

  const ensureVoicesReady = useCallback(async (maxMs = 5000) => {
    if (voices && voices.length > 0) return
    const start = performance.now()
    try {
      const dummy = new SpeechSynthesisUtterance(' ')
      dummy.volume = 0
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(dummy)
    } catch {}
    await new Promise<void>((resolve) => {
      const check = () => {
        const list = window.speechSynthesis.getVoices()
        if (list && list.length > 0) { setVoices(list); resolve(); return }
        if (performance.now() - start >= maxMs) { resolve(); return }
        setTimeout(check, 120)
      }
      check()
    })
  }, [voices])

  const pickFemaleVoice = useCallback((vlist?: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    const voicesList = vlist || voices
    if (!voicesList.length) return null
    if (preferredVoiceName) {
      const exact = voicesList.find(v => v.name === preferredVoiceName)
      if (exact) return exact
    }
    const whitelist = [
      'Microsoft Emily Online (Natural) - English (Ireland)',
      'Microsoft Aria - English (United States)',
      'Microsoft Zira - English (United States)',
      'Google US English Female',
      'Google UK English Female'
    ]
    for (const name of whitelist) {
      const found = voicesList.find(v => v.name === name)
      if (found) return found
    }
    const english = voicesList.filter(v => /en[-_]/i.test(v.lang) || /English/i.test(v.lang || ''))
    const femaleHint = /(female|zira|aria|emily|jessa|samantha|victoria|hazel|jenny|emma)/i
    const hinted = english.filter(v => femaleHint.test(v.name))
    if (hinted.length) return hinted[0]
    return english[0] || voicesList[0]
  }, [voices, preferredVoiceName])

  const speakWithWebSpeech = useCallback(async (text: string, onStart?: () => void) => {
    return new Promise<void>(async (resolve) => {
      try {
        await ensureVoicesReady(5000)
        const utter = new SpeechSynthesisUtterance(text)
        const liveVoices = window.speechSynthesis.getVoices() || []
        const voice = pickFemaleVoice(liveVoices)
        if (!voice) { resolve(); return }
        utter.voice = voice
        const RATE = parseFloat((((import.meta as any)?.env?.VITE_TTS_RATE) as string) || '1.12')
        const PITCH = parseFloat((((import.meta as any)?.env?.VITE_TTS_PITCH) as string) || '1.03')
        utter.rate = isFinite(RATE) ? RATE : 1.12
        utter.pitch = isFinite(PITCH) ? PITCH : 1.03
        utter.volume = 1.0

        // Boundary events for basic lip sync pulses
        let pulseTimeout: number | null = null
        const pulseDuration = Math.max(50, 80 / utter.rate) // Shorter pulses at faster rates
        const pulse = () => {
          setMouthOpen(0.7)
          pulseTimeout = window.setTimeout(() => setMouthOpen(0.2), pulseDuration)
        }
        utter.onboundary = (ev: SpeechSynthesisEvent) => {
          if (ev.name === 'word') pulse()
        }

        utter.onstart = () => {
          setMouthOpen(0.4)  // Set initial mouth position when speech actually starts
          onStart?.()
        }

        utter.onend = () => {
          if (pulseTimeout) { window.clearTimeout(pulseTimeout); pulseTimeout = null }
          setMouthOpen(0)
          resolve()
        }
        utter.onerror = () => {
          if (pulseTimeout) { window.clearTimeout(pulseTimeout); pulseTimeout = null }
          setMouthOpen(0)
          resolve()
        }
        webSpeechUtteranceRef.current = utter
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utter)
        const approxWords = Math.max(1, text.trim().split(/\s+/).length)
        const maxDurationMs = Math.min(120000, Math.max(8000, approxWords * 650))
        window.setTimeout(() => resolve(), maxDurationMs)
      } catch { resolve() }
    })
  }, [ensureVoicesReady, pickFemaleVoice])

  const playTtsFromBase64 = useCallback((base64: string) => {
    return new Promise<void>((resolve) => {
      if (!base64) {
        resolve()
        return
      }
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`)
      // Try to set up WebAudio analyser for lip-sync
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        const ctx = audioCtxRef.current
        if (ctx) {
          void ctx.resume().catch(() => {})
          const source = ctx.createMediaElementSource(audio)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          // Route audio through analyser to destination so it's audible
          source.connect(analyser)
          analyser.connect(ctx.destination)
          analyserRef.current = analyser
          const data = new Uint8Array(analyser.frequencyBinCount)
          let prev = 0
          const tick = () => {
            if (!analyserRef.current) return
            analyserRef.current.getByteTimeDomainData(data)
            // Compute simple RMS for mouth openness
            let sum = 0
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128
              sum += v * v
            }
            const rms = Math.sqrt(sum / data.length)
            const open = Math.min(1, Math.max(0, (rms - 0.02) * 4))
            prev = prev * 0.7 + open * 0.3
            setMouthOpen(prev)
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        }
      } catch {}
      const cleanup = () => {
        audio.removeEventListener('ended', onEnd)
        audio.removeEventListener('error', onEnd)
        if (pendingAudioRef.current === audio) pendingAudioRef.current = null
        base64ResolveRef.current = null
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        analyserRef.current = null
        setMouthOpen(0)
      }
      const onEnd = () => {
        cleanup()
        resolve()
      }
      audio.addEventListener('ended', onEnd)
      audio.addEventListener('error', onEnd)
      pendingAudioRef.current = audio
      base64ResolveRef.current = () => {
        cleanup()
        resolve()
      }
      audio.play().catch(() => onEnd())
    })
  }, [])

  const playAudioUrlWithLipSync = useCallback((url: string) => {
    return new Promise<void>((resolve) => {
      if (!url) { resolve(); return }
      const audio = new Audio(url)
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        const ctx = audioCtxRef.current
        if (ctx) {
          void ctx.resume().catch(() => {})
          const source = ctx.createMediaElementSource(audio)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          source.connect(analyser)
          analyser.connect(ctx.destination)
          analyserRef.current = analyser
          const data = new Uint8Array(analyser.frequencyBinCount)
          let prev = 0
          const tick = () => {
            if (!analyserRef.current) return
            analyserRef.current.getByteTimeDomainData(data)
            let sum = 0
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128
              sum += v * v
            }
            const rms = Math.sqrt(sum / data.length)
            const open = Math.min(1, Math.max(0, (rms - 0.02) * 4))
            prev = prev * 0.7 + open * 0.3
            setMouthOpen(prev)
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        }
      } catch {}
      const cleanup = () => {
        audio.removeEventListener('ended', onEnd)
        audio.removeEventListener('error', onEnd)
        if (pendingAudioRef.current === audio) pendingAudioRef.current = null
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
        analyserRef.current = null
        setMouthOpen(0)
      }
      const onEnd = () => { cleanup(); resolve() }
      audio.addEventListener('ended', onEnd)
      audio.addEventListener('error', onEnd)
      pendingAudioRef.current = audio
      audio.play().catch(() => onEnd())
    })
  }, [])

  const playAssistantAudio = useCallback(
    async (text?: string, base64?: string, onStart?: () => void) => {
      stopSpeaking()
      if (!text && !base64) {
        if (voiceModeEnabled) bumpAutoListen()
        return
      }
      // When assistant is about to speak, ensure inactivity timer is stopped
      stopInactivityTimer()
      setIsSpeaking(true)
      isSpeakingRef.current = true
      // Mouth opening is now handled when TTS actually starts
      try {
        // Default to browser TTS for responses
        if (text) {
          await speakWithWebSpeech(text, onStart)
        } else if (base64) {
          onStart?.() // Base64 starts immediately
          await playTtsFromBase64(base64)
        } else {
          console.warn('No text or audio provided for assistant response.')
        }
      } catch (error) {
        console.error('Assistant audio error', error)
      } finally {
        isSpeakingRef.current = false
        stopSpeaking()
        if (voiceModeEnabled) bumpAutoListen()
        // After assistant finishes speaking, start timer to wait for user input
        console.log('[Timer] Assistant finished speaking, starting timer')
        resetInactivityTimer()
        // Background: refresh summary at end of response
        void fetchSummary()
      }
    },
    [stopSpeaking, playTtsFromBase64, speakWithWebSpeech, bumpAutoListen, voiceModeEnabled, resetInactivityTimer, stopInactivityTimer, fetchSummary]
  )

  // Removed local Piper synthesis; backend will return audio_base64.

  const getOrCreateUserId = () => {
    const k = 'sofia_user_id'
    let id = localStorage.getItem(k)
    if (!id) {
      id = `user_${Math.random().toString(36).slice(2)}`
      localStorage.setItem(k, id)
    }
    return id
  }

  const fetchAgentResponse = useCallback(async (text: string, opts?: { restart?: boolean, mode?: 'text-only' | 'tts' }) => {
    try {
      const endpoint = opts?.mode === 'text-only' ? AGENT_TEXT_ENDPOINT : AGENT_ENDPOINT
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: getOrCreateUserId(),
          text,
          restart: !!opts?.restart || !sessionId, // Force restart if no session ID
          session_id: opts?.restart ? null : sessionId,
          speak: true,
          voice: 'en-US-JennyNeural',
        }),
      })
      if (!response.ok) throw new Error('Agent request failed')
      const payload = await response.json()
      const respText = typeof payload?.response === 'string' ? payload.response : '...'
      const audioBase64 = typeof payload?.audio_base64 === 'string' ? payload.audio_base64 : undefined
      const newSessionId = typeof payload?.session_id === 'string' ? payload.session_id : null
      setSessionId(newSessionId)
      if (newSessionId) localStorage.setItem('sofia_session_id', newSessionId)
      // Background: refresh summary for this session
      void fetchSummary(newSessionId)
      return { text: respText, ttsBase64: audioBase64 }
    } catch (error) {
      console.error('Agent fetch failed', error)
      return { text: 'Sofia is having trouble right now. Please try again shortly.' }
    }
  }, [sessionId, fetchSummary])

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return
    setChatDraft('')
    appendMessage({ id: `u-${Date.now()}`, role: 'user', text: trimmed })
    // User input received: stop timer and exit Break if active
    console.log('[Timer] User input received, clearing timer')
    stopInactivityTimer()
    if (breakActive) {
      const idleIdx = ANIMATIONS.findIndex(a => a.name === 'Idle')
      if (idleIdx !== -1) setCurrentAnim(idleIdx)
      setFreezeBody(true)
      setBreakActive(false)
      breakActiveRef.current = false
    }
    setIsProcessing(true)
    try {
      if (localTtsOnly) {
        // Test mode: do not call backend; echo text and speak via browser TTS
        const speakText = trimmed
        const assistantMessage: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', text: speakText }
        await playAssistantAudio(speakText, undefined, () => appendMessage(assistantMessage))
      } else {
        const response = await fetchAgentResponse(trimmed, { mode: 'text-only' })
        const assistantMessage: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', text: response.text }
        await playAssistantAudio(response.text, response.ttsBase64, () => appendMessage(assistantMessage))
      }
    } finally {
      setIsProcessing(false)
    }
  }, [appendMessage, fetchAgentResponse, playAssistantAudio, localTtsOnly, resetInactivityTimer, breakActive])

  const handleTranscript = useCallback(
    (transcript: string) => {
      void handleSend(transcript)
    },
    [handleSend]
  )

  // Sync breakActive ref with state
  useEffect(() => {
    breakActiveRef.current = breakActive
  }, [breakActive])

  // Removed voice loading effect (no frontend TTS).

  // Try autoplay background music in chill mode
  useEffect(() => {
    const el = bgmRef.current
    if (!el) return
    el.volume = 1.0
    el.loop = true
    const playPromise = el.play()
    if (playPromise) playPromise.catch(() => {})
  }, [])

  const fadeBgm = useCallback((to: number, ms = 1200) => {
    const el = bgmRef.current
    if (!el) return
    const from = el.volume
    const start = performance.now()
    const step = (now: number) => {
      const raw = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - raw, 3) // ease-out cubic
      el.volume = from + (to - from) * eased
      if (raw < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [])

  const startChat = useCallback(async () => {
    setChatStarted(true)
    setWelcomeDone(false)
    setFreezeBody(false)
    // Play bow once if available
    const bowIndex = ANIMATIONS.findIndex(a => a.name === 'Bow')
    if (bowIndex !== -1) {
      // switch to bow and wait for finish
      const p = new Promise<void>((resolve) => { bowResolveRef.current = resolve })
      setCurrentAnim(bowIndex)
      try { await p } catch {}
    }
    setCurrentAnim(1) // Idle
    setFreezeBody(true) // keep idle pose static; only mouth moves
    fadeBgm(0.1, 1500)
    // restart session
    try { 
      localStorage.removeItem('sofia_session_id') 
      localStorage.removeItem('sofia_facial_captured')
    } catch {}
    setSessionId(null)
    setFacialDataCaptured(false)
    // Play welcome mp3 with lip sync, then show UI
    setIsSpeaking(true)
    setMouthOpen(0.5)
    await playAudioUrlWithLipSync('/welcome.mp3')
    stopSpeaking()
    setWelcomeDone(true)
    // After welcome, reset timer to wait for user input
    resetInactivityTimer()
  }, [fadeBgm, fetchAgentResponse, appendMessage, playAssistantAudio, resetInactivityTimer])

  const returnToConversation = useCallback(async (opts?: { newSession?: boolean }) => {
    if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
    try { stopSpeaking() } catch {}
    if (opts?.newSession) {
      try { 
        localStorage.removeItem('sofia_session_id') 
        localStorage.removeItem('sofia_facial_captured')
      } catch {}
      setSessionId(null)
      setFacialDataCaptured(false)
      setChatMessages([])
    }
    // Play Bow once, freeze immediately at start
    const bowIdx = ANIMATIONS.findIndex(a => a.name === 'Bow')
    if (bowIdx !== -1) {
      const p = new Promise<void>((resolve) => { bowResolveRef.current = resolve })
      setCurrentAnim(bowIdx)
      setFreezeBody(true)
      setMouthOpen(0)
      try { await p } catch {}
    }
    // After Bow completes, go to Idle and freeze for conversation
    const idleIdx = ANIMATIONS.findIndex(a => a.name === 'Idle')
    if (idleIdx !== -1) setCurrentAnim(idleIdx)
    setFreezeBody(true)
    setBreakActive(false)
    breakActiveRef.current = false
    fadeBgm(0.1, 600)
    // Start fresh inactivity timer when returning to conversation (with delay to ensure state updates)
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log('[Timer] Returned from Break, resetting timer')
    resetInactivityTimer()
  }, [stopSpeaking, fadeBgm, resetInactivityTimer])

  // Removed menu sequence logic per new simplified UI

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <audio ref={bgmRef} src={BG_MUSIC_PATH} autoPlay loop />
      <Canvas onCreated={({ gl }) => gl.setClearColor('#000000')}>
        <fog attach="fog" args={['#000000', 5, 15]} />
        <PerspectiveCamera makeDefault position={[0, 1.5, 1.2]} fov={45} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <Suspense fallback={null}>
          <BackLogo />
        </Suspense>
        <Suspense fallback={null}>
          <AvatarModel
            fbxPath={ANIMATIONS[currentAnim].path}
            mouthOpen={mouthOpen}
            smile={smile}
            loop={ANIMATIONS[currentAnim].name === 'Bow' ? 'once' : 'loop'}
            frozen={freezeBody && ANIMATIONS[currentAnim].name !== 'Bow'}
            onFinished={() => {
              if (ANIMATIONS[currentAnim].name === 'Bow') {
                bowResolveRef.current?.()
                bowResolveRef.current = null
              }
            }}
          />
        </Suspense>
      </Canvas>
      {/* Cart UI overlay - positioned above chat with matching width and gap */}
      {summary && welcomeDone && summary.kind === 'cart' && summary.cart && summary.cart.items.length > 0 && (
        <div style={{ 
          position: 'absolute', 
          right: 40, /* Adjusted position */
          bottom: 700, /* Adjusted position above chat */
          width: 440, /* Matches chat panel width for alignment */
          maxHeight: 240, 
          overflowY: 'auto', 
          background: 'rgba(0,0,0,0.5)', 
          color: '#fff', /* Default text color white */
          fontSize: 18, /* Matches chat message font size */
          borderRadius: 8, 
          border: '1px solid #10bff9ff', /* New blue border */
          padding: 10, 
          zIndex: 20 
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Cart</div>
          {summary.cart.items.map((it) => (
            <div key={`${it.code}-${it.name}`} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{it.name} × {it.qty}</span>
              <span style={{ color: '#10bff9ff' }}>{Math.round(it.amount)}</span> {/* Price in new blue */}
            </div>
          ))}
          <div style={{ borderTop: '1px solid #10bff9ff', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Subtotal</span>
            <span style={{ color: '#10bff9ff' }}>{Math.round(summary.cart.subtotal)}</span> {/* Subtotal in new blue */}
          </div>
        </div>
      )}
      {/* Order completed overlay - hides chat and shows order with cancel/new buttons */}
      {summary && welcomeDone && summary.kind === 'order' && summary.order && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
          <div style={{ width: 360, maxHeight: '80vh', overflowY: 'auto', background: 'linear-gradient(135deg, rgba(16, 191, 249, 0.2) 0%, rgba(20, 20, 30, 0.95) 100%)', backdropFilter: 'blur(12px)', color: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(16, 191, 249, 0.3)', border: '1px solid rgba(16, 191, 249, 0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid rgba(16, 191, 249, 0.3)' }}>
              <div style={{ fontWeight: 700, fontSize: 20, color: '#10bff9' }}>
                Order Id : {summary.order.id}<br />
                Customer : {summary.order.customer_name}
              </div>
            </div>
            <div style={{ marginTop: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, opacity: 0.9 }}>Items</div>
              {summary.order.items.map((it, idx) => (
                <div key={`${it.code}-${it.name}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '10px 12px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
                      Quantity: {it.qty}<br />
                      Unit Price: Rs {it.price.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#10bff9' }}>Rs {it.amount.toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid rgba(16, 191, 249, 0.3)', marginTop: 14, paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>Total</span>
              <span style={{ fontWeight: 700, fontSize: 22, color: '#10bff9' }}>Rs {summary.order.total.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => {
                  console.log('[Order] Cancel button clicked - API call placeholder')
                  // TODO: Implement cancel order API call
                  alert('Cancel order functionality will be implemented with backend endpoint')
                }}
                style={{ flex: 1, backgroundColor: 'rgba(255, 107, 107, 0.2)', border: '1px solid rgba(255, 107, 107, 0.5)', padding: '12px', borderRadius: 10, color: '#ff6b6b', fontWeight: 600, cursor: 'pointer', fontSize: 14, transition: 'all 0.2s ease' }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.3)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                Cancel Order
              </button>
              <button
                onClick={() => {
                  console.log('[Order] New Order button clicked')
                  try { 
                    localStorage.removeItem('sofia_session_id') 
                    localStorage.removeItem('sofia_facial_captured')
                  } catch {}
                  setSessionId(null)
                  setFacialDataCaptured(false)
                  setChatMessages([])
                  setSummary(null)
                  window.location.reload()
                }}
                style={{ flex: 1, backgroundColor: '#10bff9', border: 'none', padding: '12px', borderRadius: 10, color: '#0b2d17', fontWeight: 700, cursor: 'pointer', fontSize: 14, transition: 'all 0.2s ease', boxShadow: '0 2px 8px rgba(16, 191, 249, 0.4)' }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                New Order
              </button>
            </div>
          </div>
        </div>
      )}
      {welcomeDone && !breakActive && summary?.kind !== 'order' && (
        <>
          {/* Voice controls: select voice and toggle local TTS test mode */}
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 20, background: 'rgba(0,0,0,0.5)', padding: '8px 12px', borderRadius: 8 }}>
            <label style={{ color: '#fff', marginRight: 8 }}>Voice:</label>
            <select
              value={preferredVoiceName || ''}
              onChange={(e) => setPreferredVoiceName(e.target.value || null)}
              style={{ marginRight: 12 }}
            >
              <option value="">Auto (female)</option>
              {voices.map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
            <label style={{ color: '#fff', marginRight: 6 }}>
              <input
                type="checkbox"
                checked={localTtsOnly}
                onChange={(e) => setLocalTtsOnly(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Local TTS test (no backend)
            </label>
          </div>
          <ChatPanel
            messages={chatMessages}
            mode={'text'}
            draft={chatDraft}
            onDraftChange={(v) => {
              setChatDraft(v)
              resetInactivityTimer()
            }}
            onSend={handleSend}
          />
          <SpeechInput
            onTranscript={handleTranscript}
            disabled={isProcessing || isSpeaking}
            onBeforeStart={() => {
              if (isSpeaking) stopSpeaking()
              // User starts speaking: reset timer and exit Break if active
              console.log('[Timer] Voice recording started, resetting timer')
              resetInactivityTimer()
              if (breakActive) {
                const idleIdx = ANIMATIONS.findIndex(a => a.name === 'Idle')
                if (idleIdx !== -1) setCurrentAnim(idleIdx)
                setFreezeBody(true)
                setBreakActive(false)
                breakActiveRef.current = false
              }
            }}
            autoStartToken={autoListenToken}
            autoStartEnabled={voiceModeEnabled && !isSpeaking && !isProcessing}
            onManualStart={() => setVoiceModeEnabled(true)}
            onManualStop={() => setVoiceModeEnabled(false)}
          />
        </>
      )}
      {welcomeDone && breakActive && (!summary || summary.kind !== 'order') && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 25, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(0,0,0,0.6)', padding: '16px 20px', borderRadius: 12, color: '#fff', display: 'flex', gap: 12 }}>
            <button
              onClick={() => {
                console.log('[Timer] Continue button clicked')
                resetInactivityTimer()
                returnToConversation()
              }}
              style={{ backgroundColor: '#6AD58B', border: 'none', padding: '10px 18px', borderRadius: 8, color: '#0b2d17', fontWeight: 600, cursor: 'pointer' }}
            >
              Continue
            </button>
            <button
              onClick={() => {
                console.log('[Timer] New Session button clicked')
                resetInactivityTimer()
                returnToConversation({ newSession: true })
              }}
              style={{ backgroundColor: '#B39DFF', border: 'none', padding: '10px 18px', borderRadius: 8, color: '#0f0f1a', fontWeight: 600, cursor: 'pointer' }}
            >
              New Session
            </button>
          </div>
        </div>
      )}
      {!chatStarted && (
        <div style={{ position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
          <button
            onClick={startChat}
            style={{
              backgroundColor: '#B39DFF',
              border: 'none',
              padding: '12px 28px',
              borderRadius: 999,
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            Start Chat
          </button>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '10px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '8px',
            background: '#000000',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '8px',
            height: '2px',
            background: '#B39DFF',
            boxShadow: '0 0 6px #B39DFF, 0 0 12px #B39DFF',
          }}
        />
      </div>
    </div>
  )
}
