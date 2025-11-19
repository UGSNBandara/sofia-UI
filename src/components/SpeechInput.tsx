import { useEffect, useRef, useState } from 'react'

type SpeechInputProps = {
  onTranscript: (text: string) => void
  lang?: string
  continuous?: boolean
  interim?: boolean
  disabled?: boolean
  onBeforeStart?: () => void | Promise<void>
  autoStartToken?: number
  autoStartEnabled?: boolean
  style?: React.CSSProperties
  onManualStart?: () => void
  onManualStop?: () => void
}

declare global {
  interface Window {
    webkitSpeechRecognition?: any
  }
}

export default function SpeechInput({
  onTranscript,
  lang = 'en-US',
  continuous = false,
  interim = false,
  disabled = false,
  onBeforeStart,
  autoStartToken,
  autoStartEnabled = true,
  style,
  onManualStart,
  onManualStop,
}: SpeechInputProps) {
  const [supported, setSupported] = useState<boolean>(false)
  const [listening, setListening] = useState<boolean>(false)
  const [hint, setHint] = useState<string>('')
  const recognitionRef = useRef<any | null>(null)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SR) {
      setSupported(true)
      const rec = new SR()
      rec.lang = lang
      rec.continuous = continuous
      rec.interimResults = interim

      rec.onstart = () => setListening(true)
      rec.onend = () => setListening(false)
      rec.onerror = (e: any) => {
        setListening(false)
        setHint(e?.error ? String(e.error) : 'Recognition error')
      }
      rec.onresult = (ev: any) => {
        let finalText = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i]
          if (res.isFinal) finalText += res[0].transcript
        }
        if (finalText.trim()) onTranscript(finalText.trim())
      }
      recognitionRef.current = rec
    } else {
      setSupported(false)
      setHint('SpeechRecognition not supported in this browser')
    }
    return () => {
      try { recognitionRef.current?.stop?.() } catch {}
      recognitionRef.current = null
    }
  }, [lang, continuous, interim, onTranscript])

  // Auto-start listening when token changes and conditions allow
  useEffect(() => {
    const canStart = supported && autoStartEnabled && !disabled && !listening && recognitionRef.current
    if (!canStart) return
    let cancelled = false
    ;(async () => {
      try {
        if (onBeforeStart) await onBeforeStart()
        if (!cancelled) recognitionRef.current?.start?.()
      } catch {
        setHint('Microphone permission blocked or already active')
      }
    })()
    return () => { cancelled = true }
  }, [autoStartToken, supported, disabled, listening, onBeforeStart, autoStartEnabled])

  const toggle = async () => {
    if (!supported) return
    if (!listening) {
      if (disabled) return
      try {
        if (onBeforeStart) await onBeforeStart()
        if (onManualStart) onManualStart()
        recognitionRef.current?.start?.()
      } catch (e) {
        setHint('Microphone permission blocked or already active')
      }
    } else {
      try { recognitionRef.current?.stop?.() } catch {}
      if (onManualStop) onManualStop()
    }
  }

  return (
    <div style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, ...style }}>
      <button
        onClick={toggle}
        title={supported ? (listening ? 'Stop listening' : 'Start listening') : hint}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: listening ? '#B39DFF' : '#1b1b1b',
          border: '1px solid #B39DFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: supported && !disabled ? 'pointer' : 'not-allowed',
          boxShadow: listening ? '0 0 18px rgba(179,157,255,0.9)' : '0 0 8px rgba(179,157,255,0.4)',
          opacity: disabled ? 0.5 : 1
        }}
        disabled={!supported || disabled}
      >
        {/* Mic icon */}
        <svg width="26" height="26" viewBox="0 0 24 24" fill={listening ? '#000' : '#B39DFF'} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/>
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.08A7 7 0 0 0 19 11z"/>
        </svg>
      </button>
      {!supported && (
        <span style={{ color: '#aaa', fontSize: 12 }}>{hint}</span>
      )}
    </div>
  )
}
