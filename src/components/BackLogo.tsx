import { useTexture } from '@react-three/drei'

export default function BackLogo() {
  const texture = useTexture('/backLogo.png')
  return (
    <mesh position={[0, 2.5, -2]}>
      <planeGeometry args={[1.8, 0.4]} />
      <meshStandardMaterial map={texture} transparent emissive={'#ff00ff'} emissiveIntensity={0.4} />
    </mesh>
  )
}
