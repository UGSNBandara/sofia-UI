import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { SkeletonUtils, FBXLoader } from 'three-stdlib'

type Props = {
  fbxPath: string
  mouthOpen?: number
  loop?: 'loop' | 'once'
  onFinished?: () => void
  frozen?: boolean
}

export default function AvatarModel({ fbxPath, mouthOpen = 0, loop = 'loop', onFinished, frozen = false }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const fbxMixerRef = useRef<THREE.AnimationMixer | null>(null)
  const [mode, setMode] = useState<'direct' | 'perframe' | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const loggedRef = useRef(false)
  const mouthBoneRef = useRef<THREE.Bone | null>(null)
  const baseMouthRotRef = useRef(0)
  const loggedMouthRef = useRef(false)
  const mouthMorphTargetsRef = useRef<Array<{ mesh: THREE.SkinnedMesh; index: number }>>([])
  const appliedFrozenPoseRef = useRef(false)

  const { scene } = useGLTF('/avatar.glb')
  const [fbx, setFbx] = useState<THREE.Group | null>(null)
  const [, setFbxError] = useState<string | null>(null)

  useEffect(() => {
    setFbx(null)
    setFbxError(null)
    if (!fbxPath) {
      setFbxError('No FBX path specified')
      return
    }
    const loader = new FBXLoader()
    loader.load(
      fbxPath,
      (obj) => setFbx(obj),
      undefined,
      (err) => {
        const msg = (err && (err as any).message) ? (err as any).message : String(err)
        setFbxError(msg)
      }
    )
  }, [fbxPath])

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
    return best
  }, [fbx]) as THREE.SkinnedMesh | null

  useEffect(() => {
    mouthMorphTargetsRef.current = []
    mouthBoneRef.current = null
    if (!scene) return

    const morphNamePattern = /jaw|mouth.*open|viseme_aa|viseme_o|vrc\.??v_aa|openmouth|lips?part/i
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if ((m as any).isSkinnedMesh && m.morphTargetDictionary && m.morphTargetInfluences) {
        const dict = m.morphTargetDictionary as Record<string, number>
        for (const key of Object.keys(dict)) {
          if (morphNamePattern.test(key)) {
            mouthMorphTargetsRef.current!.push({ mesh: m, index: dict[key] })
          }
        }
      }
    })
    if (mouthMorphTargetsRef.current.length) {
      if (!loggedMouthRef.current) {
        loggedMouthRef.current = true
      }
      return
    }

    const bones = (targetSkinned as any).skeleton?.bones as THREE.Bone[] | undefined
    if (!bones) return
    const jaw = bones.find((b) => /jaw|mouth/i.test(b.name)) || null
    mouthBoneRef.current = jaw
    if (jaw) {
      baseMouthRotRef.current = jaw.rotation.x
      if (!loggedMouthRef.current) {
        loggedMouthRef.current = true
      }
    } else if (!loggedMouthRef.current) {
      loggedMouthRef.current = true
    }
  }, [scene, targetSkinned])

  useEffect(() => {
    if (!fbx || !fbx.animations?.length) return
    if (!targetSkinned || !sourceSkinned) return

    const clip = fbx.animations[0]
    const targetBones: string[] = ((targetSkinned as any).skeleton?.bones || []).map((b: THREE.Bone) => b.name)
    const targetSet = new Set(targetBones)
    const nodeNames = new Set<string>()
    for (const t of clip.tracks) {
      const name = t.name.split('.')[0]
      if (name) nodeNames.add(name)
    }
    const names = Array.from(nodeNames)
    const hits = names.filter((n) => targetSet.has(n)).length
    const ratio = names.length ? hits / names.length : 0

    if (ratio > 0.8) {
      setMode('direct')
      const mixer = mixerRef.current || new THREE.AnimationMixer(scene)
      mixerRef.current = mixer
      const onFinishedHandler = () => { if (onFinished) onFinished() }
      mixer.addEventListener('finished', onFinishedHandler)
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.5)
      }
      const action = mixer.clipAction(clip)
      if (loop === 'once') {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      }
      if (frozen) {
        action.setEffectiveTimeScale(0)
        action.time = 0
      }
      action.reset().fadeIn(0.5).play()
      currentActionRef.current = action

      return () => {
        if (currentActionRef.current) {
          currentActionRef.current.fadeOut(0.5)
        }
        mixer.removeEventListener('finished', onFinishedHandler)
      }
    } else {
      setMode('perframe')
      fbx.traverse((o: any) => {
        if (o.isSkinnedMesh || o.isBone) o.updateMatrixWorld(true)
      })
      const fbxMixer = new THREE.AnimationMixer(fbx)
      fbxMixerRef.current = fbxMixer
      const action = fbxMixer.clipAction(clip)
      if (loop === 'once') {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      }
      const onFinishedHandler = () => { if (onFinished) onFinished() }
      fbxMixer.addEventListener('finished', onFinishedHandler)
      if (frozen) {
        action.setEffectiveTimeScale(0)
        action.time = 0
      }
      action.reset().play()
      appliedFrozenPoseRef.current = false
      return () => {
        fbxMixer.stopAllAction()
        fbxMixer.removeEventListener('finished', onFinishedHandler)
        fbxMixerRef.current = null
      }
    }
  }, [fbx, scene, targetSkinned, sourceSkinned, loop, onFinished, frozen])

  useFrame((_, dt) => {
    if (mode === 'direct' && mixerRef.current) {
      if (!frozen) mixerRef.current.update(dt)
    }
    if (mode === 'perframe' && fbxMixerRef.current) {
      if (!frozen) {
        fbxMixerRef.current.update(dt)
        if (targetSkinned && sourceSkinned) {
          SkeletonUtils.retarget(targetSkinned, sourceSkinned, { preserveHipPosition: true } as any)
        }
      } else if (!appliedFrozenPoseRef.current && targetSkinned && sourceSkinned) {
        SkeletonUtils.retarget(targetSkinned, sourceSkinned, { preserveHipPosition: true } as any)
        appliedFrozenPoseRef.current = true
      }
    }
    const clamp = THREE.MathUtils.clamp
    if (mouthMorphTargetsRef.current && mouthMorphTargetsRef.current.length) {
      const value = clamp(mouthOpen, 0, 1)
      for (const { mesh, index } of mouthMorphTargetsRef.current) {
        if (mesh.morphTargetInfluences && mesh.morphTargetInfluences[index] !== undefined) {
          mesh.morphTargetInfluences[index] = value
        }
      }
    } else if (mouthBoneRef.current) {
      mouthBoneRef.current.rotation.x = baseMouthRotRef.current + clamp(mouthOpen, 0, 1) * 0.4
    }
    if (!loggedRef.current && mode) {
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

useGLTF.preload('/avatar.glb')
