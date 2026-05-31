import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ── Problem definitions ───────────────────────────────────────────────────────

export interface Problem {
  id: string;
  type: 'weed' | 'pest' | 'sprinkler';
  label: string;
  position: [number, number, number];
  severity: 'high' | 'medium' | 'low';
  detail: string;
  color: string;
  badge: string;
}

export const PROBLEMS: Problem[] = [
  {
    id: 'c0',
    type: 'weed',
    label: 'Weed Cluster',
    position: [-0.455, 0, -3.683],
    severity: 'high',
    detail: 'Count: 2 · 2 sources detected',
    color: '#ba1a1a',
    badge: 'WEED',
  },
  {
    id: 'c1',
    type: 'weed',
    label: 'Weed Cluster',
    position: [-0.013, 0, -1.738],
    severity: 'high',
    detail: 'Count: 7 · 7 sources detected',
    color: '#ba1a1a',
    badge: 'WEED',
  },
];

// Drone home base (upper-right corner of field, off the crops)
const DRONE_HOME = new THREE.Vector3(1.8, -0.3, -2.4);

// ── Drone geometry builder ────────────────────────────────────────────────────

function buildDroneGroup(): { group: THREE.Group; rotors: THREE.Mesh[] } {
  const group  = new THREE.Group();
  const rotors: THREE.Mesh[] = [];

  const greenMat  = () => new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
  const cyanMat   = () => new THREE.MeshBasicMaterial({ color: 0x44ffcc, wireframe: true });
  const yellowMat = () => new THREE.MeshBasicMaterial({
    color: 0xffff44, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, depthWrite: false,
  });

  // Body — square chassis
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.28), greenMat()));

  // X-pattern arms (same as DroneScanner)
  const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.015, 0.04), greenMat());
  arm1.rotation.y = Math.PI / 4;
  group.add(arm1);

  const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.015, 0.04), greenMat());
  arm2.rotation.y = -Math.PI / 4;
  group.add(arm2);

  // Rotor discs at arm tips — spin to show they're active
  const tipDist = 0.21;
  for (const [rx, rz] of [[tipDist, tipDist], [-tipDist, tipDist], [tipDist, -tipDist], [-tipDist, -tipDist]]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 10), cyanMat());
    disc.position.set(rx, 0.03, rz);
    disc.userData.isRotor = true;
    group.add(disc);
    rotors.push(disc);
  }

  // Target reticle — yellow semi-transparent square on the field surface below drone
  const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), yellowMat());
  reticle.rotation.x = -Math.PI / 2;
  reticle.position.y = 0.32; // sits at Y=0 when drone is at Y=-0.3 (field level)
  group.add(reticle);

  // Reticle border (line loop)
  const half = 0.25;
  const borderPts = [
    new THREE.Vector3(-half, 0.32, -half),
    new THREE.Vector3( half, 0.32, -half),
    new THREE.Vector3( half, 0.32,  half),
    new THREE.Vector3(-half, 0.32,  half),
    new THREE.Vector3(-half, 0.32, -half),
  ];
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
  const borderLine = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: 0xffff44 }));
  group.add(borderLine);

  return { group, rotors };
}

// ── Spray ring builder ────────────────────────────────────────────────────────

function buildSprayGroup(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ccff, transparent: true, opacity: 0, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 28), mat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  return group;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  activeDroneProblemId: string | null;
  onDroneComplete: (problemId: string) => void;
}

function getViewer() { return (window as any).gsplatViewer ?? null; }
function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

export default function ProblemMarkers({ activeDroneProblemId, onDroneComplete }: Props) {
  const pinRefs        = useRef<Record<string, HTMLDivElement | null>>({});
  const markerRafRef   = useRef<number | null>(null);
  const droneRafRef    = useRef<number | null>(null);
  const droneGroupRef  = useRef<THREE.Group | null>(null);
  const rotorsRef      = useRef<THREE.Mesh[]>([]);
  const sprayGroupRef  = useRef<THREE.Group | null>(null);
  const overlayScene   = useRef<THREE.Scene | null>(null);
  const restoreRender  = useRef<(() => void) | null>(null);
  const onCompleteRef  = useRef(onDroneComplete);

  useEffect(() => { onCompleteRef.current = onDroneComplete; }, [onDroneComplete]);

  // ── Setup: build 3D drone, patch viewer.render ────────────────────────────
  // GS3D renders threeScene BEFORE the splat, so anything there is hidden behind it.
  // Solution: intercept viewer.render and add a second pass AFTER the splat.
  useEffect(() => {
    const setup = (): boolean => {
      const viewer = getViewer();
      if (!viewer?.renderer) return false;

      const scene = new THREE.Scene();
      overlayScene.current = scene;

      const { group: drone, rotors } = buildDroneGroup();
      drone.visible = false;
      scene.add(drone);
      droneGroupRef.current = drone;
      rotorsRef.current = rotors;

      const spray = buildSprayGroup();
      spray.visible = false;
      scene.add(spray);
      sprayGroupRef.current = spray;

      // Patch: composite our overlay scene AFTER the splat on every frame
      const origRender = viewer.render.bind(viewer);
      viewer.render = function () {
        origRender();
        const renderer: THREE.WebGLRenderer = viewer.renderer;
        const camera: THREE.PerspectiveCamera = viewer.camera;
        if (!renderer || !camera) return;
        if (!drone.visible && !spray.visible) return;
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = false;   // don't wipe the splat we just drew
        renderer.render(scene, camera);
        renderer.autoClear = prevAutoClear;
      };

      restoreRender.current = () => {
        viewer.render = origRender;
        scene.traverse(o => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const m = o.material as THREE.Material | THREE.Material[];
            Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
          }
          if (o instanceof THREE.Line) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      };

      return true;
    };

    if (!setup()) {
      const onLoaded = () => setup();
      window.addEventListener('splat:loaded', onLoaded);
      return () => {
        window.removeEventListener('splat:loaded', onLoaded);
        restoreRender.current?.();
      };
    }

    return () => restoreRender.current?.();
  }, []);

  // ── Drone flight animation ─────────────────────────────────────────────────
  useEffect(() => {
    if (droneRafRef.current) cancelAnimationFrame(droneRafRef.current);

    if (!activeDroneProblemId) {
      if (droneGroupRef.current)  droneGroupRef.current.visible  = false;
      if (sprayGroupRef.current)  sprayGroupRef.current.visible  = false;
      return;
    }

    const problem = PROBLEMS.find(p => p.id === activeDroneProblemId);
    const drone   = droneGroupRef.current;
    const spray   = sprayGroupRef.current;
    if (!problem || !drone || !spray) return;

    const home   = DRONE_HOME.clone();
    const target = new THREE.Vector3(...problem.position).setY(-0.3);

    drone.position.copy(home);
    drone.rotation.set(0, 0, 0);
    drone.visible   = true;
    spray.visible   = false;
    spray.position.set(target.x, -0.05, target.z);

    // Spray color by problem type
    const sprayHex = problem.type === 'sprinkler' ? 0x44aaff
                   : problem.type === 'pest'      ? 0xff8800
                   : 0x44ff88;
    spray.children.forEach(c => {
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(sprayHex);
    });

    const FLIGHT_OUT  = 2400;
    const HOVER       =  250;
    const SPRAY_DUR   = 3200;
    const FLIGHT_BACK = 1800;
    const TOTAL       = FLIGHT_OUT + HOVER + SPRAY_DUR + FLIGHT_BACK;

    const t0 = performance.now();

    const step = () => {
      const elapsed = performance.now() - t0;

      // Spin rotors every frame regardless of phase
      for (const r of rotorsRef.current) r.rotation.y += 0.22;

      if (elapsed >= TOTAL) {
        drone.visible = false;
        spray.visible = false;
        spray.children.forEach(c => {
          const r = c as THREE.Mesh;
          r.scale.setScalar(1);
          (r.material as THREE.MeshBasicMaterial).opacity = 0;
        });
        onCompleteRef.current(activeDroneProblemId);
        return;
      }

      droneRafRef.current = requestAnimationFrame(step);

      if (elapsed < FLIGHT_OUT) {
        // ── Fly to target ────────────────────────────────────────────
        const t = easeInOut(elapsed / FLIGHT_OUT);
        drone.position.lerpVectors(home, target, t);
        drone.rotation.y += 0.06;
        spray.visible = false;

      } else if (elapsed < FLIGHT_OUT + HOVER) {
        // ── Hover arrival ────────────────────────────────────────────
        drone.position.copy(target);
        drone.rotation.y += 0.01;

      } else if (elapsed < FLIGHT_OUT + HOVER + SPRAY_DUR) {
        // ── Spray ────────────────────────────────────────────────────
        drone.position.copy(target);
        drone.rotation.y += 0.02;
        spray.visible = true;

        const sprayT = (elapsed - FLIGHT_OUT - HOVER) / 1000; // seconds into spray
        spray.children.forEach((child, i) => {
          const ring = child as THREE.Mesh;
          const mat  = ring.material as THREE.MeshBasicMaterial;
          // Each ring delays by 0.6s so they cascade
          const phase = (sprayT - i * 0.6) % 2.2;
          if (phase < 0) { mat.opacity = 0; return; }
          const progress = Math.min(phase / 1.8, 1);
          ring.scale.setScalar(0.3 + progress * 7);
          mat.opacity = Math.max(0, 0.85 * (1 - progress * 1.2));
        });

      } else {
        // ── Return home ──────────────────────────────────────────────
        spray.visible = false;
        const t = easeInOut((elapsed - FLIGHT_OUT - HOVER - SPRAY_DUR) / FLIGHT_BACK);
        drone.position.lerpVectors(target, home, t);
        drone.rotation.y += 0.05;
      }
    };

    droneRafRef.current = requestAnimationFrame(step);
    return () => { if (droneRafRef.current) cancelAnimationFrame(droneRafRef.current); };
  }, [activeDroneProblemId]);

  // ── Project problem marker pins to screen every frame ─────────────────────
  useEffect(() => {
    const vecs = PROBLEMS.map(p => new THREE.Vector3(...p.position));

    const loop = () => {
      const viewer = (window as any).gsplatViewer;
      const cam    = viewer?.camera as THREE.PerspectiveCamera | undefined;
      if (cam) {
        const W = window.innerWidth, H = window.innerHeight;
        PROBLEMS.forEach((p, i) => {
          const el = pinRefs.current[p.id];
          if (!el) return;
          const ndc = vecs[i].clone().project(cam);
          const x   = ((ndc.x + 1) / 2) * W;
          const y   = ((1 - ndc.y) / 2) * H;
          const vis = ndc.z >= -1 && ndc.z <= 1 && x > -80 && x < W + 80 && y > -80 && y < H + 80;
          el.style.display   = vis ? 'block' : 'none';
          el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
        });
      }
      markerRafRef.current = requestAnimationFrame(loop);
    };

    markerRafRef.current = requestAnimationFrame(loop);
    return () => { if (markerRafRef.current) cancelAnimationFrame(markerRafRef.current); };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {PROBLEMS.map(p => (
        <div
          key={p.id}
          ref={el => { pinRefs.current[p.id] = el; }}
          style={{ display: 'none', position: 'absolute', top: 0, left: 0 }}
        >
          {/* Badge */}
          <div style={{
            position: 'absolute', top: -22, left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#fff',
            background: p.color, padding: '2px 6px', borderRadius: 3,
            whiteSpace: 'nowrap', boxShadow: `0 0 6px ${p.color}80`,
          }}>
            {p.badge}
          </div>
          {/* Pulse rings */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 34, height: 34, borderRadius: '50%',
            border: `2px solid ${p.color}`,
            animation: 'problem-pulse-ring 2.4s cubic-bezier(0,0.55,0.45,1) infinite',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 34, height: 34, borderRadius: '50%',
            border: `2px solid ${p.color}`,
            animation: 'problem-pulse-ring 2.4s cubic-bezier(0,0.55,0.45,1) 1.2s infinite',
          }} />
          {/* Center dot */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 9, height: 9, borderRadius: '50%',
            background: p.color,
            transform: 'translate(-50%,-50%)',
            boxShadow: `0 0 8px ${p.color}, 0 0 2px #fff`,
          }} />
        </div>
      ))}
    </div>
  );
}
