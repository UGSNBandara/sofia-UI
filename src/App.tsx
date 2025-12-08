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
  const [sessionId, setSessionId] = useState<string | null>(null)
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
  // Removed speech timeout scheduling (no frontend phoneme timeline).

  const appendMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message])
  }, [])

  const bumpAutoListen = useCallback(() => {
    setAutoListenToken((prev) => prev + 1)
  }, [])

  // Start/restart inactivity timer (only in conversation mode, not during Break)
  const startInactivityTimer = useCallback(() => {
    // Check current state synchronously via ref
    if (breakActiveRef.current) {
      console.log('[Timer] Not starting - in Break mode')
      return
    }
    if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
    console.log('[Timer] Starting 10s inactivity timer')
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
      setIsSpeaking(true)
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
        stopSpeaking()
        if (voiceModeEnabled) bumpAutoListen()
        // After assistant finishes speaking, start timer to wait for user input
        console.log('[Timer] Assistant finished speaking, starting timer')
        startInactivityTimer()
      }
    },
    [stopSpeaking, playTtsFromBase64, speakWithWebSpeech, bumpAutoListen, voiceModeEnabled, startInactivityTimer]
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
          restart: !!opts?.restart,
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
      return { text: respText, ttsBase64: audioBase64 }
    } catch (error) {
      console.error('Agent fetch failed', error)
      return { text: 'Sofia is having trouble right now. Please try again shortly.' }
    }
  }, [sessionId])

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return
    setChatDraft('')
    appendMessage({ id: `u-${Date.now()}`, role: 'user', text: trimmed })
    // User input received: stop waiting timer and exit Break if active
    console.log('[Timer] User input received, clearing timer')
    if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
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
  }, [appendMessage, fetchAgentResponse, playAssistantAudio, localTtsOnly])

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
    try { localStorage.removeItem('sofia_session_id') } catch {}
    setSessionId(null)
    // Play welcome mp3 with lip sync, then show UI
    setIsSpeaking(true)
    setMouthOpen(0.5)
    await playAudioUrlWithLipSync('/welcome.mp3')
    stopSpeaking()
    setWelcomeDone(true)
    // After welcome, start waiting for user input
    startInactivityTimer()
  }, [fadeBgm, fetchAgentResponse, appendMessage, playAssistantAudio, startInactivityTimer])

  const returnToConversation = useCallback(async (opts?: { newSession?: boolean }) => {
    if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
    try { stopSpeaking() } catch {}
    if (opts?.newSession) {
      try { localStorage.removeItem('sofia_session_id') } catch {}
      setSessionId(null)
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
    console.log('[Timer] Returned from Break, starting timer')
    startInactivityTimer()
  }, [stopSpeaking, fadeBgm, startInactivityTimer])

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
      {welcomeDone && !breakActive && (
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
            onDraftChange={setChatDraft}
            onSend={handleSend}
          />
          <SpeechInput
            onTranscript={handleTranscript}
            disabled={isProcessing || isSpeaking}
            onBeforeStart={() => {
              if (isSpeaking) stopSpeaking()
              // User starts speaking: stop waiting timer and exit Break if active
              if (inactivityTimeoutRef.current) { window.clearTimeout(inactivityTimeoutRef.current); inactivityTimeoutRef.current = null }
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
      {welcomeDone && breakActive && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 25, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(0,0,0,0.6)', padding: '16px 20px', borderRadius: 12, color: '#fff', display: 'flex', gap: 12 }}>
            <button
              onClick={() => returnToConversation()}
              style={{ backgroundColor: '#6AD58B', border: 'none', padding: '10px 18px', borderRadius: 8, color: '#0b2d17', fontWeight: 600, cursor: 'pointer' }}
            >
              Continue
            </button>
            <button
              onClick={() => returnToConversation({ newSession: true })}
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
