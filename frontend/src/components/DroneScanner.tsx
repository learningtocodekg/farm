import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';

// ─── Public types ────────────────────────────────────────────────────────────

export type ViewName = 'nadir' | 'north' | 'south' | 'east' | 'west';

export interface CaptureView {
  imageDataUrl: string;
}

export interface CaptureResult {
  gridRow: number;
  gridCol: number;
  worldX: number;
  worldZ: number;
  captureWidth: number;
  /** Nadir raw — kept for backward compatibility */
  imageDataUrl: string;
  /** All 5 views */
  views: Record<ViewName, CaptureView>;
}

export interface DroneScannerProps {
  startX?: number;
  startZ?: number;
  endX?: number;
  endZ?: number;
  altitude?: number;
  captureWidth?: number;
  overlap?: number;
  /** Degrees below horizontal for oblique shots (default 45) */
  obliqueAngle?: number;
  /** Altitude used for the 4 oblique cameras (defaults to altitude) */
  obliqueHeight?: number;
  /** Bump this number to re-fire a preview without changing the waypoint index */
  previewVersion?: number;
  speed?: number;
  /** Seconds to wait at a waypoint before capturing. Default 2. */
  settleSeconds?: number;
  waypoints?: Waypoint[];
  previewWaypointIndex?: number | null;
  /** Full CaptureResult so the caller can display all 5 views */
  onPreviewCapture?: (result: CaptureResult, index: number) => void;
  onScanComplete: (captures: CaptureResult[]) => void;
  onCaptureFrame?: (capture: CaptureResult) => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────

export interface Waypoint {
  x: number;
  z: number;
  row: number;
  col: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAPTURE_RES  = 1024;
const OBLIQUE_FOV  = 90;

const ROW_PALETTE = [
  '#ff4d4d', '#ff944d', '#ffd24d', '#8fff4d',
  '#4dffc8', '#4db0ff', '#984dff', '#ff4dbe',
];

// ─── Path generation ─────────────────────────────────────────────────────────

export function buildWaypoints(
  startX: number,
  endX: number,
  startZ: number,
  endZ: number,
  captureWidth: number,
  overlap: number,
  colStepOverride?: number,
): Waypoint[] {
  const rowStep = Math.max(captureWidth * (1 - overlap), 0.01);
  const colStep = colStepOverride != null ? Math.max(colStepOverride, 0.01) : rowStep;

  const xs: number[] = [];
  for (let x = startX; x <= endX + colStep * 0.01; x += colStep) xs.push(Math.min(x, endX));
  if (xs.length === 0) xs.push(startX);

  const zs: number[] = [];
  for (let z = startZ; z <= endZ + rowStep * 0.01; z += rowStep) zs.push(Math.min(z, endZ));
  if (zs.length === 0) zs.push(startZ);

  const wps: Waypoint[] = [];
  for (let ri = 0; ri < zs.length; ri++) {
    const reversed = ri % 2 !== 0;
    const rowXs = reversed ? [...xs].reverse() : xs;
    rowXs.forEach((x, ci) => {
      wps.push({ x, z: zs[ri], row: ri, col: reversed ? xs.length - 1 - ci : ci });
    });
  }
  return wps;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DroneScanner({
  startX = -10,
  startZ = -10,
  endX = 10,
  endZ = 10,
  altitude = 20,
  captureWidth = 8,
  overlap = 0.2,
  obliqueAngle = 45,
  obliqueHeight,
  previewVersion = 0,
  speed = 800,
  settleSeconds = 2,
  waypoints: waypointsProp,
  previewWaypointIndex,
  onPreviewCapture,
  onScanComplete,
  onCaptureFrame,
}: DroneScannerProps) {
  const oblH = obliqueHeight ?? altitude;

  const [isScanning, setIsScanning] = useState(false);
  const [showPath,   setShowPath]   = useState(false);
  const [progress,   setProgress]   = useState(0);

  const isScanRef      = useRef(false);
  const wpIdxRef       = useRef(0);
  const phaseRef       = useRef<'moving' | 'settling' | 'capturing'>('moving');
  const settleStartRef = useRef(-1); // -1 = not yet initialised this settle
  const moveStartRef   = useRef(0);
  const prevPosRef   = useRef(new THREE.Vector3());
  const targetPosRef = useRef(new THREE.Vector3());
  const capturesRef  = useRef<CaptureResult[]>([]);
  const droneGroupRef = useRef<THREE.Group>(null!);

  const computedWaypoints = useMemo(
    () => buildWaypoints(startX, endX, startZ, endZ, captureWidth, overlap),
    [startX, endX, startZ, endZ, captureWidth, overlap],
  );
  const waypoints = waypointsProp ?? computedWaypoints;

  const pendingPreviewIdx = useRef<number | null>(null);
  useEffect(() => {
    if (previewWaypointIndex != null) pendingPreviewIdx.current = previewWaypointIndex;
  }, [previewWaypointIndex, previewVersion]);

  /**
   * Single offscreen camera reused for all 5 shots per waypoint.
   * FOV and position are overwritten before each render.
   */
  const droneCamera = useMemo(() => {
    const fovY = 2 * Math.atan((captureWidth / 2) / altitude) * (180 / Math.PI);
    const cam = new THREE.PerspectiveCamera(fovY, 1, 0.1, altitude * 10);
    cam.rotation.set(-Math.PI / 2, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }, [captureWidth, altitude]);


  // ── Core render helper ────────────────────────────────────────────────────
  // Renders from the GS3D viewer's camera/renderer so the splat appears in captures.

  const captureView = useCallback(
    (pos: THREE.Vector3, lookAtTarget: THREE.Vector3 | null, fov: number): HTMLCanvasElement => {
      const offscreen = document.createElement('canvas');
      offscreen.width  = CAPTURE_RES;
      offscreen.height = CAPTURE_RES;

      const viewer = (window as any).gsplatViewer;
      if (!viewer?.camera || !viewer?.renderer) return offscreen;

      const cam      = viewer.camera as THREE.PerspectiveCamera;
      const renderer = viewer.renderer as THREE.WebGLRenderer;

      // Save full GS3D camera state
      const savedPos    = cam.position.clone();
      const savedQuat   = cam.quaternion.clone();
      const savedUp     = cam.up.clone();
      const savedFov    = cam.fov;
      const savedAspect = cam.aspect;
      const savedNear   = cam.near;
      const savedFar    = cam.far;

      // Position and FOV for this shot
      cam.position.copy(pos);
      cam.fov    = fov;
      cam.aspect = 1;
      cam.near   = 0.01;
      cam.far    = 1000;
      cam.updateProjectionMatrix();

      if (lookAtTarget) {
        // Oblique: keep GS3D's original up so splat billboards orient correctly
        cam.up.copy(savedUp);
        cam.lookAt(lookAtTarget);
      } else {
        // Nadir: camera is at negative Y, field is at Y≈0 — look toward +Y.
        // Can't use lookAt because savedUp=(0,-1,0) is anti-parallel to +Y look dir
        // (degenerate cross product → garbage orientation). Set rotation directly.
        // Euler(π/2, 0, 0) rotates the default -Z forward to +Y.
        cam.rotation.set(Math.PI / 2, 0, 0);
      }
      cam.updateMatrixWorld(true);

      // Render ONLY splatMesh — threeScene contains GS3D helper overlays (blue circles)
      const savedAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      if (viewer.splatMesh) renderer.render(viewer.splatMesh, cam);
      renderer.autoClear = savedAutoClear;

      // Copy from the GS3D canvas into a square offscreen canvas
      const src  = renderer.domElement;
      const size = Math.min(src.width, src.height);
      offscreen.getContext('2d')!.drawImage(
        src,
        (src.width  - size) / 2, (src.height - size) / 2, size, size,
        0, 0, CAPTURE_RES, CAPTURE_RES,
      );

      // Restore GS3D camera exactly
      cam.position.copy(savedPos);
      cam.quaternion.copy(savedQuat);
      cam.up.copy(savedUp);
      cam.fov    = savedFov;
      cam.aspect = savedAspect;
      cam.near   = savedNear;
      cam.far    = savedFar;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      return offscreen;
    },
    [],
  );

  // ── 5-shot capture per waypoint ───────────────────────────────────────────

  const doCapture = useCallback(
    (wp: Waypoint): CaptureResult => {
      const cx     = wp.x;
      const cz     = wp.z;
      const center = new THREE.Vector3(cx, 0, cz);
      const nadirFov = 2 * Math.atan((captureWidth / 2) / altitude) * (180 / Math.PI);

      // Oblique camera sits at obliqueHeight above a point displaced horizontally
      // so the line from camera to plot centre makes obliqueAngle degrees below horizontal.
      //   tan(angle) = oblH / horizDist  →  horizDist = oblH / tan(angle)
      const rad      = Math.max((obliqueAngle * Math.PI) / 180, 0.01);
      const horizDist = oblH / Math.tan(rad);

      const shoot = (pos: THREE.Vector3, lookAt: THREE.Vector3 | null, fov: number): CaptureView => ({
        imageDataUrl: captureView(pos, lookAt, fov).toDataURL('image/png'),
      });

      // GS3D scene has cameraUp=[0,-1,0] so "above" the field is negative Y
      const views: Record<ViewName, CaptureView> = {
        nadir: shoot(new THREE.Vector3(cx,              -altitude, cz            ), null,   nadirFov),
        north: shoot(new THREE.Vector3(cx,              -oblH,     cz - horizDist), center, OBLIQUE_FOV),
        south: shoot(new THREE.Vector3(cx,              -oblH,     cz + horizDist), center, OBLIQUE_FOV),
        east:  shoot(new THREE.Vector3(cx + horizDist,  -oblH,    cz            ), center, OBLIQUE_FOV),
        west:  shoot(new THREE.Vector3(cx - horizDist,  -oblH,    cz            ), center, OBLIQUE_FOV),
      };

      // Restore nadir FOV so the footprint indicator stays calibrated
      droneCamera.fov = nadirFov;
      droneCamera.updateProjectionMatrix();

      return {
        gridRow: wp.row, gridCol: wp.col,
        worldX: cx, worldZ: cz,
        captureWidth,
        imageDataUrl: views.nadir.imageDataUrl,
        views,
      };
    },
    [altitude, captureWidth, obliqueAngle, oblH, droneCamera, captureView],
  );

  // ── Scan control ──────────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    if (!waypoints.length) return;
    capturesRef.current = [];
    wpIdxRef.current    = 0;
    setProgress(0);
    setIsScanning(true);
    const first = waypoints[0];
    droneCamera.position.set(first.x, -altitude, first.z);
    droneCamera.rotation.set(-Math.PI / 2, 0, 0);
    droneCamera.updateMatrixWorld(true);
    prevPosRef.current.copy(droneCamera.position);
    targetPosRef.current.copy(droneCamera.position);
    settleStartRef.current = -1;
    phaseRef.current  = 'settling';
    isScanRef.current = true;
  }, [waypoints, altitude, droneCamera]);

  const stopScan = useCallback(() => {
    isScanRef.current = false;
    setIsScanning(false);
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────

  useFrame((state) => {
    if (pendingPreviewIdx.current !== null && !isScanRef.current) {
      const idx = pendingPreviewIdx.current;
      pendingPreviewIdx.current = null;
      const wp = waypoints[idx];
      if (wp) onPreviewCapture?.(doCapture(wp), idx);
    }

    if (!isScanRef.current) return;
    const now = state.clock.elapsedTime;
    const idx = wpIdxRef.current;

    if (idx >= waypoints.length) {
      isScanRef.current = false;
      setIsScanning(false);
      onScanComplete(capturesRef.current);
      return;
    }

    if (phaseRef.current === 'settling') {
      if (settleStartRef.current < 0) settleStartRef.current = now;
      if (now - settleStartRef.current >= settleSeconds) phaseRef.current = 'capturing';
      return;
    }

    if (phaseRef.current === 'capturing') {
      const wp = waypoints[idx];
      if (droneGroupRef.current) droneGroupRef.current.position.set(wp.x, -altitude, wp.z);

      const result = doCapture(wp);
      capturesRef.current.push(result);
      onCaptureFrame?.(result);

      const next = idx + 1;
      wpIdxRef.current = next;
      setProgress(next);

      if (next >= waypoints.length) {
        isScanRef.current = false;
        setIsScanning(false);
        onScanComplete(capturesRef.current);
        return;
      }

      droneCamera.position.set(wp.x, -altitude, wp.z);
      prevPosRef.current.copy(droneCamera.position);
      targetPosRef.current.set(waypoints[next].x, -altitude, waypoints[next].z);
      moveStartRef.current = now;
      phaseRef.current = 'moving';

    } else {
      const raw = Math.min((now - moveStartRef.current) / (speed / 1000), 1);
      const t   = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;
      droneCamera.position.lerpVectors(prevPosRef.current, targetPosRef.current, t);
      if (droneGroupRef.current) droneGroupRef.current.position.copy(droneCamera.position);
      if (raw >= 1) { droneCamera.position.copy(targetPosRef.current); settleStartRef.current = -1; phaseRef.current = 'settling'; }
    }
  });

  // ── Path visualisation ────────────────────────────────────────────────────

  const pathRows = useMemo(() => {
    if (!showPath || waypoints.length === 0) return [];
    const map = new Map<number, THREE.Vector3[]>();
    for (const wp of waypoints) {
      if (!map.has(wp.row)) map.set(wp.row, []);
      map.get(wp.row)!.push(new THREE.Vector3(wp.x, 0.15, wp.z));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .filter(([, pts]) => pts.length >= 2)
      .map(([ri, pts]) => ({ points: pts, color: ROW_PALETTE[ri % ROW_PALETTE.length] }));
  }, [showPath, waypoints]);

  const rowConnections = useMemo(() => {
    if (!showPath || waypoints.length === 0) return [] as THREE.Vector3[][];
    const byRow = new Map<number, { first: THREE.Vector3; last: THREE.Vector3 }>();
    for (const wp of waypoints) {
      const pt = new THREE.Vector3(wp.x, 0.15, wp.z);
      if (!byRow.has(wp.row)) byRow.set(wp.row, { first: pt.clone(), last: pt.clone() });
      else byRow.get(wp.row)!.last = pt;
    }
    const sorted = Array.from(byRow.entries()).sort(([a], [b]) => a - b);
    const conns: THREE.Vector3[][] = [];
    for (let i = 0; i < sorted.length - 1; i++) conns.push([sorted[i][1].last, sorted[i+1][1].first]);
    return conns;
  }, [showPath, waypoints]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const half = captureWidth / 2;

  return (
    <>
      <group ref={droneGroupRef} visible={isScanning}>
        <mesh><boxGeometry args={[1.4, 0.3, 1.4]} /><meshBasicMaterial color="#00ff88" wireframe /></mesh>
        <mesh rotation={[0,  Math.PI/4, 0]}><boxGeometry args={[2.6, 0.08, 0.18]} /><meshBasicMaterial color="#00ff88" wireframe /></mesh>
        <mesh rotation={[0, -Math.PI/4, 0]}><boxGeometry args={[2.6, 0.08, 0.18]} /><meshBasicMaterial color="#00ff88" wireframe /></mesh>
        <Line points={[new THREE.Vector3(0,0,0), new THREE.Vector3(0,altitude-0.1,0)]} color="#44ff88" lineWidth={1} />
        <mesh position={[0,altitude-0.05,0]} rotation={[-Math.PI/2,0,0]}>
          <planeGeometry args={[captureWidth,captureWidth]} />
          <meshBasicMaterial color="#ffff44" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <Line
          points={[
            new THREE.Vector3(-half,altitude-0.08,-half), new THREE.Vector3(half,altitude-0.08,-half),
            new THREE.Vector3(half,altitude-0.08,half),   new THREE.Vector3(-half,altitude-0.08,half),
            new THREE.Vector3(-half,altitude-0.08,-half),
          ]}
          color="#ffff44" lineWidth={1.5}
        />
      </group>

      {showPath && (
        <group>
          {pathRows.map((row, i) => <Line key={`r${i}`} points={row.points} color={row.color} lineWidth={2.5} />)}
          {rowConnections.map((pts, i) => <Line key={`c${i}`} points={pts} color="#555566" lineWidth={1} dashed dashSize={0.4} gapSize={0.3} />)}
          {waypoints.map((wp, i) => (
            <mesh key={`d${i}`} position={[wp.x, 0.28, wp.z]}>
              <sphereGeometry args={[0.14, 8, 6]} />
              <meshBasicMaterial color={ROW_PALETTE[wp.row % ROW_PALETTE.length]} />
            </mesh>
          ))}
          {waypoints.length > 0 && <mesh position={[waypoints[0].x, 0.7, waypoints[0].z]}><coneGeometry args={[0.38,1.1,8]} /><meshBasicMaterial color="#00ff88" /></mesh>}
          {waypoints.length > 1 && (
            <mesh position={[waypoints[waypoints.length-1].x, 0.7, waypoints[waypoints.length-1].z]} rotation={[Math.PI,0,0]}>
              <coneGeometry args={[0.38,1.1,8]} /><meshBasicMaterial color="#ff4444" />
            </mesh>
          )}
        </group>
      )}

      <Html fullscreen zIndexRange={[9000, 0]} pointerEvents="none">
        <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
          <div style={{
            position:'absolute', top:16, left:'50%', transform:'translateX(-50%)',
            background:'rgba(6,8,14,0.88)', border:'1px solid rgba(255,255,255,0.10)',
            borderRadius:10, padding:'12px 18px', color:'#fff',
            fontFamily:'"Courier New",Courier,monospace', fontSize:12,
            minWidth:300, userSelect:'none', backdropFilter:'blur(10px)',
            boxShadow:'0 4px 32px rgba(0,0,0,0.65)', pointerEvents:'all',
          }}>
            <div style={{ fontSize:9, letterSpacing:3, color:'#44ff99', marginBottom:10, textTransform:'uppercase' }}>◈&nbsp; Drone Scanner</div>
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <button onClick={isScanning ? stopScan : startScan} disabled={!waypoints.length} style={btn(isScanning?'#7a1515':'#1a5c32')}>
                {isScanning ? '■  ABORT' : '▶  START SCAN'}
              </button>
              <button onClick={() => setShowPath(v => !v)} style={btn(showPath?'#153a6e':'#2a2a3a')}>
                {showPath ? '◉ HIDE PATH' : '◎ SHOW PATH'}
              </button>
            </div>
            <div style={{ color:'#7788aa', fontSize:10, marginBottom: progress>0||isScanning ? 10 : 0, lineHeight:1.6 }}>
              {waypoints.length} waypoints · 5 shots each · alt {altitude} m
            </div>
            {(isScanning || progress > 0) && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:5, color:'#aabbcc' }}>
                  <span style={{ color: isScanning?'#44ccff':'#44ff88' }}>{isScanning?'● SCANNING':'✓ COMPLETE'}</span>
                  <span>{progress} / {waypoints.length} ({Math.round(progress/Math.max(waypoints.length,1)*100)}%)</span>
                </div>
                <div style={{ height:5, background:'rgba(255,255,255,0.07)', borderRadius:3, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${progress/Math.max(waypoints.length,1)*100}%`, background:isScanning?'linear-gradient(90deg,#3399ff,#77eeff)':'#44ff88', borderRadius:3, transition:'width 0.25s ease' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </Html>
    </>
  );
}

function btn(bg: string): React.CSSProperties {
  return { background:bg, border:'1px solid rgba(255,255,255,0.13)', borderRadius:5, color:'#eef', cursor:'pointer', fontSize:11, fontFamily:'"Courier New",Courier,monospace', fontWeight:700, letterSpacing:1, padding:'5px 13px', transition:'background 0.15s', whiteSpace:'nowrap' };
}
