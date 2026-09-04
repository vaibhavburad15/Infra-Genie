import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Vec3 = [number, number, number];

function buildGraph() {
  const rand = mulberry32(42);
  const nodes: Vec3[] = [];
  for (let i = 0; i < 30; i++) {
    const x = (rand() - 0.5) * 11;
    const y = (rand() - 0.5) * 4.6 * (1 - Math.abs(x) / 9);
    const z = (rand() - 0.5) * 4.5;
    nodes.push([x, y, z]);
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < 2.6 && edges.filter(([p, q]) => p === i || q === i).length < 4) {
        edges.push([i, j]);
      }
    }
  }
  return { nodes, edges };
}

function Packet({ a, b, speed, offset }: { a: Vec3; b: Vec3; speed: number; offset: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed + offset) % 1;
    ref.current?.position.set(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.045, 8, 8]} />
      <meshBasicMaterial color="#f0bc98" />
    </mesh>
  );
}

function NodeField({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const { nodes, edges } = useMemo(buildGraph, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (!reduced) {
      group.current.rotation.y += delta * 0.045;
      const nx = (state.pointer.x / window.innerWidth) * 2 || 0;
      const ny = (state.pointer.y / window.innerHeight) * 2 || 0;
      pointer.current.x = THREE.MathUtils.lerp(pointer.current.x, nx, 0.04);
      pointer.current.y = THREE.MathUtils.lerp(pointer.current.y, ny, 0.04);
      group.current.rotation.x = pointer.current.y * 0.12;
      group.current.rotation.z = pointer.current.x * 0.03;
      if (core.current) {
        const s = 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.07;
        core.current.scale.setScalar(s);
      }
    }
  });

  return (
    <group ref={group} position={[3.1, -0.1, 0]}>
      {/* Central copper core */}
      <mesh ref={core}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial
          color="#c9692a"
          emissive="#c9692a"
          emissiveIntensity={0.55}
          wireframe
          transparent
          opacity={0.7}
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.3, 2]} />
        <meshStandardMaterial color="#e69c6a" emissive="#e08a4b" emissiveIntensity={1.1} />
      </mesh>

      {/* Edges */}
      {edges.map(([i, j], k) => (
        <Line
          key={k}
          points={[nodes[i], nodes[j]]}
          color={k % 4 === 0 ? '#c9692a' : '#3a5aa8'}
          transparent
          opacity={k % 4 === 0 ? 0.5 : 0.28}
          lineWidth={1}
        />
      ))}

      {/* Nodes */}
      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[i % 6 === 0 ? 0.1 : 0.06, 12, 12]} />
          <meshStandardMaterial
            color={i % 6 === 0 ? '#e08a4b' : '#8fb0ff'}
            emissive={i % 6 === 0 ? '#c9692a' : '#2d56a8'}
            emissiveIntensity={i % 6 === 0 ? 1.4 : 0.7}
          />
        </mesh>
      ))}

      {/* Data packets riding the edges */}
      {edges.slice(0, 8).map(([i, j], k) => (
        <Packet key={k} a={nodes[i]} b={nodes[j]} speed={0.25 + (k % 3) * 0.12} offset={k * 0.13} />
      ))}

      <Sparkles count={110} scale={[14, 7, 7]} size={1.5} speed={reduced ? 0 : 0.22} color="#e08a4b" opacity={0.5} />
      <Sparkles count={70} scale={[14, 7, 7]} size={1} speed={reduced ? 0 : 0.15} color="#7099d8" opacity={0.4} />
    </group>
  );
}

export default function HeroScene() {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0.6, 9.5], fov: 42 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#070b14']} />
        <fog attach="fog" args={['#070b14', 11, 24]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, 8, 6]} intensity={1.1} color="#a8c1ea" />
        <pointLight position={[0, 0, 2]} intensity={55} distance={22} decay={2} color="#c9692a" />
        <NodeField reduced={reduced} />
      </Canvas>
      {/* Vignette + readability scrims */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_68%_45%,transparent_40%,#070b14_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />
    </div>
  );
}
