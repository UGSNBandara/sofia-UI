import { Canvas } from '@react-three/fiber'
import { useGLTF, PerspectiveCamera } from '@react-three/drei'
import { Suspense } from 'react'

function AvatarOnly() {
  const { scene } = useGLTF('/avatar.glb')
  return <primitive object={scene} />
}

export default function App() {
  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 1.5, 2]} fov={50} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 10, 5]} intensity={1} />
        <Suspense fallback={null}>
          <AvatarOnly />
        </Suspense>
      </Canvas>
    </div>
  )
}
