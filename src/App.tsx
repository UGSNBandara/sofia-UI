import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, PerspectiveCamera } from '@react-three/drei'
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

export default function App() {
  const animations = [
    { name: 'Chill', path: '/chill.fbx' },
    { name: 'Idle', path: '/Idle.fbx' },
    { name: 'Happy', path: '/happy.fbx' },
    { name: 'Bow', path: '/bow.fbx' },
    { name: 'Listen', path: '/listn.fbx' },
  ]
  const [currentAnim, setCurrentAnim] = useState(0)

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Canvas onCreated={({ gl }) => gl.setClearColor('#000000')}>
        <fog attach="fog" args={['#000000', 5, 15]} />
        <PerspectiveCamera makeDefault position={[0, 1.5, 1.2]} fov={45} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <Suspense fallback={null}>
          <Model fbxPath={animations[currentAnim].path} />
        </Suspense>
      </Canvas>
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
      </div>
    </div>
  )
}
