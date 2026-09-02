import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { ProjectItem } from '@mechatronics-ide/core';
import { useIdeStore } from './store';

interface ViewportProps {
  renderMode: 'shaded' | 'wireframe';
}

function flattenItems(items: ProjectItem[]): ProjectItem[] {
  return items.flatMap((item) => [item, ...flattenItems(item.children)]);
}

function ProjectModel({ items, renderMode }: { items: ProjectItem[]; renderMode: ViewportProps['renderMode'] }): React.JSX.Element {
  const selectedId = useIdeStore((state) => state.selectedId);
  const select = useIdeStore((state) => state.select);
  return <group>{items.map((item, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const selected = selectedId === item.id;
    const rounded = item.type.includes('motor') || item.type.includes('sensor');
    return (
      <mesh key={item.id} position={[(column - 1.5) * 1.25, 0.38, row * -1.25]} rotation={rounded ? [Math.PI / 2, 0, 0] : [0, 0, 0]} castShadow receiveShadow onClick={(event) => { event.stopPropagation(); select(item.id); }}>
        {rounded ? <cylinderGeometry args={[0.34, 0.34, 0.72, 24]} /> : <boxGeometry args={[0.9, 0.72, 0.9]} />}
        <meshStandardMaterial color={selected ? '#32c5ff' : '#708294'} metalness={0.48} roughness={0.42} wireframe={renderMode === 'wireframe'} />
      </mesh>
    );
  })}</group>;
}

export function Viewport({ renderMode }: ViewportProps): React.JSX.Element {
  const project = useIdeStore((state) => state.snapshot?.project);
  const select = useIdeStore((state) => state.select);
  const items = flattenItems(project?.treeItems ?? []);
  return (
    <div className="viewport" aria-label="Interactive 3D viewport">
      <Canvas shadows gl={{ antialias: true }} onPointerMissed={() => project?.treeItems[0] && select(project.treeItems[0].id)}>
        <color attach="background" args={['#0b0f15']} />
        <PerspectiveCamera makeDefault position={[4.4, 3.2, 4.8]} fov={42} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
        <ProjectModel items={items} renderMode={renderMode} />
        <Grid position={[0, 0, 0]} args={[20, 20]} cellSize={0.25} cellThickness={0.5} cellColor="#26313d" sectionSize={1} sectionThickness={1} sectionColor="#3b4c5e" fadeDistance={18} infiniteGrid />
        <axesHelper args={[1.2]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport labelColor="#d8e2ec" axisHeadScale={0.85} /></GizmoHelper>
      </Canvas>
      {items.length === 0 && <div className="viewport-empty"><strong>No model items</strong><span>Create or open a project to populate this view.</span></div>}
      <div className="viewport-badge">PERSPECTIVE · PROJECT ITEM PREVIEW</div>
    </div>
  );
}
