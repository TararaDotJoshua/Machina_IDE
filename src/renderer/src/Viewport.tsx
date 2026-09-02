import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useIdeStore } from './store';

interface ViewportProps {
  renderMode: 'shaded' | 'wireframe';
}

export function Viewport({ renderMode }: ViewportProps): React.JSX.Element {
  const project = useIdeStore((state) => state.snapshot?.project);
  return (
    <div className="viewport" aria-label="Interactive 3D viewport">
      <Canvas shadows gl={{ antialias: true }}>
        <color attach="background" args={['#0b0f15']} />
        <PerspectiveCamera makeDefault position={[4.4, 3.2, 4.8]} fov={42} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
        <Grid position={[0, 0, 0]} args={[20, 20]} cellSize={0.25} cellThickness={0.5} cellColor="#26313d" sectionSize={1} sectionThickness={1} sectionColor="#3b4c5e" fadeDistance={18} infiniteGrid />
        <axesHelper args={[1.2]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport labelColor="#d8e2ec" axisHeadScale={0.85} /></GizmoHelper>
      </Canvas>
      <div className="viewport-empty"><strong>{project ? 'No 3D scene available' : 'No project open'}</strong><span>{project ? 'Install and activate a geometry extension to provide scene data.' : 'Create or open a project to begin.'}</span></div>
      <div className="viewport-badge">PERSPECTIVE · {renderMode.toUpperCase()}</div>
    </div>
  );
}
