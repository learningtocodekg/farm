import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
  DroneScanner, CaptureResult, ViewName,
  buildWaypoints, Waypoint,
} from './DroneScanner';
import { GaussianSplatScene } from './GaussianSplatScene';
import { PathEditor } from './PathEditor';

const VIEW_NAMES: ViewName[] = ['nadir', 'north', 'south', 'east', 'west'];

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  captures, index, onClose, onPrev, onNext,
}: {
  captures: CaptureResult[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const c = captures[index];
  const [view, setView] = useState<ViewName>('nadir');
  useEffect(() => { setView('nadir'); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const src = c.views[view].imageDataUrl;

  const download = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `tile_r${c.gridRow}_c${c.gridCol}_${view}.png`;
    a.click();
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9500, backdropFilter:'blur(4px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background:'rgba(8,10,16,0.97)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, padding:20, display:'flex', flexDirection:'column', gap:12, maxWidth:'90vw', fontFamily:'monospace', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:10, letterSpacing:2, color:'#44ff88' }}>TILE {index+1} / {captures.length} · r{c.gridRow}c{c.gridCol}</span>
          <button onClick={onClose} style={ghostBtn}>✕ CLOSE</button>
        </div>

        {/* View tabs */}
        <div style={{ display:'flex', gap:4 }}>
          {VIEW_NAMES.map(v => (
            <button key={v} onClick={() => setView(v)} style={{ ...ghostBtn, background:view===v?'rgba(68,204,255,0.18)':'transparent', borderColor:view===v?'#44ccff':'rgba(255,255,255,0.15)', color:view===v?'#44ccff':'#778899', textTransform:'uppercase', fontSize:9, letterSpacing:1 }}>
              {v}
            </button>
          ))}
        </div>

        <img src={src} alt={view} style={{ width:512, height:512, maxWidth:'80vw', maxHeight:'60vh', objectFit:'contain', borderRadius:6, display:'block', imageRendering:'pixelated' }} />

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:'6px 16px', fontSize:10, color:'#8899aa' }}>
          <div><div style={{ color:'#aabbcc' }}>ROW</div>{c.gridRow}</div>
          <div><div style={{ color:'#aabbcc' }}>COL</div>{c.gridCol}</div>
          <div><div style={{ color:'#aabbcc' }}>WORLD X</div>{c.worldX.toFixed(2)}</div>
          <div><div style={{ color:'#aabbcc' }}>WORLD Z</div>{c.worldZ.toFixed(2)}</div>
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onPrev} disabled={index===0} style={ghostBtn}>← PREV</button>
            <button onClick={onNext} disabled={index===captures.length-1} style={ghostBtn}>NEXT →</button>
          </div>
          <button onClick={download} style={{ ...ghostBtn, color:'#44ccff', borderColor:'#44ccff44' }}>↓ DOWNLOAD</button>
        </div>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = { background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:5, color:'#aabbcc', cursor:'pointer', fontFamily:'monospace', fontSize:10, fontWeight:700, letterSpacing:1, padding:'4px 12px' };

// ── Results panel ─────────────────────────────────────────────────────────────

function ResultsPanel({ captures }: { captures: CaptureResult[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (captures.length === 0) return null;

  const downloadAll = () => captures.forEach(c => {
    const a = document.createElement('a');
    a.href = c.views.nadir.imageDataUrl;
    a.download = `tile_r${c.gridRow}_c${c.gridCol}_nadir.png`;
    a.click();
  });

  return (
    <>
      <div style={{ position:'fixed', bottom:16, right:16, zIndex:9200, width:340, maxHeight:'44vh', display:'flex', flexDirection:'column', background:'rgba(6,8,14,0.92)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:10, padding:12, color:'#fff', fontFamily:'monospace', fontSize:11, pointerEvents:'all' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <span style={{ color:'#44ff88', letterSpacing:2, fontSize:9 }}>CAPTURED TILES ({captures.length}) · 5 views</span>
          <button onClick={downloadAll} style={{ ...ghostBtn, fontSize:9 }}>↓ NADIR ALL</button>
        </div>
        <div style={{ overflowY:'auto', display:'flex', flexWrap:'wrap', gap:5 }}>
          {captures.map((c, i) => (
            <div key={i} onClick={() => setSelected(i)} title={`r${c.gridRow}c${c.gridCol}`} style={{ cursor:'pointer', textAlign:'center' }}>
              <img src={c.views.nadir.imageDataUrl} alt={`r${c.gridRow}c${c.gridCol}`}
                style={{ width:60, height:60, display:'block', borderRadius:4, border:'1px solid rgba(255,255,255,0.12)', transition:'border-color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor='#44ccff')}
                onMouseLeave={e => (e.currentTarget.style.borderColor='rgba(255,255,255,0.12)')}
              />
              <span style={{ color:'#556677', fontSize:8 }}>{c.gridRow},{c.gridCol}</span>
            </div>
          ))}
        </div>
      </div>
      {selected !== null && (
        <Lightbox captures={captures} index={selected}
          onClose={() => setSelected(null)}
          onPrev={() => setSelected(i => Math.max(0, (i??0)-1))}
          onNext={() => setSelected(i => Math.min(captures.length-1, (i??0)+1))}
        />
      )}
    </>
  );
}

// ── Scan-zone X-axis dragger ──────────────────────────────────────────────────

function ScanZoneDragger({ waypoints, captureWidth, onXDelta, onDragStart, onDragEnd }: {
  waypoints: Waypoint[]; captureWidth: number;
  onXDelta: (dx: number) => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const { camera, gl } = useThree();
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const dragPlane    = useRef(new THREE.Plane(new THREE.Vector3(0,1,0), 0));
  const intersectPt  = useRef(new THREE.Vector3());
  const raycaster    = useRef(new THREE.Raycaster());
  const onXDeltaRef  = useRef(onXDelta);
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => { onXDeltaRef.current = onXDelta; });
  useEffect(() => { onDragEndRef.current = onDragEnd; });

  const getWorldX = useCallback((clientX: number, clientY: number): number => {
    const rect = gl.domElement.getBoundingClientRect();
    raycaster.current.setFromCamera(new THREE.Vector2(((clientX-rect.left)/rect.width)*2-1, -((clientY-rect.top)/rect.height)*2+1), camera);
    return raycaster.current.ray.intersectPlane(dragPlane.current, intersectPt.current) ? intersectPt.current.x : NaN;
  }, [camera, gl]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const x = getWorldX(e.clientX, e.clientY);
      if (Number.isFinite(x)) { onXDeltaRef.current(x - lastX.current); lastX.current = x; }
    };
    const onUp = () => {
      if (isDragging.current) { isDragging.current = false; gl.domElement.style.cursor = ''; onDragEndRef.current(); }
    };
    gl.domElement.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { gl.domElement.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [gl, getWorldX]);

  const bounds = useMemo(() => {
    if (!waypoints.length) return null;
    const minX = Math.min(...waypoints.map(w=>w.x)) - captureWidth/2;
    const maxX = Math.max(...waypoints.map(w=>w.x)) + captureWidth/2;
    const minZ = Math.min(...waypoints.map(w=>w.z)) - captureWidth/2;
    const maxZ = Math.max(...waypoints.map(w=>w.z)) + captureWidth/2;
    return { minX, maxX, minZ, maxZ, cx:(minX+maxX)/2, cz:(minZ+maxZ)/2, w:maxX-minX, d:maxZ-minZ };
  }, [waypoints, captureWidth]);

  if (!bounds) return null;
  const { minX, maxX, minZ, maxZ, cx, cz, w, d } = bounds;

  return (
    <group>
      <mesh position={[cx,0.02,cz]} rotation={[-Math.PI/2,0,0]}
        onPointerDown={e => { e.stopPropagation(); isDragging.current=true; lastX.current=e.point.x; gl.domElement.style.cursor='ew-resize'; onDragStart(); }}
        onPointerEnter={() => { gl.domElement.style.cursor='ew-resize'; }}
        onPointerLeave={() => { if (!isDragging.current) gl.domElement.style.cursor=''; }}
      >
        <planeGeometry args={[w,d]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Line points={[new THREE.Vector3(minX,0.06,minZ),new THREE.Vector3(maxX,0.06,minZ),new THREE.Vector3(maxX,0.06,maxZ),new THREE.Vector3(minX,0.06,maxZ),new THREE.Vector3(minX,0.06,minZ)]} color="#2255cc" lineWidth={1.2} dashed dashSize={0.25} gapSize={0.15} />
      <mesh position={[cx,0.12,cz]}><boxGeometry args={[Math.min(w*0.3,1.5),0.06,0.06]} /><meshBasicMaterial color="#3366ff" /></mesh>
    </group>
  );
}

// ── Top-down camera ───────────────────────────────────────────────────────────

function TopDownCamera({ active, x, y, h }: { active: boolean; x: number; y: number; h: number }) {
  const { camera } = useThree();

  useFrame(() => {
    if (!active) return;
    camera.position.set(x, h, y);
    camera.up.set(0, 0, -1);
    camera.lookAt(x, 0, y);
  });

  useEffect(() => {
    if (!active) {
      camera.up.set(0, 1, 0);
    }
  }, [active, camera]);

  return null;
}

// ── Demo root ─────────────────────────────────────────────────────────────────

const CAPTURE_WIDTH    = 0.5;
const START_X = -1.8;
const END_X   = -0.2;
const START_Z = -5.0;
const END_Z   =  4.6;
const OVERLAP = 0.2;
const DEFAULT_COL_STEP = 0.4;

export default function DroneScannerDemo() {
  const [captures,    setCaptures]    = useState<CaptureResult[]>([]);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);

  const [altitude,      setAltitude]      = useState(2.4);
  const [obliqueAngle,  setObliqueAngle]  = useState(50);
  const [obliqueHeight, setObliqueHeight] = useState(0.2);
  const [colStep,       setColStep]       = useState(0.4);
  const [xOffset,       setXOffset]       = useState(1.25);
  const [orbitEnabled,  setOrbitEnabled]  = useState(true);
  const [previewVersion, setPreviewVersion] = useState(0);

  const [topDownActive, setTopDownActive] = useState(false);
  const [topDownX,      setTopDownX]      = useState(0);
  const [topDownY,      setTopDownY]      = useState(0);
  const [topDownH,      setTopDownH]      = useState(10);

  const [baseWaypoints, setBaseWaypoints] = useState<Waypoint[]>(() =>
    buildWaypoints(START_X, END_X, START_Z, END_Z, CAPTURE_WIDTH, OVERLAP, 0.4),
  );

  const waypoints = useMemo(() => {
    const byRow = new Map<number, Waypoint[]>();
    for (const wp of baseWaypoints) {
      if (wp.row < 12 || wp.row > 17) continue;
      if (!byRow.has(wp.row)) byRow.set(wp.row, []);
      byRow.get(wp.row)!.push(wp);
    }
    const result: Waypoint[] = [];
    byRow.forEach(rowWps => {
      const sorted = [...rowWps].sort((a, b) => a.col - b.col);
      const n = sorted.length;
      if (n <= 2) {
        result.push(...sorted);
      } else {
        const lo = Math.floor((n - 2) / 2);
        const hi = Math.ceil((n - 2) / 2) + 1;
        result.push(sorted[lo], sorted[hi]);
      }
    });
    return result.map(wp => ({ ...wp, x: wp.x + xOffset, z: wp.z - 0.1 }));
  }, [baseWaypoints, xOffset]);

  const [selectedWpIdx, setSelectedWpIdx] = useState<number | null>(null);
  const [previewResult, setPreviewResult] = useState<CaptureResult | null>(null);

  // ── Oblique controls — bump previewVersion to re-fire the live preview ───
  const handleObliqueAngleChange = useCallback((v: number) => {
    setObliqueAngle(v);
    setPreviewVersion(n => n + 1);
  }, []);
  const handleObliqueHeightChange = useCallback((v: number) => {
    setObliqueHeight(v);
    setPreviewVersion(n => n + 1);
  }, []);

  // ── X drag ────────────────────────────────────────────────────────────────
  const handleXDelta    = useCallback((dx: number) => setXOffset(p => p + dx), []);
  const handleDragStart = useCallback(() => setOrbitEnabled(false), []);
  const handleDragEnd   = useCallback(() => setOrbitEnabled(true),  []);

  // ── Column spacing ────────────────────────────────────────────────────────
  const handleTightenColumns = useCallback(() => {
    setColStep(prev => {
      const next = Math.max(prev * 0.85, CAPTURE_WIDTH * 0.1);
      setBaseWaypoints(buildWaypoints(START_X, END_X, START_Z, END_Z, CAPTURE_WIDTH, OVERLAP, next));
      return next;
    });
  }, []);
  const handleResetColumns = useCallback(() => {
    setColStep(DEFAULT_COL_STEP);
    setBaseWaypoints(buildWaypoints(START_X, END_X, START_Z, END_Z, CAPTURE_WIDTH, OVERLAP));
  }, []);

  // ── Waypoint editing ──────────────────────────────────────────────────────
  const handleSelectWaypoint = useCallback((idx: number) => {
    setSelectedWpIdx(idx); setPreviewResult(null);
  }, []);
  const handleDeleteWaypoint = useCallback((idx: number) => {
    setBaseWaypoints(prev => prev.filter((_, i) => i !== idx));
    setSelectedWpIdx(sel => sel===idx ? null : sel!==null&&sel>idx ? sel-1 : sel);
    setPreviewResult(null);
  }, []);
  const handleDeleteRow = useCallback((row: number) => {
    setBaseWaypoints(prev => prev.filter(wp => wp.row !== row));
    setSelectedWpIdx(null); setPreviewResult(null);
  }, []);

  // ── Scan callbacks ────────────────────────────────────────────────────────
  const handleComplete = useCallback((all: CaptureResult[]) => {
    setCaptures(all); setLastCapture(null);
  }, []);
  const handleFrame = useCallback((c: CaptureResult) => setLastCapture(c), []);
  const handlePreviewCapture = useCallback((result: CaptureResult, idx: number) => {
    setPreviewResult(result); setSelectedWpIdx(idx);
  }, []);

  const overlay = (
    <>
      <PathEditor
        waypoints={waypoints}
        altitude={altitude}
        xOffset={xOffset}
        captureWidth={CAPTURE_WIDTH}
        obliqueAngle={obliqueAngle}
        obliqueHeight={obliqueHeight}
        previewResult={previewResult}
        selectedIndex={selectedWpIdx}
        onAltitudeChange={setAltitude}
        onXOffsetChange={setXOffset}
        onObliqueAngleChange={handleObliqueAngleChange}
        onObliqueHeightChange={handleObliqueHeightChange}
        onSelectWaypoint={handleSelectWaypoint}
        onDeleteWaypoint={handleDeleteWaypoint}
        onDeleteRow={handleDeleteRow}
      />

      {lastCapture && captures.length === 0 && (
        <div style={{ position:'fixed', bottom:16, right:16, zIndex:9100, background:'rgba(6,8,14,0.95)', border:'1px solid rgba(68,204,255,0.4)', borderRadius:10, padding:10, fontFamily:'monospace', color:'#44ccff', fontSize:10, pointerEvents:'none' }}>
          <div style={{ marginBottom:6, letterSpacing:1 }}>◌ LIVE — plot {lastCapture.gridRow},{lastCapture.gridCol}</div>
          <img src={lastCapture.views.nadir.imageDataUrl} alt="live" style={{ width:192, height:192, display:'block', borderRadius:5 }} />
        </div>
      )}

      <ResultsPanel captures={captures} />

      {/* Top-down view button + X/Y controls */}
      <div style={{ position:'fixed', top:16, right:16, zIndex:9999, background:'rgba(6,8,14,0.92)', border:`1px solid ${topDownActive ? 'rgba(68,255,136,0.4)' : 'rgba(255,255,255,0.10)'}`, borderRadius:10, padding:12, color:'#fff', fontFamily:'monospace', fontSize:11, pointerEvents:'auto', minWidth:210 }} onPointerDown={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: topDownActive ? 12 : 0 }}>
          <span style={{ color: topDownActive ? '#44ff88' : '#8899aa', letterSpacing:2, fontSize:9 }}>TOP DOWN VIEW</span>
          <button onClick={() => setTopDownActive(v => !v)} style={{ ...ghostBtn, color: topDownActive ? '#44ff88' : '#aabbcc', borderColor: topDownActive ? '#44ff88' : 'rgba(255,255,255,0.15)' }}>
            {topDownActive ? '● ON' : '○ OFF'}
          </button>
        </div>
        {topDownActive && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ color:'#aabbcc', minWidth:10 }}>X</span>
              <input type="range" min={-10} max={10} step={0.1} value={topDownX} onChange={e => setTopDownX(Number(e.target.value))} style={{ flex:1, accentColor:'#44ccff' }} />
              <span style={{ color:'#44ccff', minWidth:38, textAlign:'right' }}>{topDownX.toFixed(1)}</span>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ color:'#aabbcc', minWidth:10 }}>Y</span>
              <input type="range" min={-10} max={10} step={0.1} value={topDownY} onChange={e => setTopDownY(Number(e.target.value))} style={{ flex:1, accentColor:'#44ccff' }} />
              <span style={{ color:'#44ccff', minWidth:38, textAlign:'right' }}>{topDownY.toFixed(1)}</span>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ color:'#aabbcc', minWidth:10 }}>Z</span>
              <input type="range" min={1} max={30} step={0.1} value={topDownH} onChange={e => setTopDownH(Number(e.target.value))} style={{ flex:1, accentColor:'#ff8844' }} />
              <span style={{ color:'#ff8844', minWidth:38, textAlign:'right' }}>{topDownH.toFixed(1)}</span>
            </label>
          </div>
        )}
      </div>

      <div style={{ position:'fixed', bottom:16, left:'50%', transform:'translateX(-50%)', zIndex:9100, background:'rgba(6,8,14,0.92)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:8, padding:'7px 14px', display:'flex', alignItems:'center', gap:10, fontFamily:'"Courier New",Courier,monospace', fontSize:10, color:'#8899aa', pointerEvents:'all', userSelect:'none', backdropFilter:'blur(8px)' }}>
        <span style={{ letterSpacing:1 }}>COL GAP</span>
        <span style={{ color:'#44ccff', fontWeight:700, minWidth:38 }}>{colStep.toFixed(2)} m</span>
        <button onClick={handleTightenColumns} style={colCtrlBtn('#1a3a28')}>▼ TIGHTEN</button>
        <button onClick={handleResetColumns}   style={colCtrlBtn('#2a2a3a')}>↺ RESET</button>
      </div>
    </>
  );

  return (
    <div style={{ position:'fixed', inset:0 }}>
      <Canvas camera={{ position:[0,2,5], fov:60, near:0.1, far:1000 }} gl={{ preserveDrawingBuffer:true, antialias:true, powerPreference:'high-performance' }} dpr={[1,2]} style={{ background:'#0a0b0d' }}>
        <mesh position={[0,-0.15,0]} rotation={[-Math.PI/2,0,0]}>
          <planeGeometry args={[50,50]} /><meshBasicMaterial color="#9b7653" />
        </mesh>
        <GaussianSplatScene url="/scene.ply" onLoad={() => console.log('[GaussianSplatScene] loaded')} />
        <OrbitControls makeDefault target={[0,0,0]} enableDamping dampingFactor={0.08} enabled={orbitEnabled && !topDownActive} />
        <TopDownCamera active={topDownActive} x={topDownX} y={topDownY} h={topDownH} />

        {selectedWpIdx !== null && waypoints[selectedWpIdx] && (
          <mesh position={[waypoints[selectedWpIdx].x, 0.05, waypoints[selectedWpIdx].z]} rotation={[-Math.PI/2,0,0]}>
            <planeGeometry args={[CAPTURE_WIDTH,CAPTURE_WIDTH]} />
            <meshBasicMaterial color="#ff8800" transparent opacity={0.25} depthWrite={false} />
          </mesh>
        )}

        <ScanZoneDragger waypoints={waypoints} captureWidth={CAPTURE_WIDTH} onXDelta={handleXDelta} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />

        <DroneScanner
          waypoints={waypoints}
          altitude={altitude}
          obliqueAngle={obliqueAngle}
          obliqueHeight={obliqueHeight}
          previewVersion={previewVersion}
          captureWidth={CAPTURE_WIDTH}
          overlap={OVERLAP}
          speed={600}
          previewWaypointIndex={selectedWpIdx}
          onPreviewCapture={handlePreviewCapture}
          onScanComplete={handleComplete}
          onCaptureFrame={handleFrame}
        />
      </Canvas>
      {createPortal(overlay, document.body)}
    </div>
  );
}

function colCtrlBtn(bg: string): React.CSSProperties {
  return { background:bg, border:'1px solid rgba(255,255,255,0.12)', borderRadius:4, color:'#ccd', cursor:'pointer', fontFamily:'"Courier New",Courier,monospace', fontSize:9, fontWeight:700, letterSpacing:0.5, padding:'3px 9px' };
}
