import { useEffect, useRef } from 'react'

export type MenuItem = {
  title: string
  price?: string
  description?: string
  imageUrl?: string
}

export default function NeonMenuTile({
  item,
  visible,
  autoHideMs = 4000,
  onHide,
}: {
  item: MenuItem | null
  visible: boolean
  autoHideMs?: number
  onHide?: () => void
}) {
  const timerRef = useRef<number | null>(null)
  const hoveringRef = useRef(false)

  useEffect(() => {
    if (!visible) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }
    if (hoveringRef.current) return
    timerRef.current = window.setTimeout(() => {
      onHide?.()
      timerRef.current = null
    }, autoHideMs)
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [visible, autoHideMs, onHide])

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20%',
    left: 48,
    width: 220,
    padding: 12,
    borderRadius: 12,
    background: 'rgba(10,12,18,0.45)',
    border: '1px solid #B39DFF',
    boxShadow: '0 0 10px #B39DFF, 0 0 24px rgba(179,157,255,0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: 'white',
    transform: visible ? 'translateX(0)' : 'translateX(-140%)',
    opacity: visible ? 1 : 0,
    transition: 'transform 380ms ease, opacity 380ms ease',
    pointerEvents: visible ? 'auto' : 'none',
    zIndex: 12,
  }

  if (!item) return null

  return (
    <div
      style={baseStyle}
      onMouseEnter={() => {
        hoveringRef.current = true
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }}
      onMouseLeave={() => {
        hoveringRef.current = false
        if (visible) {
          timerRef.current = window.setTimeout(() => {
            onHide?.()
            timerRef.current = null
          }, autoHideMs)
        }
      }}
    >
      {item.imageUrl && (
        <div style={{ marginBottom: 8 }}>
          <img src={item.imageUrl} alt={item.title} style={{ width: '100%', borderRadius: 8 }} />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700 }}>{item.title}</div>
        {item.price && <div style={{ color: '#B39DFF' }}>{item.price}</div>}
      </div>
      {item.description && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>{item.description}</div>
      )}
    </div>
  )
}
