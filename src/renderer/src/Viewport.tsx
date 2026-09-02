import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, GizmoHelper, GizmoViewport, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { SceneAsset } from '@mechatronics-ide/core';

interface ViewportProps {
  renderMode: 'shaded' | 'wireframe';
  scene?: SceneAsset | null;
  emptyTitle?: string;
  emptyMessage?: string;
}

function SceneMeshes({ scene, renderMode }: { scene: SceneAsset; renderMode: ViewportProps['renderMode'] }): React.JSX.Element {
  const geometries = useMemo(() => scene.meshes.map((mesh) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
    if (mesh.normals) geometry.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }), [scene]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  return <group>{scene.meshes.map((mesh, index) => {
    const raw = mesh.color ?? [0.45, 0.55, 0.65];
    const scale = Math.max(...raw) > 1 ? 1 / 255 : 1;
    const color = new Color(raw[0] * scale, raw[1] * scale, raw[2] * scale);
    return <mesh key={`${mesh.name}-${index}`} geometry={geometries[index]!} castShadow receiveShadow><meshStandardMaterial color={color} metalness={0.15} roughness={0.58} wireframe={renderMode === 'wireframe'} /></mesh>;
  })}</group>;
}

export function Viewport({ renderMode, scene = null, emptyTitle = 'No 3D scene available', emptyMessage = 'Install and activate a geometry extension to provide scene data.' }: ViewportProps): React.JSX.Element {
  return (
    <div className="viewport" aria-label="Interactive 3D viewport">
      <Canvas shadows gl={{ antialias: true }}>
        <color attach="background" args={['#0b0f15']} />
        <PerspectiveCamera makeDefault position={[4.4, 3.2, 4.8]} fov={42} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
        {scene && <Bounds fit clip observe margin={1.2}><SceneMeshes scene={scene} renderMode={renderMode} /></Bounds>}
        <Grid position={[0, 0, 0]} args={[20, 20]} cellSize={0.25} cellThickness={0.5} cellColor="#26313d" sectionSize={1} sectionThickness={1} sectionColor="#3b4c5e" fadeDistance={18} infiniteGrid />
        <axesHelper args={[1.2]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport labelColor="#d8e2ec" axisHeadScale={0.85} /></GizmoHelper>
      </Canvas>
      {!scene && <div className="viewport-empty"><strong>{emptyTitle}</strong><span>{emptyMessage}</span></div>}
      <div className="viewport-badge">PERSPECTIVE · {renderMode.toUpperCase()}</div>
    </div>
  );
}
