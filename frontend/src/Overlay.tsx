import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type SplatStatus = 'loading' | 'loaded' | 'error';
type CalibStep = 'idle' | 'picking' | 'angle';
type PickPhase = 'start' | 'end' | 'leftCrop' | 'rightCrop';

interface CameraSnapshot {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
}

interface CalibState {
  upVector: THREE.Vector3 | null;       // derived from ground points after 4th pick
  flightStart: [number, number, number] | null;
  flightEnd:   [number, number, number] | null;
  leftCrop:    [number, number, number] | null;
  rightCrop:   [number, number, number] | null;
  flightY: number;
  leftCamera:  CameraSnapshot | null;
  rightCamera: CameraSnapshot | null;
}

function fmt2(n: number) { return n.toFixed(2); }
function getViewer() { return (window as any).gsplatViewer ?? null; }

// Bootstrap "up" used only during Step 1 picking — matches the viewer's cameraUp setting.
// The real upVector is computed from ground points after all 4 picks complete.
const BOOTSTRAP_UP = new THREE.Vector3(0, -1, 0);

// ── 3D ground-plane helpers (all use the user-defined upVector) ───────────────

// Project a 3D point onto the ground plane (plane with given normal through origin),
// then measure signed distance from 'start' along the perpendicular-to-flight direction.
// "Perpendicular to flight" lives IN the ground plane.

function flightDir3(
  start: [number, number, number],
  end:   [number, number, number],
  up: THREE.Vector3,
): THREE.Vector3 {
  const d = new THREE.Vector3(
    end[0] - start[0], end[1] - start[1], end[2] - start[2],
  );
  // Remove any component along up so direction lies in ground plane
  d.addScaledVector(up, -d.dot(up)).normalize();
  return d;
}

function perpDir3(
  start: [number, number, number],
  end:   [number, number, number],
  up: THREE.Vector3,
): THREE.Vector3 {
  const fwd = flightDir3(start, end, up);
  // perp = up × fwd  (gives a vector in the ground plane, 90° to fwd)
  return new THREE.Vector3().crossVectors(up, fwd).normalize();
}

// Project point p onto the perpendicular ray through 'start' in the ground plane.
// Returns the snapped 3D position.
function projectOntoPerpRay(
  p: [number, number, number],
  start: [number, number, number],
  end:   [number, number, number],
  up: THREE.Vector3,
): [number, number, number] {
  const perp = perpDir3(start, end, up);
  const rel = new THREE.Vector3(p[0] - start[0], p[1] - start[1], p[2] - start[2]);
  const t = rel.dot(perp);
  return [
    start[0] + perp.x * t,
    start[1] + perp.y * t,
    start[2] + perp.z * t,
  ];
}

// Signed distance from start along the perp direction
function signedPerpDist(
  p:     [number, number, number],
  start: [number, number, number],
  end:   [number, number, number],
  up: THREE.Vector3,
): number {
  const perp = perpDir3(start, end, up);
  return (
    (p[0] - start[0]) * perp.x +
    (p[1] - start[1]) * perp.y +
    (p[2] - start[2]) * perp.z
  );
}

// ── Screen helpers ────────────────────────────────────────────────────────────

function worldToScreen(
  x: number, y: number, z: number,
  camera: THREE.PerspectiveCamera,
  w: number, h: number,
): [number, number] | null {
  const v = new THREE.Vector3(x, y, z).project(camera);
  if (v.z > 1) return null;
  return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
}

function computeFrameWidth(fovDeg: number, distance: number, aspect: number): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  return 2 * distance * Math.tan(fovRad / 2) * aspect;
}

const PICK_LABELS: Record<PickPhase, string> = {
  start:     'Click the START of the flight line',
  end:       'Click the END of the flight line',
  leftCrop:  'Click on the LEFT crop row (on the perpendicular line)',
  rightCrop: 'Click on the RIGHT crop row (on the perpendicular line)',
};
const PICK_ORDER: PickPhase[] = ['start', 'end', 'leftCrop', 'rightCrop'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function Overlay() {
  const [status, setStatus]       = useState<SplatStatus>('loading');
  const [calibStep, setCalibStep] = useState<CalibStep>('idle');
  const [pickPhase, setPickPhase] = useState<PickPhase>('start');
  const [calib, setCalib]         = useState<CalibState>({
    upVector: null,
    flightStart: null, flightEnd: null,
    leftCrop: null, rightCrop: null,
    flightY: 0,
    leftCamera: null, rightCamera: null,
  });
  const [liveHeight, setLiveHeight] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mouseWorld, setMouseWorld] = useState<[number, number, number] | null>(null);
  const [svgSize, setSvgSize]       = useState({ w: window.innerWidth, h: window.innerHeight });

  const wsHandlerRef    = useRef<((e: KeyboardEvent) => void) | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const cropPoleRef     = useRef<THREE.Mesh | null>(null);
  const rafRef           = useRef<number | null>(null);
  const calibRef     = useRef(calib);
  useEffect(() => { calibRef.current = calib; }, [calib]);

  useEffect(() => {
    const onResize = () => setSvgSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onLoaded = () => setStatus('loaded');
    const onError  = () => setStatus('error');
    window.addEventListener('splat:loaded', onLoaded);
    window.addEventListener('splat:error', onError);
    return () => {
      window.removeEventListener('splat:loaded', onLoaded);
      window.removeEventListener('splat:error', onError);
    };
  }, []);

  useEffect(() => {
    if (calibStep === 'idle') stopAngleMode();
  }, [calibStep]);

  // ── screenToWorld ─────────────────────────────────────────────────────────
  // Intersects the pick ray with the ground plane (normal = up, through origin).

  function screenToWorld(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    upVec: THREE.Vector3,
  ): [number, number, number] | null {
    const viewer = getViewer();
    if (!viewer) return null;
    const cam = viewer.camera as THREE.PerspectiveCamera;

    const ndcX = ((clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((clientY - rect.top)  / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);

    const plane = new THREE.Plane(upVec.clone().normalize(), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return [hit.x, hit.y, hit.z];
  }

  // ── Step 1: picking ───────────────────────────────────────────────────────

  const startPicking = () => {
    enterPickingStep();
  };

  function enterPickingStep() {
    const viewer = getViewer();
    if (!viewer) return;
    if (viewer.controls) viewer.controls.enabled = false;

    // Top-down: camera at (0,-15,0) — negative Y is "above" in this scene (cameraUp=[0,-1,0]).
    // camera.up points toward -Z so the view is oriented with the farm rows vertical on screen.
    viewer.camera.position.set(0, -15, 0);
    viewer.camera.up.set(0, 0, -1);
    viewer.camera.lookAt(0, 0, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld();

    setCalibStep('picking');
    setPickPhase('start');
    setMouseWorld(null);
    setCalib(c => ({
      ...c,
      upVector: null,
      flightStart: null, flightEnd: null,
      leftCrop: null, rightCrop: null,
      flightY: 0, leftCamera: null, rightCamera: null,
    }));
  }

  const handlePickerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouseWorld(screenToWorld(e.clientX, e.clientY, rect, BOOTSTRAP_UP));
  };

  const handlePickerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xyz = screenToWorld(e.clientX, e.clientY, rect, BOOTSTRAP_UP);
    if (!xyz) return;

    setPickPhase(prev => {
      if (prev === 'start') {
        setCalib(c => ({ ...c, flightStart: xyz }));
        return 'end';
      }
      if (prev === 'end') {
        setCalib(c => ({ ...c, flightEnd: xyz }));
        return 'leftCrop';
      }
      if (prev === 'leftCrop') {
        // Can't snap yet — no upVector. Store raw; will snap after upVector is derived.
        setCalib(c => ({ ...c, leftCrop: xyz }));
        return 'rightCrop';
      }
      // rightCrop — derive upVector from the 3 ground points, then snap crops and enter angle mode
      setCalib(current => {
        if (!current.flightStart || !current.flightEnd || !current.leftCrop) {
          return { ...current, rightCrop: xyz };
        }

        // Derive ground-plane normal from the 3 picked ground points
        const v1 = new THREE.Vector3(
          current.flightEnd[0] - current.flightStart[0],
          current.flightEnd[1] - current.flightStart[1],
          current.flightEnd[2] - current.flightStart[2],
        );
        const v2 = new THREE.Vector3(
          current.leftCrop[0] - current.flightStart[0],
          current.leftCrop[1] - current.flightStart[1],
          current.leftCrop[2] - current.flightStart[2],
        );
        const derived = new THREE.Vector3().crossVectors(v1, v2).normalize();
        // Make it point toward the camera (camera is at y=-15, so pick the sign with negative Y)
        if (derived.y > 0) derived.negate();
        const upVec = derived;

        // Now snap both crop picks onto the perpendicular ray using the real upVector
        const leftSnapped  = projectOntoPerpRay(current.leftCrop, current.flightStart, current.flightEnd, upVec);
        const rightSnapped = projectOntoPerpRay(xyz,              current.flightStart, current.flightEnd, upVec);

        const next = { ...current, upVector: upVec, leftCrop: leftSnapped, rightCrop: rightSnapped };
        enterAngleMode(next.flightStart!, leftSnapped, rightSnapped);
        return next;
      });
      setCalibStep('angle');
      return 'rightCrop';
    });
  };

  // ── Step 2: angle mode ────────────────────────────────────────────────────

  function enterAngleMode(
    flightStart: [number, number, number],
    leftCropPt:  [number, number, number],
    rightCropPt: [number, number, number],
  ) {
    const viewer = getViewer();
    if (!viewer) return;
    if (viewer.controls) viewer.controls.enabled = false;

    // Use viewer's hardcoded up directly — all picks landed on y=0 so derived up = (0,-1,0) anyway
    const sceneUp = new THREE.Vector3(0, -1, 0);

    const leftPt  = new THREE.Vector3(...leftCropPt);
    const rightPt = new THREE.Vector3(...rightCropPt);

    // Direction from right crop toward left crop (the "look" direction)
    const lookDir = leftPt.clone().sub(rightPt).normalize();

    // Place camera behind + above the left crop row.
    // Negative Y = up in this scene (cameraUp=[0,-1,0]).
    // Push back 3 units from the row, and start 2 units above ground (Y - 2).
    const startPt = new THREE.Vector3(...flightStart);
    const initOffset = 3;
    const camPos = leftPt.clone()
      .addScaledVector(lookDir, initOffset)
      .setY(startPt.y - 2);                  // start 2 units above ground level

    // camera.up = sceneUp, look toward leftPt from camPos
    viewer.camera.position.copy(camPos);
    viewer.camera.up.copy(sceneUp);
    viewer.camera.lookAt(leftPt);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld();

    const heightAboveGround = 0;
    setLiveHeight(heightAboveGround);

    // Teal pole at left crop row so the operator can see which row they're framing
    if (viewer.scene) {
      const geo = new THREE.CylinderGeometry(0.05, 0.05, 100, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false });
      const pole = new THREE.Mesh(geo, mat);
      pole.position.copy(leftPt);
      pole.renderOrder = 999;
      viewer.scene.add(pole);
      cropPoleRef.current = pole;
    }

    const lockedQuat = viewer.camera.quaternion.clone();

    // W/S: move camera up/down in scene Y (negative Y = up in this scene)
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!['w', 's', 'y', 'u'].includes(key)) return;
      e.preventDefault();
      const v = getViewer();
      if (!v) return;
      const cam = v.camera as THREE.PerspectiveCamera;
      cam.quaternion.copy(lockedQuat);
      if (key === 'w' || key === 's') {
        // W = up in scene = negative Y; S = down = positive Y
        const dir = key === 'w' ? -1 : 1;
        cam.position.y += dir * 0.1;
      } else {
        cam.fov = Math.max(5, Math.min(120, cam.fov + (key === 'u' ? 2 : -2)));
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    };

    const onWheel = (e: WheelEvent) => {
      const v = getViewer();
      if (!v) return;
      const cam = v.camera as THREE.PerspectiveCamera;
      cam.fov = Math.max(5, Math.min(120, cam.fov + e.deltaY * 0.05));
      cam.updateProjectionMatrix();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    wsHandlerRef.current = onKey;
    wheelHandlerRef.current = onWheel;

    // Poll camera Y position (negative Y = higher in this scene)
    const poll = () => {
      const v = getViewer();
      if (v) setLiveHeight(v.camera.position.y);
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
  }

  function stopAngleMode() {
    if (wsHandlerRef.current) {
      window.removeEventListener('keydown', wsHandlerRef.current);
      wsHandlerRef.current = null;
    }
    if (wheelHandlerRef.current) {
      window.removeEventListener('wheel', wheelHandlerRef.current);
      wheelHandlerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const viewer = getViewer();
    if (viewer?.controls) viewer.controls.enabled = true;
    if (cropPoleRef.current) {
      if (viewer?.scene) viewer.scene.remove(cropPoleRef.current);
      cropPoleRef.current.geometry.dispose();
      (cropPoleRef.current.material as THREE.Material).dispose();
      cropPoleRef.current = null;
    }
  }

  // ── Confirm / cancel / save ───────────────────────────────────────────────

  const confirmAngle = () => {
    const viewer = getViewer();
    if (!viewer) return;
    const cam = viewer.camera as THREE.PerspectiveCamera;

    const leftSnap: CameraSnapshot = {
      position:   [cam.position.x, cam.position.y, cam.position.z],
      quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      fov: cam.fov,
    };
    // Right camera: same position, rotated 180° around scene Y to face the right crop row
    const sceneUp = new THREE.Vector3(0, -1, 0);
    const q = leftSnap.quaternion;
    const rightQ = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
    rightQ.premultiply(new THREE.Quaternion().setFromAxisAngle(sceneUp, Math.PI));
    const rightSnap: CameraSnapshot = {
      position:   leftSnap.position,
      quaternion: [rightQ.x, rightQ.y, rightQ.z, rightQ.w],
      fov: leftSnap.fov,
    };
    setCalib(c => ({ ...c, leftCamera: leftSnap, rightCamera: rightSnap, flightY: liveHeight }));
  };

  const cancelCalibration = () => {
    stopAngleMode();
    const viewer = getViewer();
    if (viewer?.controls) viewer.controls.enabled = true;
    setCalibStep('idle');
    setPickPhase('start');
    setMouseWorld(null);
  };

  const finishCalibration = () => {
    stopAngleMode();
    setCalibStep('idle');
    setMouseWorld(null);
  };

  const saveFlightPath = async () => {
    if (!canSave) return;
    setSaveStatus('saving');
    try {
      const up = BOOTSTRAP_UP;
      const camPos = new THREE.Vector3(...calib.leftCamera!.position);
      const leftPt = new THREE.Vector3(...calib.leftCrop!);
      const camToCropDist = camPos.distanceTo(leftPt);
      const aspect = window.innerWidth / window.innerHeight;
      const frameWidth = computeFrameWidth(calib.leftCamera!.fov, camToCropDist, aspect);

      const body = {
        leftCamera:  calib.leftCamera,
        rightCamera: calib.rightCamera,
        flightLine: {
          start: calib.flightStart,
          end:   calib.flightEnd,
          y:     calib.flightY,
        },
        crops: {
          leftOffset:  signedPerpDist(calib.leftCrop!,  calib.flightStart!, calib.flightEnd!, up),
          rightOffset: signedPerpDist(calib.rightCrop!, calib.flightStart!, calib.flightEnd!, up),
        },
        frameWidth,
      };
      const res = await fetch('/api/save-flight-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ── SVG overlay ───────────────────────────────────────────────────────────

  const svgOverlay = (() => {
    if (calibStep !== 'picking') return null;
    const viewer = getViewer();
    if (!viewer) return null;
    const cam = viewer.camera as THREE.PerspectiveCamera;
    const { w, h } = svgSize;
    // Use BOOTSTRAP_UP for the perp line preview during picking (upVector not derived yet)
    const up = BOOTSTRAP_UP;
    const els: React.ReactNode[] = [];

    const dot = (key: string, x: number, y: number, z: number, fill: string) => {
      const s = worldToScreen(x, y, z, cam, w, h);
      if (!s) return null;
      return <circle key={key} cx={s[0]} cy={s[1]} r={7} fill={fill} stroke="white" strokeWidth={1.5} />;
    };

    if (calib.flightStart)
      els.push(dot('s-dot', ...calib.flightStart, '#ff69b4'));

    if (pickPhase === 'end' && calib.flightStart && mouseWorld) {
      const s = worldToScreen(...calib.flightStart, cam, w, h);
      const m = worldToScreen(...mouseWorld, cam, w, h);
      if (s && m) els.push(
        <line key="line-live" x1={s[0]} y1={s[1]} x2={m[0]} y2={m[1]}
          stroke="#ff69b4" strokeWidth={1.5} strokeDasharray="6 3" />
      );
    }

    if (calib.flightStart && calib.flightEnd) {
      const s = worldToScreen(...calib.flightStart, cam, w, h);
      const e = worldToScreen(...calib.flightEnd,   cam, w, h);
      if (s && e) {
        els.push(<line key="line" x1={s[0]} y1={s[1]} x2={e[0]} y2={e[1]} stroke="#ff69b4" strokeWidth={2} />);
        els.push(dot('e-dot', ...calib.flightEnd, '#ff69b4'));
      }
    }

    // Perp line through start — extend along perpDir3 in both directions
    if (calib.flightStart && calib.flightEnd && (pickPhase === 'leftCrop' || pickPhase === 'rightCrop')) {
      const perp = perpDir3(calib.flightStart, calib.flightEnd, up);
      const FAR = 50;
      const sx = calib.flightStart[0], sy = calib.flightStart[1], sz = calib.flightStart[2];
      const p1 = worldToScreen(sx + perp.x * FAR, sy + perp.y * FAR, sz + perp.z * FAR, cam, w, h);
      const p2 = worldToScreen(sx - perp.x * FAR, sy - perp.y * FAR, sz - perp.z * FAR, cam, w, h);
      if (p1 && p2) els.push(
        <line key="perp" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
          stroke="#00e5ff" strokeWidth={1.5} strokeDasharray="8 4" opacity={0.8} />
      );
    }

    if (calib.leftCrop)  els.push(dot('l-dot', ...calib.leftCrop,  '#60a5fa'));
    if (calib.rightCrop) els.push(dot('r-dot', ...calib.rightCrop, '#c084fc'));

    return els;
  })();

  // ── Derived values ────────────────────────────────────────────────────────

  const derivedFrameWidth = (() => {
    if (!calib.leftCamera || !calib.leftCrop) return null;
    const dist = new THREE.Vector3(...calib.leftCamera.position)
      .distanceTo(new THREE.Vector3(...calib.leftCrop));
    return computeFrameWidth(calib.leftCamera.fov, dist, window.innerWidth / window.innerHeight);
  })();

  const canSave = !!(calib.leftCamera && calib.rightCamera &&
    calib.flightStart && calib.flightEnd && calib.leftCrop && calib.rightCrop);

  const statusLabel = { loading: 'Loading…', loaded: 'Ready', error: 'Failed to load' }[status];
  const statusColor = { loading: 'text-yellow-400', loaded: 'text-green-400', error: 'text-red-400' }[status];
  const phaseIdx = PICK_ORDER.indexOf(pickPhase);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Status pill */}
      <div data-ui="true"
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-sm font-mono select-none">
        <span className={statusColor}>{statusLabel}</span>
        {status === 'loaded' && <>
          <span className="text-white/20">·</span>
          <span className="text-white/50 capitalize">
            {calibStep === 'idle'    ? 'Ready'
              : calibStep === 'picking' ? 'Calibrating (Picking)'
              : 'Calibrating (Angle)'}
          </span>
        </>}
      </div>

      {/* Calibrate button */}
      {calibStep === 'idle' && status === 'loaded' && (
        <button data-ui="true" onClick={startPicking}
          className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-sm font-mono text-white/70 hover:text-white hover:border-white/30 transition-colors select-none">
          Calibrate
        </button>
      )}

      {/* SVG overlay (step 1) */}
      {calibStep === 'picking' && (
        <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}
          width={svgSize.w} height={svgSize.h}>
          {svgOverlay}
        </svg>
      )}

      {/* Click blocker (step 1) */}
      {calibStep === 'picking' && (
        <div onClick={handlePickerClick} onMouseMove={handlePickerMouseMove}
          style={{ position: 'fixed', inset: 0, cursor: 'crosshair', pointerEvents: 'auto', zIndex: 9 }} />
      )}

      {/* ── Step 1 panel ── */}
      {calibStep === 'picking' && (
        <div data-ui="true" className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none" style={{ zIndex: 20 }}>
          <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-4 flex flex-col items-center gap-3 pointer-events-auto" style={{ minWidth: 420 }}>
            <div className="text-white/40 text-[10px] uppercase tracking-widest">Step 1 of 2 — Map Points</div>

            <div className="flex items-center gap-2 w-full justify-center">
              {PICK_ORDER.map((p, i) => {
                const done   = PICK_ORDER.indexOf(p) < phaseIdx;
                const active = p === pickPhase;
                const labels = { start: 'Start', end: 'End', leftCrop: 'L.Crop', rightCrop: 'R.Crop' };
                return (
                  <div key={p} className="flex items-center gap-2">
                    {i > 0 && <div className="w-6 h-px bg-white/20" />}
                    <div className="flex flex-col items-center gap-1">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors
                        ${done ? 'bg-green-500 text-white' : active ? 'bg-white text-black' : 'bg-white/10 text-white/30'}`}>
                        {done ? '✓' : i + 1}
                      </span>
                      <span className={`text-[9px] font-mono ${active ? 'text-white' : done ? 'text-green-400' : 'text-white/30'}`}>
                        {labels[p]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-white/70 text-xs text-center font-mono">{PICK_LABELS[pickPhase]}</p>

            {(pickPhase === 'leftCrop' || pickPhase === 'rightCrop') && (
              <p className="text-cyan-400/70 text-[10px] text-center font-mono">
                Cyan line = perpendicular to flight line. Click anywhere — point snaps to the line.
              </p>
            )}

            <div className="flex gap-3 text-[10px] font-mono">
              {calib.flightStart && <span className="text-pink-400">S({fmt2(calib.flightStart[0])},{fmt2(calib.flightStart[2])})</span>}
              {calib.flightEnd   && <span className="text-pink-400">E({fmt2(calib.flightEnd[0])},{fmt2(calib.flightEnd[2])})</span>}
              {calib.leftCrop    && <span className="text-blue-400">L({fmt2(calib.leftCrop[0])},{fmt2(calib.leftCrop[2])})</span>}
            </div>

            <button onClick={cancelCalibration} className="text-white/30 text-xs hover:text-white/60 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Click blocker (step 2) */}
      {calibStep === 'angle' && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', zIndex: 9 }} />
      )}

      {/* ── Step 2 panel ── */}
      {calibStep === 'angle' && (
        <div data-ui="true" className="absolute inset-x-0 bottom-8 flex justify-center" style={{ zIndex: 20 }}>
          <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-4 flex flex-col items-center gap-3" style={{ minWidth: 400 }}>
            <div className="text-white/40 text-[10px] uppercase tracking-widest">Step 2 of 2 — Drone Height & Zoom</div>

            <p className="text-white/70 text-xs text-center font-mono leading-relaxed">
              View is locked perpendicular to the flight line.<br />
              <kbd className="bg-white/10 px-1 rounded">W</kbd> / <kbd className="bg-white/10 px-1 rounded">S</kbd> moves up/down in world space. Scroll to zoom.<br />
              Click <span className="text-yellow-300">"Set Angle"</span> when the frame covers the crop rows correctly.
            </p>

            <div className="text-[10px] font-mono text-white/50 text-center flex flex-col gap-0.5">
              <span>Height above ground: <span className="text-white">{liveHeight.toFixed(3)}</span></span>
              {calib.leftCamera && derivedFrameWidth !== null && (
                <span>Frame width: <span className="text-green-400">{derivedFrameWidth.toFixed(3)}</span> world units</span>
              )}
            </div>

            <div className="flex gap-2 w-full">
              <button onClick={confirmAngle}
                className="flex-1 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-mono transition-colors">
                Set Angle
              </button>
              {calib.leftCamera && <span className="flex items-center text-green-400 text-[10px] font-mono px-2">✓ set</span>}
            </div>

            <div className="flex gap-4 w-full">
              {canSave && (
                <button onClick={saveFlightPath} disabled={saveStatus === 'saving'}
                  className={`flex-1 py-2 rounded-lg text-xs font-mono transition-colors ${
                    saveStatus === 'saved' ? 'bg-green-600/60 text-green-200' :
                    saveStatus === 'error' ? 'bg-red-600/60 text-red-200'   :
                    'bg-green-700/40 hover:bg-green-700/60 text-white border border-green-500/30'
                  }`}>
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved!' : saveStatus === 'error' ? '✗ Failed' : 'Save flight-path.json'}
                </button>
              )}
              <button onClick={finishCalibration}
                className="flex-1 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 text-xs font-mono transition-colors">
                {canSave ? 'Done' : 'Cancel'}
              </button>
            </div>

            <div className="flex gap-3 text-[10px] font-mono text-white/30 flex-wrap justify-center">
              {calib.leftCrop && calib.flightStart && calib.flightEnd && <>
                <span className="text-blue-400">L-offset: {signedPerpDist(calib.leftCrop, calib.flightStart, calib.flightEnd, BOOTSTRAP_UP).toFixed(3)}</span>
                <span>·</span>
                <span className="text-purple-400">R-offset: {calib.rightCrop ? signedPerpDist(calib.rightCrop, calib.flightStart, calib.flightEnd, BOOTSTRAP_UP).toFixed(3) : '—'}</span>
              </>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
