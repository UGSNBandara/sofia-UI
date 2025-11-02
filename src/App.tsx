import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, PerspectiveCamera } from '@react-three/drei'
import BackLogo from './components/BackLogo'
import NeonMenuTile, { type MenuItem } from './components/NeonMenuTile'
import ChatPanel, { type ChatMessage } from './components/ChatPanel'
import ChatModeToggle from './components/ChatModeToggle'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { SkeletonUtils, FBXLoader } from 'three-stdlib'

function Model({ fbxPath }: { fbxPath: string }) {
  const groupRef = useRef<THREE.Group>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const fbxMixerRef = useRef<THREE.AnimationMixer | null>(null)
  const [mode, setMode] = useState<'direct' | 'perframe' | null>(null)
  const loggedRef = useRef(false)

  console.log('Model component rendered')

  // Load avatar and FBX
  const { scene } = useGLTF('/avatar.glb')
  const [fbx, setFbx] = useState<THREE.Group | null>(null)
  const [, setFbxError] = useState<string | null>(null)

  // Manually load FBX to provide better error handling
  useEffect(() => {
    setFbx(null)
    setFbxError(null)
    if (!fbxPath) {
      setFbxError('No FBX path specified')
      return
    }
    console.log('Loading FBX:', fbxPath)
    const loader = new FBXLoader()
    loader.load(
      fbxPath,
      (obj) => {
        console.log('FBX loaded:', fbxPath, 'animations:', obj.animations?.length || 0)
        setFbx(obj)
      },
      undefined,
      (err) => {
        const msg = (err && (err as any).message) ? (err as any).message : String(err)
        console.error('Failed to load FBX', fbxPath, msg)
        setFbxError(msg)
      }
    )
  }, [fbxPath])

  // Find the main skinned meshes
  const targetSkinned = useMemo(() => {
    let best: THREE.SkinnedMesh | null = null
    let maxBones = -1
    scene.traverse((o) => {
      if ((o as any).isSkinnedMesh) {
        const s = o as THREE.SkinnedMesh
        const count = (s as any).skeleton?.bones?.length ?? 0
        if (count > maxBones) {
          maxBones = count
          best = s
        }
      }
    })
    console.log('Avatar targetSkinned found:', !!best, 'bones:', best ? (best as any).skeleton?.bones?.length : 0)
    return best
  }, [scene]) as THREE.SkinnedMesh | null

  const sourceSkinned = useMemo(() => {
    let best: THREE.SkinnedMesh | null = null
    let maxBones = -1
    if (fbx) {
      fbx.traverse((o: any) => {
        if (o.isSkinnedMesh) {
          const s = o as THREE.SkinnedMesh
          const count = (s as any).skeleton?.bones?.length ?? 0
          if (count > maxBones) {
            maxBones = count
            best = s
          }
        }
      })
    }
    console.log('FBX sourceSkinned found:', !!best, 'bones:', best ? (best as any).skeleton?.bones?.length : 0)
    return best
  }, [fbx]) as THREE.SkinnedMesh | null

  // Choose playback strategy
  useEffect(() => {
    console.log('useEffect triggered, fbx:', !!fbx, 'scene:', !!scene, 'targetSkinned:', !!targetSkinned, 'sourceSkinned:', !!sourceSkinned)
    if (!fbx || !fbx.animations?.length) return
    if (!targetSkinned || !sourceSkinned) return

    const clip = fbx.animations[0]
    // Gather avatar bone names
    const targetBones: string[] = ((targetSkinned as any).skeleton?.bones || []).map((b: THREE.Bone) => b.name)
    const targetSet = new Set(targetBones)
    // Extract track node names
    const nodeNames = new Set<string>()
    for (const t of clip.tracks) {
      const name = t.name.split('.')[0]
      if (name) nodeNames.add(name)
    }
    const names = Array.from(nodeNames)
    const hits = names.filter((n) => targetSet.has(n)).length
    const ratio = names.length ? hits / names.length : 0

    console.log(`Animation debug: ${hits}/${names.length} track nodes match avatar bones (${(ratio * 100).toFixed(1)}%)`)

    if (ratio > 0.8) {
      // Directly bind the FBX clip to the avatar
      console.log('Animation mode: direct binding')
      setMode('direct')
      const mixer = new THREE.AnimationMixer(scene)
      mixerRef.current = mixer
      mixer.clipAction(clip).reset().play()
      return () => {
        mixer.stopAllAction()
        mixerRef.current = null
      }
    } else {
      // Animate FBX and retarget pose every frame
      console.log('Animation mode: per-frame retarget')
      setMode('perframe')
      fbx.traverse((o: any) => {
        if (o.isSkinnedMesh || o.isBone) o.updateMatrixWorld(true)
      })
      const fbxMixer = new THREE.AnimationMixer(fbx)
      fbxMixerRef.current = fbxMixer
      fbxMixer.clipAction(clip).reset().play()
      return () => {
        fbxMixer.stopAllAction()
        fbxMixerRef.current = null
      }
    }
  }, [fbx, scene, targetSkinned, sourceSkinned])

  useFrame((_, dt) => {
    if (mode === 'direct' && mixerRef.current) mixerRef.current.update(dt)
    if (mode === 'perframe' && fbxMixerRef.current) fbxMixerRef.current.update(dt)
    if (mode === 'perframe' && targetSkinned && sourceSkinned) {
      SkeletonUtils.retarget(targetSkinned, sourceSkinned, { preserveHipPosition: true } as any)
    }
    if (!loggedRef.current && mode) {
      console.log('Animation update started: mode', mode)
      loggedRef.current = true
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
      {mode === 'perframe' && fbx && <primitive object={fbx} visible={false} />}
    </group>
  )
}

// BackLogo moved to components/BackLogo

// NeonMenuTile moved to components/NeonMenuTile
// ChatPanel moved to components/ChatPanel

export default function App() {
  const animations = [
    { name: 'Chill', path: '/chill.fbx' },
    { name: 'Idle', path: '/Idle.fbx' },
    { name: 'Happy', path: '/happy.fbx' },
    { name: 'Bow', path: '/bow.fbx' },
    { name: 'Listen', path: '/listn.fbx' },
  ]
  const [currentAnim, setCurrentAnim] = useState(0)
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuItem, setMenuItem] = useState<MenuItem | null>(null)
  const [menuSeq, setMenuSeq] = useState<MenuItem[] | null>(null)
  const [menuIdx, setMenuIdx] = useState(0)
  const [menuAutoMs, setMenuAutoMs] = useState(2000)
  const [chatMode, setChatMode] = useState<'text' | 'speech'>('text')
  const [chatDraft, setChatDraft] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 'm1', role: 'assistant', text: 'Hi! Welcome to Sofia — what would you like today?' },
    { id: 'm2', role: 'user', text: 'Show me something minty.' },
    { id: 'm3', role: 'assistant', text: 'Mint Swirl Cone is a top pick. Want to try that?' },
    { id: 'm4', role: 'user', text: 'Sounds good!' },
  ])

  const startMenuSequence = (items: MenuItem[], autoMs = 2000) => {
    if (!items || items.length === 0) return
    setMenuSeq(items)
    setMenuIdx(0)
    setMenuItem(items[0])
    setMenuAutoMs(autoMs)
    setMenuVisible(true)
  }

  const sendChat = (text: string) => {
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text },
    ])
    setChatDraft('')
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: 'Great choice! Anything else?' },
      ])
    }, 700)
  }

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Canvas onCreated={({ gl }) => gl.setClearColor('#000000')}>
        <fog attach="fog" args={['#000000', 5, 15]} />
        <PerspectiveCamera makeDefault position={[0, 1.5, 1.2]} fov={45} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <Suspense fallback={null}>
          <BackLogo />
        </Suspense>
        <Suspense fallback={null}>
          <Model fbxPath={animations[currentAnim].path} />
        </Suspense>
      </Canvas>
      <ChatPanel
        messages={chatMessages}
        mode={chatMode}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        onSend={sendChat}
      />
      <ChatModeToggle
        mode={chatMode}
        onToggleMode={setChatMode}
      />
      <NeonMenuTile
        item={menuItem}
        visible={menuVisible}
        autoHideMs={menuAutoMs}
        onHide={() => {
          if (menuSeq && menuIdx < menuSeq.length - 1) {
            const nextIndex = menuIdx + 1
            const nextItem = menuSeq[nextIndex]
            setMenuVisible(false)
            setTimeout(() => {
              setMenuIdx(nextIndex)
              setMenuItem(nextItem)
              setMenuVisible(true)
            }, 420)
          } else {
            setMenuVisible(false)
            setMenuSeq(null)
            setMenuIdx(0)
          }
        }}
      />
      {/* Thin 2D footer edge overlay for bottom front accent */}
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
      <div style={{ position: 'absolute', top: 10, left: 10 }}>
        {animations.map((anim, i) => (
          <button
            key={i}
            onClick={() => setCurrentAnim(i)}
            style={{
              marginRight: 10,
              backgroundColor: 'black',
              color: 'white',
              border: '1px solid white',
              padding: '5px 10px',
              cursor: 'pointer'
            }}
          >
            {anim.name}
          </button>
        ))}
        <button
          onClick={() =>
            startMenuSequence([
              {
                title: 'Chocolate Cone',
                price: '$3.99',
                description: 'Rich cocoa with fudge swirl',
                imageUrl: '/IceCreams/chocolate.jpg',
              },
              {
                title: 'Vanilla Classic',
                price: '$3.49',
                description: 'Creamy vanilla bean',
                imageUrl: '/IceCreams/vanila.jpg',
              },
            ], 2000)
          }
          style={{
            marginLeft: 8,
            backgroundColor: 'black',
            color: '#B39DFF',
            border: '1px solid #B39DFF',
            padding: '5px 10px',
            cursor: 'pointer',
          }}
        >
          Show Menu
        </button>
      </div>
    </div>
  )
}
