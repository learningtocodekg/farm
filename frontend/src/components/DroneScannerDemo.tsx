import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { DroneScanner, CaptureResult, Waypoint } from './DroneScanner';
import { GaussianSplatScene } from './GaussianSplatScene';

// ── Sync R3F camera to GS3D viewer every frame ───────────────────────────────
function CameraSync() {
  const { camera } = useThree();
  useFrame(() => {
    const vc = (window as any).gsplatViewer?.camera;
    if (!vc) return;
    camera.position.copy(vc.position);
    camera.quaternion.copy(vc.quaternion);
    (camera as THREE.PerspectiveCamera).fov    = vc.fov;
    (camera as THREE.PerspectiveCamera).aspect = vc.aspect;
    camera.near = vc.near;
    camera.far  = vc.far;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  });
  return null;
}

// ── Mission constants ─────────────────────────────────────────────────────────
const CAPTURE_WIDTH  = 0.4;  // nadir footprint per tile (m)
const STEP           = 0.7;  // grid spacing between waypoints (m)
const OBLIQUE_ANGLE  = 40;   // degrees below horizontal for side shots
const OBLIQUE_HEIGHT = 1.0;  // altitude of oblique cameras (m)

// ── Waypoint grid builder ─────────────────────────────────────────────────────
function buildGrid(cx: number, cz: number, w: number, d: number): Waypoint[] {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;

  const xs: number[] = [];
  for (let x = x0; x <= x1 + STEP * 0.01; x += STEP) xs.push(parseFloat(Math.min(x, x1).toFixed(4)));

  const zs: number[] = [];
  for (let z = z0; z <= z1 + STEP * 0.01; z += STEP) zs.push(parseFloat(Math.min(z, z1).toFixed(4)));

  const out: Waypoint[] = [];
  for (let ri = 0; ri < zs.length; ri++) {
    const rev  = ri % 2 !== 0;
    const cols = rev ? [...xs].reverse() : xs;
    cols.forEach((x, ci) =>
      out.push({ x, z: zs[ri], row: ri, col: rev ? xs.length - 1 - ci : ci }),
    );
  }
  return out;
}

// ── Blue bounding box on the ground ──────────────────────────────────────────
function ScanBounds({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  const y  = 0.02;
  const pts = [
    new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1),
    new THREE.Vector3(x0, y, z0),
  ];
  // corner tick-marks for clarity
  const tick = 0.18;
  const corners = [
    [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0 + tick, y, z0)],
    [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0, y, z0 + tick)],
    [new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1 - tick, y, z0)],
    [new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z0 + tick)],
    [new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1 - tick, y, z1)],
    [new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1, y, z1 - tick)],
    [new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0 + tick, y, z1)],
    [new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z1 - tick)],
  ];
  return (
    <group>
      <Line points={pts} color="#2255ff" lineWidth={1.8} />
      {corners.map((c, i) => <Line key={i} points={c} color="#4488ff" lineWidth={3} />)}
    </group>
  );
}

// ── Serpentine flight path ────────────────────────────────────────────────────
function PathGrid({ waypoints }: { waypoints: Waypoint[] }) {
  const segments = useMemo(() => {
    const rows = new Map<number, THREE.Vector3[]>();
    for (const wp of waypoints) {
      if (!rows.has(wp.row)) rows.set(wp.row, []);
      rows.get(wp.row)!.push(new THREE.Vector3(wp.x, 0.06, wp.z));
    }
    const sorted = Array.from(rows.entries()).sort(([a], [b]) => a - b).map(([, pts]) => pts);
    // inter-row connectors
    const connectors: THREE.Vector3[][] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const last  = sorted[i][sorted[i].length - 1];
      const first = sorted[i + 1][0];
      connectors.push([last, first]);
    }
    return { rows: sorted, connectors };
  }, [waypoints]);

  return (
    <group>
      {segments.rows.map((pts, i) =>
        pts.length >= 2 && <Line key={`r${i}`} points={pts} color="#3366cc" lineWidth={1.5} />,
      )}
      {segments.connectors.map((pts, i) => (
        <Line key={`c${i}`} points={pts} color="#223366" lineWidth={1} dashed dashSize={0.12} gapSize={0.08} />
      ))}
      {waypoints.map((wp, i) => (
        <mesh key={i} position={[wp.x, 0.08, wp.z]}>
          <sphereGeometry args={[0.032, 7, 5]} />
          <meshBasicMaterial color="#5588ff" />
        </mesh>
      ))}
      {waypoints.length > 0 && (
        <mesh position={[waypoints[0].x, 0.22, waypoints[0].z]}>
          <coneGeometry args={[0.07, 0.22, 7]} />
          <meshBasicMaterial color="#44ff88" />
        </mesh>
      )}
      {waypoints.length > 1 && (
        <mesh position={[waypoints[waypoints.length - 1].x, 0.22, waypoints[waypoints.length - 1].z]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.07, 0.22, 7]} />
          <meshBasicMaterial color="#ff4455" />
        </mesh>
      )}
    </group>
  );
}

// ── Slider control ────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 0.1, unit = 'm', onChange }: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <span style={{ color: '#8899aa', minWidth: 64, fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.5 }}>
        {label}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#4488ff', cursor: 'pointer' }}
      />
      <span style={{ color: '#4488ff', minWidth: 40, fontSize: 10, fontFamily: 'monospace', textAlign: 'right' }}>
        {value.toFixed(1)}{unit}
      </span>
    </label>
  );
}

// ── Result lightbox ───────────────────────────────────────────────────────────
const VIEWS = ['nadir', 'north', 'south', 'east', 'west'] as const;

function ResultsPanel({ captures }: { captures: CaptureResult[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<typeof VIEWS[number]>('nadir');
  if (!captures.length) return null;

  const c = sel !== null ? captures[sel] : null;

  const download = () => {
    if (!c) return;
    const a = document.createElement('a');
    a.href = c.views[view].imageDataUrl;
    a.download = `tile_r${c.gridRow}_c${c.gridCol}_${view}.png`;
    a.click();
  };

  return (
    <div
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 9200,
        background: 'rgba(6,8,14,0.94)', border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 12, padding: 14, color: '#fff', fontFamily: 'monospace',
        fontSize: 11, maxWidth: 360, pointerEvents: 'all', backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.65)',
      }}
    >
      <div style={{ fontSize: 9, letterSpacing: 2, color: '#44ff88', marginBottom: 10 }}>
        ✓ {captures.length} tiles · 5 views each
      </div>

      {/* thumbnail strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 180, overflowY: 'auto', marginBottom: c ? 12 : 0 }}>
        {captures.map((cap, i) => (
          <img
            key={i} src={cap.views.nadir.imageDataUrl} alt=""
            onClick={() => { setSel(i); setView('nadir'); }}
            style={{
              width: 54, height: 54, borderRadius: 5, cursor: 'pointer',
              border: `1.5px solid ${sel === i ? '#4488ff' : 'rgba(255,255,255,0.1)'}`,
              transition: 'border-color 0.1s',
            }}
          />
        ))}
      </div>

      {/* detail view */}
      {c && (
        <div>
          {/* view tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {VIEWS.map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? 'rgba(68,136,255,0.2)' : 'transparent',
                border: `1px solid ${view === v ? '#4488ff' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 4, color: view === v ? '#4488ff' : '#556677',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: 9,
                letterSpacing: 1, padding: '3px 8px', textTransform: 'uppercase',
              }}>
                {v}
              </button>
            ))}
            <button onClick={() => setSel(null)} style={{
              marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4, color: '#556677', cursor: 'pointer', fontFamily: 'monospace',
              fontSize: 9, padding: '3px 8px',
            }}>✕</button>
          </div>
          <img src={c.views[view].imageDataUrl} alt={view}
            style={{ width: '100%', aspectRatio: '1', borderRadius: 6, display: 'block', imageRendering: 'pixelated' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, color: '#556677' }}>
            <span>r{c.gridRow} c{c.gridCol} · ({c.worldX.toFixed(2)}, {c.worldZ.toFixed(2)})</span>
            <button onClick={download} style={{
              background: 'transparent', border: '1px solid rgba(68,136,255,0.3)',
              borderRadius: 4, color: '#4488ff', cursor: 'pointer', fontFamily: 'monospace',
              fontSize: 9, padding: '2px 8px',
            }}>↓ save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DroneScannerDemo() {
  const [captures,    setCaptures]    = useState<CaptureResult[]>([]);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);

  // Scan area (sliders only — no 3-D drag)
  const [alt, setAlt] = useState(2.4);
  const [cx,  setCX]  = useState(-0.5);
  const [cz,  setCZ]  = useState(-0.3);
  const [w,   setW]   = useState(2.0);
  const [d,   setD]   = useState(3.0);

  const waypoints = useMemo(() => buildGrid(cx, cz, w, d), [cx, cz, w, d]);

  const onComplete = useCallback((all: CaptureResult[]) => { setCaptures(all); setLastCapture(null); }, []);
  const onFrame    = useCallback((c: CaptureResult)       => setLastCapture(c), []);

  const ui = (
    <>
      {/* ── Scan-area controls (left, vertically centered) ─────────────── */}
      <div
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: '50%', left: 16, transform: 'translateY(-50%)',
          zIndex: 9100, background: 'rgba(6,8,14,0.93)',
          border: '1px solid rgba(68,136,255,0.22)', borderRadius: 12,
          padding: '20px 22px', color: '#fff',
          display: 'flex', flexDirection: 'column', gap: 14,
          minWidth: 270, pointerEvents: 'all', backdropFilter: 'blur(14px)',
          boxShadow: '0 6px 40px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: 3, color: '#4488ff', textTransform: 'uppercase', marginBottom: 2 }}>
          ◈ &nbsp;Scan Zone
        </div>
        <Slider label="Center X"  value={cx}  min={-6} max={6} onChange={setCX} />
        <Slider label="Center Z"  value={cz}  min={-6} max={6} onChange={setCZ} />
        <Slider label="Width"     value={w}   min={0.7} max={8} onChange={setW} />
        <Slider label="Depth"     value={d}   min={0.7} max={8} onChange={setD} />
        <Slider label="Altitude"  value={alt} min={0.5} max={6} onChange={setAlt} />
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px',
          fontSize: 9, color: '#3a4a5a', fontFamily: 'monospace',
        }}>
          <span>Stops</span>       <span style={{ color: '#556677' }}>{waypoints.length}</span>
          <span>Total shots</span> <span style={{ color: '#556677' }}>{waypoints.length * 5}</span>
          <span>Grid step</span>   <span style={{ color: '#556677' }}>{STEP}m</span>
          <span>Tile size</span>   <span style={{ color: '#556677' }}>{CAPTURE_WIDTH}m</span>
          <span>Oblique</span>     <span style={{ color: '#556677' }}>{OBLIQUE_ANGLE}°</span>
        </div>
      </div>

      {/* ── Live capture preview ───────────────────────────────────────── */}
      {lastCapture && captures.length === 0 && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9150,
          background: 'rgba(6,8,14,0.95)', border: '1px solid rgba(68,204,255,0.3)',
          borderRadius: 10, padding: 10, fontFamily: 'monospace', color: '#44ccff',
          fontSize: 9, pointerEvents: 'none', letterSpacing: 1,
        }}>
          <div style={{ marginBottom: 6 }}>◌ LIVE · r{lastCapture.gridRow} c{lastCapture.gridCol}</div>
          <img src={lastCapture.views.nadir.imageDataUrl} alt="live"
            style={{ width: 160, height: 160, display: 'block', borderRadius: 5, imageRendering: 'pixelated' }} />
        </div>
      )}

      {/* ── Completed results ─────────────────────────────────────────── */}
      <ResultsPanel captures={captures} />
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      <Canvas
        camera={{ position: [0, 3, 6], fov: 55, near: 0.05, far: 500 }}
        gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance', alpha: true }}
        dpr={[1, 2]}
        style={{ pointerEvents: 'none' }}
      >
        <CameraSync />
        <GaussianSplatScene url="/scene.ply" onLoad={() => {}} />
        <ScanBounds cx={cx} cz={cz} w={w} d={d} />
        <PathGrid waypoints={waypoints} />
        <DroneScanner
          waypoints={waypoints}
          altitude={alt}
          obliqueAngle={OBLIQUE_ANGLE}
          obliqueHeight={OBLIQUE_HEIGHT}
          captureWidth={CAPTURE_WIDTH}
          overlap={0}
          speed={500}
          settleSeconds={0.4}
          onScanComplete={onComplete}
          onCaptureFrame={onFrame}
        />
      </Canvas>
      {createPortal(ui, document.body)}
    </div>
  );
}
