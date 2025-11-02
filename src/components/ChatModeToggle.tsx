export default function ChatModeToggle({
  mode,
  onToggleMode,
}: {
  mode: 'text' | 'speech'
  onToggleMode: (m: 'text' | 'speech') => void
}) {
  const tab = (active: boolean): React.CSSProperties => ({
    cursor: 'pointer',
    color: active ? '#B39DFF' : 'rgba(255,255,255,0.6)',
    fontSize: 14,
    margin: '0 8px',
  })

  return (
    <div style={{
      position: 'absolute',
      top: 20,
      right: 20,
      display: 'flex',
      gap: 8,
      zIndex: 15,
    }}>
      <span style={tab(mode === 'text')} onClick={() => onToggleMode('text')}>Text</span>
      <span style={tab(mode === 'speech')} onClick={() => onToggleMode('speech')}>Speech</span>
    </div>
  )
}