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
]

const INITIAL_MESSAGES: ChatMessage[] = []

const AGENT_ENDPOINT = 'http://127.0.0.1:8000/agent/'
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
  // No frontend voices; backend supplies audio.

  const pendingAudioRef = useRef<HTMLAudioElement | null>(null)
  const base64ResolveRef = useRef<(() => void) | null>(null)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const bowResolveRef = useRef<(() => void) | null>(null)
  // Removed speech timeout scheduling (no frontend phoneme timeline).

  const appendMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message])
  }, [])

  const bumpAutoListen = useCallback(() => {
    setAutoListenToken((prev) => prev + 1)
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

    // Frontend speech synthesis removed.

    setIsSpeaking(false)
    setMouthOpen(0)
  }, [])

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
    async (text?: string, base64?: string) => {
      stopSpeaking()
      if (!text && !base64) {
        if (voiceModeEnabled) bumpAutoListen()
        return
      }
      setIsSpeaking(true)
      setMouthOpen(0.4)
      try {
        if (base64) {
          await playTtsFromBase64(base64)
        } else {
          console.warn('No backend audio provided; displaying text only.')
        }
      } catch (error) {
        console.error('Assistant audio error', error)
      } finally {
        stopSpeaking()
        if (voiceModeEnabled) bumpAutoListen()
      }
    },
    [stopSpeaking, playTtsFromBase64, bumpAutoListen, voiceModeEnabled]
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

  const fetchAgentResponse = useCallback(async (text: string, opts?: { restart?: boolean }) => {
    try {
      const response = await fetch(AGENT_ENDPOINT, {
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
    setIsProcessing(true)
    try {
      const response = await fetchAgentResponse(trimmed)
      appendMessage({ id: `a-${Date.now()}`, role: 'assistant', text: response.text })
      await playAssistantAudio(response.text, response.ttsBase64)
    } finally {
      setIsProcessing(false)
    }
  }, [appendMessage, fetchAgentResponse, playAssistantAudio])

  const handleTranscript = useCallback(
    (transcript: string) => {
      void handleSend(transcript)
    },
    [handleSend]
  )

  // Clear any stored session on refresh as requested
  useEffect(() => {
    try { localStorage.removeItem('sofia_session_id') } catch {}
  }, [])

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
  }, [fadeBgm, fetchAgentResponse, appendMessage, playAssistantAudio])

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
      {welcomeDone && (
        <>
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
            }}
            autoStartToken={autoListenToken}
            autoStartEnabled={voiceModeEnabled && !isSpeaking && !isProcessing}
            onManualStart={() => setVoiceModeEnabled(true)}
            onManualStop={() => setVoiceModeEnabled(false)}
          />
        </>
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
