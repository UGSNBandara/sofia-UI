import { useEffect, useRef } from 'react'
import '../styles.css'

export const MESSAGE_FONT_SIZE = 18

export type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
  ts?: number
}

export default function ChatPanel({
  messages,
  mode,
  draft,
  onDraftChange,
  onSend,
}: {
  messages: ChatMessage[]
  mode: 'text' | 'speech'
  draft: string
  onDraftChange: (v: string) => void
  onSend: (v: string) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const panelWidth = 440
  const panelHeight = 360

  const baseFontSize = MESSAGE_FONT_SIZE
  const headerFontSize = 12

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const container: React.CSSProperties = {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: panelWidth,
    height: panelHeight,
    display: 'flex',
    flexDirection: 'column',
    color: 'white',
    zIndex: 14,
    pointerEvents: 'auto',
    padding: '30px',
  }

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    paddingRight: 0,
  }

  const line = (role: 'assistant' | 'user'): React.CSSProperties => ({
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '10px 0',
    color: role === 'assistant' ? '#B39DFF' : '#FFFFFF',
    fontWeight: role === 'assistant' ? 500 : 400,
    fontSize: baseFontSize,
    textAlign: role === 'assistant' ? 'left' : 'right',
  })

  const inputWrap: React.CSSProperties = {
    marginTop: 6,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    color: 'white',
    border: 'none',
    outline: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.25)',
    padding: '8px 4px',
    fontSize: baseFontSize,
  }

  return (
    <div style={container} aria-live="polite">
      <div ref={listRef} style={listStyle} className="no-scrollbar">
        {messages.map((m) => (
          <div key={m.id} style={line(m.role)}>{m.text}</div>
        ))}
      </div>
      {mode === 'text' ? (
        <div style={inputWrap}>
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const v = draft.trim()
                if (v) onSend(v)
              }
            }}
            placeholder="Type a message..."
            style={inputStyle}
          />
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: headerFontSize, color: '#B39DFF' }}>Listening…</div>
      )}
    </div>
  )
}
