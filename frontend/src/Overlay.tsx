import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import {
  Droplets, Thermometer, Wind, Sun,
  Beaker, CloudRain, ShieldAlert,
  Compass, Gauge, Scan, Sprout, FileText
} from 'lucide-react';
import nitrogenHeatmap from './assets/images/nitrogen-heatmapp.jpeg';

// ── types ─────────────────────────────────────────────────────────────────────

type SplatStatus = 'loading' | 'loaded' | 'error';
type CameraMode = 'perspective' | 'topdown';

type CalibMode =
  | 'idle'
  | 'left_cal'
  | 'right_cal'
  | 'left_line'
  | 'right_line';

type LinePhase = 'start' | 'end' | 'offset';

interface CameraSnapshot {
  position:   [number, number, number];
  quaternion: [number, number, number, number];
  fov:        number;
}

interface LineConfig {
  start:  [number, number, number] | null;
  end:    [number, number, number] | null;
  cropPt: [number, number, number] | null;
}

interface CalibData {
  leftWaypoints:  CameraSnapshot[];
  rightWaypoints: CameraSnapshot[];
  left:  LineConfig;
  right: LineConfig;
}

const EMPTY_LINE: LineConfig = { start: null, end: null, cropPt: null };

function getViewer() { return (window as any).gsplatViewer ?? null; }

// ── math helpers ──────────────────────────────────────────────────────────────

function dot3(a: number[], b: number[]) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function sub3(a: number[], b: number[]): [number,number,number] { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function add3(a: number[], b: number[]): [number,number,number] { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale3(v: number[], s: number): [number,number,number] { return [v[0]*s, v[1]*s, v[2]*s]; }
function len3(v: number[]) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }
function norm3(v: number[]): [number,number,number] { const l = len3(v); return l < 1e-10 ? [v[0],v[1],v[2]] as [number,number,number] : scale3(v, 1/l); }

function fitLine(snaps: CameraSnapshot[]): { origin: [number,number,number]; dir: [number,number,number] } {
  const pts = snaps.map(s => s.position as number[]);
  const n = pts.length;
  const cx = pts.reduce((a,p) => a+p[0], 0)/n;
  const cy = pts.reduce((a,p) => a+p[1], 0)/n;
  const cz = pts.reduce((a,p) => a+p[2], 0)/n;
  const center = [cx,cy,cz];
  const centered = pts.map(p => sub3(p, center));

  let dir = centered.reduce((best, v) => len3(v) > len3(best) ? v : best, centered[0]).slice() as number[];
  dir = norm3(dir);
  for (let i = 0; i < 64; i++) {
    const next = [0,0,0];
    for (const v of centered) { const d = dot3(v,dir); next[0]+=v[0]*d; next[1]+=v[1]*d; next[2]+=v[2]*d; }
    if (len3(next) < 1e-10) break;
    dir = norm3(next);
  }
  return { origin: [cx,cy,cz], dir: dir as [number,number,number] };
}

function projectT(p: number[], origin: number[], dir: number[]) { return dot3(sub3(p, origin), dir); }

function snapToLine(p: [number,number,number], origin: [number,number,number], dir: [number,number,number]): [number,number,number] {
  const t = projectT(p, origin, dir);
  return add3(origin, scale3(dir, t));
}

function perpXZ(dir: [number,number,number]): [number,number,number] {
  return norm3([-dir[2], 0, dir[0]]);
}

function snapToPerp(
  p: [number,number,number],
  lineOrigin: [number,number,number],
  lineDir: [number,number,number],
): [number,number,number] {
  const perp = perpXZ(lineDir);
  const rel  = sub3(p, lineOrigin);
  const t    = dot3(rel, perp);
  return [lineOrigin[0] + perp[0]*t, lineOrigin[1], lineOrigin[2] + perp[2]*t];
}

// ── screen helpers ────────────────────────────────────────────────────────────

function worldToScreen(
  p: [number,number,number],
  cam: THREE.PerspectiveCamera,
  w: number, h: number,
): [number,number] | null {
  const v = new THREE.Vector3(...p).project(cam);
  if (v.z > 1) return null;
  return [(v.x+1)/2*w, (1-v.y)/2*h];
}

const BOOTSTRAP_UP = new THREE.Vector3(0,-1,0);

function screenToWorld(clientX: number, clientY: number, rect: DOMRect): [number,number,number] | null {
  const viewer = getViewer();
  if (!viewer) return null;
  const cam = viewer.camera as THREE.PerspectiveCamera;
  const ndcX = ((clientX-rect.left)/rect.width)*2-1;
  const ndcY = -((clientY-rect.top)/rect.height)*2+1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const plane = new THREE.Plane(BOOTSTRAP_UP.clone(), 0);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  return [hit.x, hit.y, hit.z];
}

const IS_CAPTURE = new URLSearchParams(window.location.search).has('capture');

function lineConfigFromSaved(saved: any): LineConfig {
  if (!saved?.flightLine?.start || !saved?.flightLine?.end || !saved?.cropPt) return { ...EMPTY_LINE };
  return {
    start:  saved.flightLine.start  as [number,number,number],
    end:    saved.flightLine.end    as [number,number,number],
    cropPt: saved.cropPt            as [number,number,number],
  };
}

function snapshotsFromSaved(arr: any[]): CameraSnapshot[] {
  if (!Array.isArray(arr) || arr.length !== 3) return [];
  return arr as CameraSnapshot[];
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Overlay() {
  // Page view toggle
  const [view, setView] = useState<'dashboard' | '3d'>('dashboard');

  // Show/hide the splat canvas based on view
  useEffect(() => {
    const splat = document.getElementById('splat-root');
    if (splat) splat.style.display = view === '3d' ? 'block' : 'none';
  }, [view]);

  // Splat / viewer status
  const [status, setStatus]         = useState<SplatStatus>('loading');
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective');

  // Dashboard UI state
  const [showActionModal, setShowActionModal]       = useState(false);
  const [selectedTreatment, setSelectedTreatment]   = useState<string | null>(null);
  const [showWeedModal, setShowWeedModal]           = useState(false);
  const [selectedWeed, setSelectedWeed]             = useState<string | null>(null);
  const [actionWeed, setActionWeed]                 = useState<string | null>(null);

  // Weed problem points plotted on the heatmap (matches Weed Identification data)
  const weedPoints = [
    { id: 'pigweed',   name: 'Pigweed',   sector: '4A', priority: 'High',   color: 'rgb(244, 63, 94)',  left: '15%', top: '15%' },
    { id: 'crabgrass', name: 'Crabgrass', sector: '2B', priority: 'Medium', color: 'rgb(251, 191, 36)', left: '20%', top: '60%' },
  ];

  // Calibration state
  const [mode, setMode]             = useState<CalibMode>('idle');
  const [linePhase, setLinePhase]   = useState<LinePhase>('start');
  const [calib, setCalib]           = useState<CalibData>({
    leftWaypoints: [], rightWaypoints: [],
    left: { ...EMPTY_LINE }, right: { ...EMPTY_LINE },
  });
  const [mouseWorld, setMouseWorld] = useState<[number,number,number] | null>(null);
  const [svgSize, setSvgSize]       = useState({ w: window.innerWidth, h: window.innerHeight });
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');

  const calibRef = useRef(calib);
  useEffect(() => { calibRef.current = calib; }, [calib]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Load existing flight-path.json on mount
  useEffect(() => {
    fetch('/flight-path.json')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((saved: any) => {
        if (!saved) return;
        setCalib(c => ({
          ...c,
          leftWaypoints:  snapshotsFromSaved(saved.leftWaypoints),
          rightWaypoints: snapshotsFromSaved(saved.rightWaypoints),
          left:  lineConfigFromSaved(saved.left),
          right: lineConfigFromSaved(saved.right),
        }));
      });
  }, []);

  useEffect(() => {
    const onResize = () => setSvgSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onLoaded = () => setStatus('loaded');
    const onError  = () => setStatus('error');
    window.addEventListener('splat:loaded', onLoaded);
    window.addEventListener('splat:error',  onError);
    return () => {
      window.removeEventListener('splat:loaded', onLoaded);
      window.removeEventListener('splat:error',  onError);
    };
  }, []);

  // Derived lines
  const leftLine  = calib.leftWaypoints.length  === 3 ? fitLine(calib.leftWaypoints)  : null;
  const rightLine = calib.rightWaypoints.length === 3 ? fitLine(calib.rightWaypoints) : null;

  // ── viewer camera controls ────────────────────────────────────────────────

  const toggleCamera = () => {
    const viewer = getViewer();
    if (!viewer?.controls) return;
    const next: CameraMode = cameraMode === 'perspective' ? 'topdown' : 'perspective';
    if (next === 'topdown') {
      viewer.controls.target.set(0, 0, 0);
      viewer.camera.position.set(0, -10, 0);
      viewer.camera.up.set(0, 0, 1);
    } else {
      viewer.camera.position.set(0, -1, 5);
      viewer.camera.up.set(0, -1, 0);
      viewer.controls.target.set(0, 0, 0);
    }
    viewer.controls.update();
    setCameraMode(next);
  };

  // ── calibration camera controls ───────────────────────────────────────────

  function enterTopDown() {
    const viewer = getViewer();
    if (!viewer) return;
    if (viewer.controls) viewer.controls.enabled = false;
    viewer.camera.position.set(0, -15, 0);
    viewer.camera.up.set(0, 0, -1);
    viewer.camera.lookAt(0, 0, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld();
  }

  function exitTopDown() {
    const viewer = getViewer();
    if (viewer?.controls) viewer.controls.enabled = true;
  }

  function snapCamera(): CameraSnapshot {
    const viewer = getViewer();
    const cam = viewer.camera as THREE.PerspectiveCamera;
    return {
      position:   [cam.position.x, cam.position.y, cam.position.z],
      quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      fov:        cam.fov,
    };
  }

  // ── row calibration ───────────────────────────────────────────────────────

  function startRowCal(row: 'left' | 'right') {
    exitTopDown();
    setCalib(c => ({
      ...c,
      ...(row === 'left' ? { leftWaypoints: [] } : { rightWaypoints: [] }),
    }));
    setMode(row === 'left' ? 'left_cal' : 'right_cal');
  }

  function captureWaypoint() {
    const snap = snapCamera();
    setCalib(c => {
      if (modeRef.current === 'left_cal') {
        const next = [...c.leftWaypoints, snap] as CameraSnapshot[];
        if (next.length === 3) setMode('idle');
        return { ...c, leftWaypoints: next };
      } else {
        const next = [...c.rightWaypoints, snap] as CameraSnapshot[];
        if (next.length === 3) setMode('idle');
        return { ...c, rightWaypoints: next };
      }
    });
  }

  // ── line + offset setup ───────────────────────────────────────────────────

  function startLinePick(side: 'left' | 'right') {
    setCalib(c => ({
      ...c,
      ...(side === 'left' ? { left: { ...EMPTY_LINE } } : { right: { ...EMPTY_LINE } }),
    }));
    setLinePhase('start');
    setMouseWorld(null);
    enterTopDown();
    setMode(side === 'left' ? 'left_line' : 'right_line');
  }

  function handleTopDownClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw  = screenToWorld(e.clientX, e.clientY, rect);
    if (!raw) return;

    const side = modeRef.current === 'left_line' ? 'left' : 'right';
    const line = side === 'left' ? leftLine : rightLine;
    if (!line) return;

    if (linePhase === 'start') {
      const snapped = snapToLine(raw, line.origin, line.dir);
      setCalib(c => ({ ...c, [side]: { ...c[side], start: snapped } }));
      setLinePhase('end');

    } else if (linePhase === 'end') {
      const snapped = snapToLine(raw, line.origin, line.dir);
      setCalib(c => ({ ...c, [side]: { ...c[side], end: snapped } }));
      setLinePhase('offset');

    } else {
      const c = calibRef.current;
      const lineConfig = c[side];
      if (!lineConfig.start || !lineConfig.end) return;
      const mid: [number,number,number] = [
        (lineConfig.start[0] + lineConfig.end[0]) / 2,
        (lineConfig.start[1] + lineConfig.end[1]) / 2,
        (lineConfig.start[2] + lineConfig.end[2]) / 2,
      ];
      const snapped = snapToPerp(raw, mid, line.dir);
      setCalib(cv => ({ ...cv, [side]: { ...cv[side], cropPt: snapped } }));
      exitTopDown();
      setMode('idle');
    }
  }

  function handleTopDownMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouseWorld(screenToWorld(e.clientX, e.clientY, rect));
  }

  // ── SVG overlay ───────────────────────────────────────────────────────────

  const svgOverlay = (() => {
    const viewer = getViewer();
    if (!viewer) return null;
    const cam  = viewer.camera as THREE.PerspectiveCamera;
    const { w, h } = svgSize;
    const els: React.ReactNode[] = [];
    const isTopDown = mode === 'left_line' || mode === 'right_line';
    if (!isTopDown) return null;

    const activeSide = mode === 'left_line' ? 'left' : 'right';
    const line = activeSide === 'left' ? leftLine : rightLine;
    const lineConfig = calib[activeSide];

    const dot = (key: string, p: [number,number,number], fill: string, r = 7) => {
      const s = worldToScreen(p, cam, w, h);
      if (!s) return null;
      return <circle key={key} cx={s[0]} cy={s[1]} r={r} fill={fill} stroke="white" strokeWidth={1.5} />;
    };

    if (line) {
      const FAR = 30;
      const lineColor = activeSide === 'left' ? '#34d399' : '#f472b6';
      const p1 = worldToScreen(add3(line.origin, scale3(line.dir,  FAR)), cam, w, h);
      const p2 = worldToScreen(add3(line.origin, scale3(line.dir, -FAR)), cam, w, h);
      if (p1 && p2) els.push(
        <line key="fitted" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
          stroke={lineColor} strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />
      );

      const snaps = activeSide === 'left' ? calib.leftWaypoints : calib.rightWaypoints;
      snaps.forEach((s, i) => {
        const snappedPos = snapToLine(s.position as [number,number,number], line.origin, line.dir);
        els.push(dot(`wp-${i}`, snappedPos, lineColor, 5));
      });

      if (lineConfig.start) {
        els.push(dot('ls', lineConfig.start, '#ffffff'));
        if (linePhase === 'end' && mouseWorld) {
          const ms = worldToScreen(snapToLine(mouseWorld, line.origin, line.dir), cam, w, h);
          const ss = worldToScreen(lineConfig.start, cam, w, h);
          if (ms && ss) els.push(
            <line key="live-end" x1={ss[0]} y1={ss[1]} x2={ms[0]} y2={ms[1]}
              stroke="#ffffff" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6} />
          );
        }
      }
      if (lineConfig.end) {
        els.push(dot('le', lineConfig.end, '#ffffff'));
        const ss = worldToScreen(lineConfig.start!, cam, w, h);
        const se = worldToScreen(lineConfig.end,   cam, w, h);
        if (ss && se) els.push(
          <line key="seg" x1={ss[0]} y1={ss[1]} x2={se[0]} y2={se[1]}
            stroke="#ffffff" strokeWidth={2.5} opacity={0.9} />
        );
      }

      if (linePhase === 'offset' && lineConfig.start && lineConfig.end) {
        const mid: [number,number,number] = [
          (lineConfig.start[0] + lineConfig.end[0]) / 2,
          (lineConfig.start[1] + lineConfig.end[1]) / 2,
          (lineConfig.start[2] + lineConfig.end[2]) / 2,
        ];
        const perp = perpXZ(line.dir);
        const FAR2 = 20;
        const pp1 = worldToScreen(add3(mid, scale3(perp,  FAR2)), cam, w, h);
        const pp2 = worldToScreen(add3(mid, scale3(perp, -FAR2)), cam, w, h);
        if (pp1 && pp2) els.push(
          <line key="perp" x1={pp1[0]} y1={pp1[1]} x2={pp2[0]} y2={pp2[1]}
            stroke="#00e5ff" strokeWidth={1.5} strokeDasharray="8 4" opacity={0.8} />
        );
        if (mouseWorld) {
          const snappedMouse = snapToPerp(mouseWorld, mid, line.dir);
          els.push(dot('perp-live', snappedMouse, '#00e5ff', 5));
        }
      }

      if (lineConfig.cropPt) els.push(dot('crop', lineConfig.cropPt, '#00e5ff'));
    }

    return els;
  })();

  // ── save ─────────────────────────────────────────────────────────────────

  const leftComplete  = calib.leftWaypoints.length  === 3 && !!(calib.left.start  && calib.left.end  && calib.left.cropPt);
  const rightComplete = calib.rightWaypoints.length === 3 && !!(calib.right.start && calib.right.end && calib.right.cropPt);
  const canSave = leftComplete || rightComplete;

  async function save() {
    if (!canSave) return;
    setSaveStatus('saving');
    try {
      const c = calibRef.current;

      function cropPlane(cropPt: [number,number,number], dir: [number,number,number]) {
        const n = norm3([dir[0], 0, dir[2]]) as [number,number,number];
        return { normal: n, d: dot3(n, cropPt) };
      }
      function frameWidth(snaps: CameraSnapshot[], cropPt: [number,number,number]) {
        const nom = snaps[1];
        const dist = len3(sub3(nom.position, cropPt));
        const fovRad = (nom.fov * Math.PI) / 180;
        return 2 * dist * Math.tan(fovRad / 2) * (window.innerWidth / window.innerHeight);
      }
      function buildSide(waypoints: CameraSnapshot[], line: LineConfig, lineDir: [number,number,number]) {
        return {
          flightLine: { start: line.start, end: line.end },
          cropPt:     line.cropPt,
          cropPlane:  cropPlane(line.cropPt!, lineDir),
          flightDir:  lineDir,
          frameWidth: frameWidth(waypoints, line.cropPt!),
        };
      }

      const existing = await fetch('/flight-path.json')
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({}));

      const lLine = leftComplete  ? fitLine(c.leftWaypoints)  : null;
      const rLine = rightComplete ? fitLine(c.rightWaypoints) : null;

      const body = {
        leftWaypoints:  leftComplete  ? c.leftWaypoints  : (existing.leftWaypoints  ?? []),
        rightWaypoints: rightComplete ? c.rightWaypoints : (existing.rightWaypoints ?? []),
        left:  leftComplete  ? buildSide(c.leftWaypoints,  c.left,  lLine!.dir) : (existing.left  ?? null),
        right: rightComplete ? buildSide(c.rightWaypoints, c.right, rLine!.dir) : (existing.right ?? null),
        viewport: {
          width:  window.innerWidth,
          height: window.innerHeight,
          aspect: window.innerWidth / window.innerHeight,
        },
      };

      const res = await fetch('/api/save-flight-path', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const isTopDown = mode === 'left_line' || mode === 'right_line';
  const activeSide  = mode === 'left_line' ? 'left' : mode === 'right_line' ? 'right' : null;
  const phaseLabel: Record<LinePhase, string> = {
    start:  'Click to set scan START',
    end:    'Click to set scan END',
    offset: 'Click the crop row (cyan line)',
  };

  const statusLabel = {
    loading: 'Loading 3D Farm Data…',
    loaded: 'Farm Visualization Active',
    error: 'Sensors Offline',
  }[status];
  const statusColor = {
    loading: 'text-amber-400',
    loaded: 'text-emerald-400',
    error: 'text-rose-400',
  }[status];
  const statusIcon = {
    loading: '⟳',
    loaded: '●',
    error: '⚠',
  }[status];

  return (
    <>
      {/* Calibration: SVG overlay (3D view only) */}
      {view === '3d' && isTopDown && (
        <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}
          width={svgSize.w} height={svgSize.h}>
          {svgOverlay}
        </svg>
      )}

      {/* Calibration: click blocker for top-down picking (3D view only) */}
      {view === '3d' && isTopDown && (
        <div
          onClick={handleTopDownClick}
          onMouseMove={handleTopDownMouseMove}
          style={{ position: 'fixed', inset: 0, cursor: 'crosshair', pointerEvents: 'auto', zIndex: 9 }}
        />
      )}

      {/* Dashboard-only: black background + heatmap layers */}
      {view === 'dashboard' && (
        <>
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0, background: '#000' }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            zIndex: 0,
            backgroundImage: `url(${nitrogenHeatmap})`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'contrast(1.25) brightness(0.8)',
          }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            zIndex: 0,
            background: `
              radial-gradient(circle at 42% 38%, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.25) 8%, rgba(251,146,60,0.15) 16%, transparent 26%),
              radial-gradient(circle at 63% 64%, rgba(251,191,36,0.5) 0%, rgba(251,191,36,0.22) 8%, rgba(234,179,8,0.12) 16%, transparent 26%)
            `,
            mixBlendMode: 'screen',
          }} />
        </>
      )}

      {/* Main HUD + Dashboard */}
      <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">

        {/* Top HUD */}
        <div className="flex justify-between items-start pointer-events-auto gap-6">
          {/* Left: status pill + view toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/15 shadow-xl shadow-black/30 hover:border-white/25 transition-all duration-200 cursor-default">
              <div className={`w-2.5 h-2.5 rounded-full flex items-center justify-center text-xs font-bold ${status === 'loaded' ? 'bg-emerald-400 text-black' : status === 'loading' ? 'bg-amber-400 text-black animate-pulse' : 'bg-rose-400 text-white animate-pulse'}`}>{statusIcon}</div>
              <span className={`text-xs font-semibold tracking-wider ${statusColor}`}>{statusLabel}</span>
              {view === '3d' && status === 'loaded' && (
                <>
                  <div className="w-px h-5 bg-white/20 mx-2" />
                  <span className="text-white/65 text-xs font-mono uppercase tracking-widest font-medium">
                    {isTopDown ? 'CALIBRATION' : cameraMode}
                  </span>
                </>
              )}
            </div>

            {/* Dashboard / 3D toggle */}
            <div className="flex items-center rounded-xl overflow-hidden border border-white/15 shadow-lg bg-black/50 backdrop-blur-xl">
              <button
                onClick={() => setView('dashboard')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-all duration-200 cursor-pointer focus:outline-none ${view === 'dashboard' ? 'bg-emerald-500/30 text-emerald-300 border-r border-emerald-500/30' : 'text-white/50 hover:text-white/80 hover:bg-white/10 border-r border-white/10'}`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setView('3d')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-all duration-200 cursor-pointer focus:outline-none ${view === '3d' ? 'bg-cyan-500/30 text-cyan-300' : 'text-white/50 hover:text-white/80 hover:bg-white/10'}`}
              >
                3D View
              </button>
            </div>
          </div>

          {view === '3d' && !isTopDown && (
            <div className="flex items-center gap-3">
              <Link
                to="/report"
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/25 border border-emerald-400/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/35 hover:border-emerald-300/60 hover:shadow-lg hover:shadow-emerald-500/20 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none"
              >
                <FileText className="w-4 h-4" />
                Generate Report
              </Link>
              <button
                onClick={toggleCamera}
                className="px-5 py-3 rounded-xl bg-black/50 backdrop-blur-xl border border-white/15 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/15 hover:border-white/35 hover:shadow-lg hover:shadow-white/10 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-white/40 focus:outline-none"
              >
                {cameraMode === 'perspective' ? 'Top-Down View' : 'Perspective View'}
              </button>
            </div>
          )}

          {view === 'dashboard' && (
            <Link
              to="/report"
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/25 border border-emerald-400/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/35 hover:border-emerald-300/60 hover:shadow-lg hover:shadow-emerald-500/20 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            >
              <FileText className="w-4 h-4" />
              Generate Report
            </Link>
          )}
        </div>

        {/* Main Dashboard Layout — only on dashboard view, hidden during calibration top-down */}
        {view === 'dashboard' && !isTopDown && (
          <div className="flex-1 flex justify-between items-start mt-6 w-full pointer-events-none px-6">

            {/* Left Panel: Soil Health & Weed ID */}
            <div className="w-[420px] flex flex-col gap-6 pointer-events-auto">

              <DashboardCard title="Soil Health Analytics" icon={<Beaker className="w-5 h-5 text-emerald-400" />}>
                <MetricRow label="pH Level" value="6.5" unit="Optimal" icon={<Gauge className="w-4 h-4 text-emerald-400/70" />} progress={65} color="bg-emerald-500" />

                <div className="pt-4 border-t border-white/8">
                  <span className="text-xs text-white/60 uppercase tracking-wider font-bold mb-3 block">NPK Composition</span>
                  <div className="flex gap-3">
                    <NPKBar label="N" value={72} color="bg-blue-400" />
                    <NPKBar label="P" value={45} color="bg-purple-400" />
                    <NPKBar label="K" value={60} color="bg-orange-400" />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/8 space-y-3">
                  <MetricRow label="Soil Moisture" value="42" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400/70" />} progress={42} color="bg-blue-400" />
                  <MetricRow label="Soil Temp" value="18.5" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400/70" />} progress={60} color="bg-orange-400" />
                </div>
              </DashboardCard>

              <DashboardCard title="Weed Identification" icon={<Scan className="w-5 h-5 text-rose-400" />}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-rose-500/15 border border-rose-400/35 shadow-sm hover:bg-rose-500/20 hover:border-rose-400/50 hover:scale-102 transition-all duration-200 group cursor-pointer" onClick={() => { setSelectedWeed('pigweed'); setShowWeedModal(true); }}>
                    <div className="flex items-center gap-3 flex-1">
                      <div className="p-2 bg-rose-500/25 rounded-lg group-hover:bg-rose-500/35 transition-colors">
                        <ShieldAlert className="w-5 h-5 text-rose-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white/95">Pigweed</h4>
                        <p className="text-xs text-rose-300/80 font-medium">Sector 4A • High Priority</p>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setActionWeed('pigweed'); setShowActionModal(true); setSelectedTreatment(null); }} className="px-3 py-2 rounded-lg bg-rose-500/30 text-rose-300 text-xs font-bold hover:bg-rose-500/45 hover:shadow-md hover:shadow-rose-500/20 hover:scale-105 transition-all duration-200 uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-rose-400 focus:outline-none">
                      Action
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-amber-500/15 border border-amber-400/35 shadow-sm hover:bg-amber-500/20 hover:border-amber-400/50 hover:scale-102 transition-all duration-200 group cursor-pointer" onClick={() => { setSelectedWeed('crabgrass'); setShowWeedModal(true); }}>
                    <div className="flex items-center gap-3 flex-1">
                      <div className="p-2 bg-amber-500/25 rounded-lg group-hover:bg-amber-500/35 transition-colors">
                        <ShieldAlert className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white/95">Crabgrass</h4>
                        <p className="text-xs text-amber-300/80 font-medium">Sector 2B • Medium Priority</p>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setActionWeed('crabgrass'); setShowActionModal(true); setSelectedTreatment(null); }} className="px-3 py-2 rounded-lg bg-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/45 hover:shadow-md hover:shadow-amber-500/20 hover:scale-105 transition-all duration-200 uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-amber-400 focus:outline-none">
                      Action
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs pt-3 border-t border-white/8">
                  <span className="text-white/70 font-medium">Total Threats</span>
                  <span className="text-white/90 font-bold tabular-nums">2 Active</span>
                </div>
              </DashboardCard>

            </div>

            {/* Center: Heatmap Problem Markers */}
            <div className="flex-1 relative h-full pointer-events-none">
              {weedPoints.map((point) => (
                <button
                  key={point.id}
                  onClick={() => { setSelectedWeed(point.id); setShowWeedModal(true); }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto group focus:outline-none"
                  style={{ left: point.left, top: point.top }}
                  title={`${point.name} • Sector ${point.sector}`}
                >
                  <span
                    className="absolute inset-0 m-auto w-10 h-10 rounded-full animate-ping opacity-60"
                    style={{ backgroundColor: point.color }}
                  />
                  <span
                    className="relative block w-5 h-5 rounded-full border-2 border-white shadow-lg transition-transform duration-200 group-hover:scale-125"
                    style={{
                      backgroundColor: point.color,
                      boxShadow: `0 0 12px ${point.color}, 0 0 24px ${point.color}`,
                    }}
                  />
                  <span className="absolute left-1/2 -translate-x-1/2 top-7 whitespace-nowrap px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/20 text-xs font-bold text-white/95 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {point.name}
                    <span className="ml-1.5 text-white/60 font-medium">Sector {point.sector}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Right Panel: Environmental Sensors */}
            <div className="w-[420px] flex flex-col gap-6 pointer-events-auto">

              <DashboardCard title="Ambient Conditions" icon={<Sun className="w-5 h-5 text-amber-400" />}>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <SensorBlock label="Temperature" value="24.2" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400" />} />
                  <SensorBlock label="Humidity" value="55" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400" />} />
                  <SensorBlock label="UV Index" value="7.2" unit="High" icon={<Sun className="w-4 h-4 text-amber-400" />} />
                  <SensorBlock label="Solar Rad." value="850" unit="W/m²" icon={<Sprout className="w-4 h-4 text-yellow-400" />} />
                </div>
                <WeatherForecast type="temperature" />
              </DashboardCard>

              <DashboardCard title="Meteorological" icon={<Wind className="w-5 h-5 text-cyan-400" />}>
                <div className="flex items-center justify-between p-4 rounded-xl bg-black/40 border border-white/15 hover:border-white/25 hover:scale-102 transition-all duration-200 shadow-sm cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/20 rounded-lg">
                      <Compass className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <h4 className="text-xs text-white/70 uppercase tracking-wider font-bold">Wind</h4>
                      <p className="text-base font-bold text-white/95">12 km/h <span className="text-cyan-400 text-xs ml-2 font-semibold">NW</span></p>
                    </div>
                  </div>
                  <div className="text-right">
                    <h4 className="text-xs text-white/70 uppercase tracking-wider font-bold">Drone Flight</h4>
                    <p className="text-xs font-bold text-emerald-400 uppercase">●</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-4 mb-6">
                  <SensorBlock label="Barometric" value="1012" unit="hPa" icon={<Gauge className="w-4 h-4 text-indigo-400" />} />
                  <SensorBlock label="Precipitation" value="0.0" unit="mm" icon={<CloudRain className="w-4 h-4 text-blue-300" />} />
                </div>
                <WeatherForecast type="precipitation" />
              </DashboardCard>

            </div>
          </div>
        )}

        <div className="h-12" />

        {/* Dashboard modals */}
        {showActionModal && (
          <WeedActionModal
            weedType={actionWeed}
            onClose={() => { setShowActionModal(false); setSelectedTreatment(null); setActionWeed(null); }}
            onSelectTreatment={setSelectedTreatment}
            selectedTreatment={selectedTreatment}
          />
        )}
        {showWeedModal && (
          <WeedInfoModal
            weedType={selectedWeed}
            onClose={() => { setShowWeedModal(false); setSelectedWeed(null); }}
          />
        )}
      </div>

      {/* Calibration: top-down instruction banner */}
      {isTopDown && (
        <div data-ui="true"
          className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none" style={{ zIndex: 20 }}>
          <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 pointer-events-auto">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">
              {activeSide} row — {linePhase}
            </div>

            <div className="flex items-center gap-3">
              {(['start', 'end', 'offset'] as LinePhase[]).map((p, i) => {
                const phases: LinePhase[] = ['start', 'end', 'offset'];
                const done   = phases.indexOf(p) < phases.indexOf(linePhase);
                const active = p === linePhase;
                const labels = { start: 'Start', end: 'End', offset: 'Offset' };
                return (
                  <div key={p} className="flex items-center gap-2">
                    {i > 0 && <div className="w-5 h-px bg-white/20" />}
                    <div className="flex flex-col items-center gap-1">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
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

            <p className="text-white/70 text-xs font-mono">{phaseLabel[linePhase]}</p>
            {linePhase === 'offset' && (
              <p className="text-cyan-400/70 text-[10px] font-mono">Snap to cyan perpendicular line</p>
            )}

            <button onClick={() => { exitTopDown(); setMode('idle'); }}
              className="text-white/30 text-xs hover:text-white/60 transition-colors mt-1">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Calibration panel — disabled */}
      {false && status === 'loaded' && !isTopDown && !IS_CAPTURE && (
        <div data-ui="true"
          style={{ position: 'fixed', top: 96, right: 16, zIndex: 30, minWidth: 230 }}
          className="flex flex-col gap-2">

          <SidePanel
            label="Left Row"
            accentClass="emerald"
            waypoints={calib.leftWaypoints}
            lineConfig={calib.left}
            mode={mode}
            calMode="left_cal"
            lineMode="left_line"
            hasFittedLine={!!leftLine}
            onStartCal={() => startRowCal('left')}
            onCapture={captureWaypoint}
            onStartLine={() => startLinePick('left')}
          />

          <SidePanel
            label="Right Row"
            accentClass="pink"
            waypoints={calib.rightWaypoints}
            lineConfig={calib.right}
            mode={mode}
            calMode="right_cal"
            lineMode="right_line"
            hasFittedLine={!!rightLine}
            onStartCal={() => startRowCal('right')}
            onCapture={captureWaypoint}
            onStartLine={() => startLinePick('right')}
          />

          {canSave && (
            <button onClick={save} disabled={saveStatus === 'saving'}
              className={`py-2 rounded-xl text-sm font-mono transition-colors ${
                saveStatus === 'saved' ? 'bg-green-600/60 text-green-200 border border-green-500/30' :
                saveStatus === 'error' ? 'bg-red-600/60 text-red-200 border border-red-500/30' :
                'bg-green-700/50 hover:bg-green-700/70 text-white border border-green-500/30'
              }`}>
              {saveStatus === 'saving' ? 'Saving…'
                : saveStatus === 'saved'  ? '✓ Saved!'
                : saveStatus === 'error'  ? '✗ Failed'
                : leftComplete && rightComplete ? 'Save Both Sides'
                : leftComplete  ? 'Save Left Side'
                : 'Save Right Side'}
            </button>
          )}

          {(mode === 'left_cal' || mode === 'right_cal') && (
            <div className="bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-mono text-white/50 leading-relaxed">
              Move camera to position, click<br />
              <span className="text-white/30">Capture Position</span>.<br />
              Repeat 3× along the row.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Dashboard subcomponents (from main) ───────────────────────────────────────

function DashboardCard({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/15 p-6 shadow-2xl shadow-black/50 transition-all duration-300 hover:bg-black/50 hover:border-white/25 hover:shadow-2xl hover:shadow-emerald-500/10 hover:scale-101 focus-within:ring-2 focus-within:ring-emerald-500/50">
      <div className="flex items-center gap-3 mb-5 pb-3 border-b border-white/8">
        <div className="p-2.5 rounded-lg bg-white/8 border border-white/10 shadow-sm">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-white/95 tracking-wide uppercase">{title}</h3>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value, unit, icon, progress, color }: any) {
  return (
    <div className="pb-3 last:pb-0">
      <div className="flex justify-between items-end mb-2.5 gap-2">
        <div className="flex items-center gap-2 text-xs text-white/75 font-medium">
          <span className="opacity-85">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold text-white/95">{value}</span>
          <span className="text-xs text-white/65 font-medium">{unit}</span>
        </div>
      </div>
      <div className="h-2.5 w-full bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/5">
        <div className={`h-full ${color} rounded-full transition-all duration-300 ease-out shadow-lg`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function NPKBar({ label, value, color }: any) {
  return (
    <div className="flex-1 bg-black/50 rounded-xl p-3 border border-white/15 flex flex-col items-center gap-2 hover:bg-black/60 hover:border-white/25 hover:scale-105 transition-all duration-200 shadow-sm cursor-pointer">
      <span className="text-xs font-bold text-white/70 uppercase tracking-wide">{label}</span>
      <div className="h-16 w-2 bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/10 flex flex-col justify-end">
        <div className={`w-full ${color} rounded-full transition-all duration-300 shadow-md`} style={{ height: `${value}%` }} />
      </div>
      <span className="text-sm font-bold text-white/95 tabular-nums">{value}%</span>
    </div>
  );
}

function SensorBlock({ label, value, unit, icon }: any) {
  return (
    <div className="bg-black/40 p-4 rounded-xl border border-white/15 hover:border-white/30 hover:bg-black/50 hover:scale-105 transition-all duration-200 shadow-sm hover:shadow-md group cursor-pointer focus-within:ring-2 focus-within:ring-white/40">
      <div className="flex items-start gap-2.5 mb-2.5">
        <div className="opacity-80 group-hover:opacity-100 transition-opacity mt-0.5">
          {icon}
        </div>
        <span className="text-xs text-white/70 uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 pl-0.5">
        <span className="text-xl font-bold text-white/95">{value}</span>
        <span className="text-xs text-white/65 font-medium">{unit}</span>
      </div>
    </div>
  );
}

function WeatherForecast({ type }: { type: 'temperature' | 'precipitation' }) {
  const pastData = [
    { day: 'May 26', temp: 22, precip: 0, icon: '☀️' },
    { day: 'May 27', temp: 19, precip: 5, icon: '🌤️' },
    { day: 'May 28', temp: 18, precip: 12, icon: '🌧️' },
    { day: 'May 29', temp: 21, precip: 2, icon: '☁️' },
  ];
  const futureData = [
    { day: 'Today', temp: 24, precip: 0, icon: '☀️' },
    { day: 'Tomorrow', temp: 23, precip: 3, icon: '🌤️' },
    { day: 'Jun 1', temp: 20, precip: 8, icon: '🌧️' },
  ];

  if (type === 'temperature') {
    return (
      <div className="border-t border-white/8 pt-4">
        <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">7-Day Temperature Forecast</h4>
        <div className="space-y-2">
          <div className="text-xs text-white/60 font-semibold mb-2">← Past 4 Days</div>
          <div className="flex gap-2 mb-3">
            {pastData.map((d, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="text-lg mb-1">{d.icon}</div>
                <div className="text-xs text-white/70 font-medium">{d.day}</div>
                <div className="text-sm font-bold text-white/95">{d.temp}°</div>
              </div>
            ))}
          </div>
          <div className="h-px bg-white/10 my-2"></div>
          <div className="text-xs text-white/60 font-semibold mb-2">Next 3 Days →</div>
          <div className="flex gap-2">
            {futureData.map((d, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="text-lg mb-1">{d.icon}</div>
                <div className="text-xs text-white/70 font-medium">{d.day}</div>
                <div className="text-sm font-bold text-emerald-400">{d.temp}°</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-white/8 pt-4">
      <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">7-Day Precipitation Forecast</h4>
      <div className="space-y-2">
        <div className="text-xs text-white/60 font-semibold mb-2">← Past 4 Days</div>
        <div className="flex gap-2 mb-3">
          {pastData.map((d, i) => (
            <div key={i} className="flex-1">
              <div className="text-lg text-center mb-1">{d.icon}</div>
              <div className="text-xs text-white/70 text-center font-medium">{d.day}</div>
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/10 relative" style={{ minHeight: '3rem' }}>
                <div className="bg-blue-400/70 w-3/4 rounded-t transition-all duration-300" style={{ height: `${Math.max(d.precip * 2, 2)}px` }}></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip}mm</div>
            </div>
          ))}
        </div>
        <div className="h-px bg-white/10 my-2"></div>
        <div className="text-xs text-white/60 font-semibold mb-2">Next 3 Days →</div>
        <div className="flex gap-2">
          {futureData.map((d, i) => (
            <div key={i} className="flex-1">
              <div className="text-lg text-center mb-1">{d.icon}</div>
              <div className="text-xs text-white/70 text-center font-medium">{d.day}</div>
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/10 relative" style={{ minHeight: '3rem' }}>
                <div className="bg-emerald-400/70 w-3/4 rounded-t transition-all duration-300" style={{ height: `${Math.max(d.precip * 2, 2)}px` }}></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip}mm</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeedInfoModal({ weedType, onClose }: { weedType: string | null; onClose: () => void }) {
  const weedDatabase: Record<string, any> = {
    pigweed: {
      name: 'Amaranthus retroflexus (Redroot Pigweed)',
      priority: 'High',
      sector: '4A',
      description: 'A summer annual broadleaf weed that grows rapidly and competes aggressively with crops for nutrients and water. Recognized by its distinctive red/purple root system and ability to produce thousands of seeds.',
      characteristics: [
        'Grows 3-6 feet tall',
        'Deep red/purple root system',
        'Small flowers in terminal spikes',
        'Produces thousands of seeds',
        'Highly variable leaf size',
      ],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amaranthus_retroflexus_-_Redroot_Pigweed.jpg/600px-Amaranthus_retroflexus_-_Redroot_Pigweed.jpg',
      fallbackEmoji: '🌱',
      impact: 'Can reduce crop yields by 10-40% if left uncontrolled',
      season: 'Late Spring to Fall',
    },
    crabgrass: {
      name: 'Digitaria sanguinalis (Large Crabgrass)',
      priority: 'Medium',
      sector: '2B',
      description: 'A summer annual grass weed that germinates when soil temperatures reach 55-60°F. Spreads via stolons and root nodes, forming distinctive circular mats. Very competitive with young crops.',
      characteristics: [
        'Grows in circular mats',
        'Star-like seed head with 3-6 spikes',
        'Yellow-green foliage',
        'Root nodes that initiate new plants',
        'Faster growing than corn',
      ],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Digitaria_sanguinalis_-_Crabgrass.jpg/600px-Digitaria_sanguinalis_-_Crabgrass.jpg',
      fallbackEmoji: '🌾',
      impact: 'Competes heavily during early crop growth stages',
      season: 'Spring to Summer',
    },
  };

  const weed = weedDatabase[weedType || 'pigweed'];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-50">
      <div className="bg-black/80 border border-white/20 rounded-3xl p-8 max-w-3xl w-full mx-4 shadow-2xl shadow-black/80">
        <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white/80 text-2xl cursor-pointer transition-colors">✕</button>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-4xl">{weed.fallbackEmoji}</span>
            <div>
              <h2 className="text-2xl font-bold text-white/95">{weed.name}</h2>
              <p className="text-sm text-white/60">Sector {weed.sector} • {weed.priority} Priority</p>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl overflow-hidden border border-white/10 bg-black/40 h-64">
          <img src={weed.imageUrl} alt={weed.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>

        <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
          <p className="text-white/80 text-sm leading-relaxed">{weed.description}</p>
        </div>

        <div className="mb-6">
          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">Key Characteristics</h3>
          <div className="grid grid-cols-2 gap-2">
            {weed.characteristics.map((char: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span className="text-xs text-white/80">{char}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Impact</p>
            <p className="text-xs text-white/85">{weed.impact}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Season</p>
            <p className="text-xs text-white/85">{weed.season}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Status</p>
            <p className="text-xs text-rose-400 font-bold">Active Threat</p>
          </div>
        </div>

        <button onClick={onClose} className="w-full px-4 py-3 rounded-xl bg-emerald-500/40 border border-emerald-400/50 text-emerald-300 font-bold hover:bg-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/20 transition-all duration-200 uppercase tracking-widest cursor-pointer">
          Close & Review Treatments
        </button>
      </div>
    </div>
  );
}

function TreatmentOption({ id, title, description, icon, onSelect, isSelected }: any) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer hover:scale-102 ${
        isSelected
          ? 'border-emerald-400 bg-emerald-500/20 shadow-lg shadow-emerald-500/20'
          : 'border-white/15 bg-black/40 hover:border-white/30 hover:bg-black/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`text-2xl mt-0.5 ${isSelected ? 'scale-110' : ''} transition-transform`}>{icon}</div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-white/95">{title}</h4>
          <p className="text-xs text-white/70 mt-1 leading-relaxed">{description}</p>
        </div>
        {isSelected && <div className="text-emerald-400 text-lg">✓</div>}
      </div>
    </button>
  );
}

function WeedActionModal({ weedType, onClose, onSelectTreatment, selectedTreatment }: any) {
  const weedInfo: Record<string, any> = {
    pigweed: { name: 'Pigweed', sector: '4A' },
    crabgrass: { name: 'Crabgrass', sector: '2B' },
  };

  const weed = weedInfo[weedType || 'pigweed'];

  const handleExecute = () => {
    if (selectedTreatment) {
      onClose();
      alert(`🤖 Robot assigned to execute: ${selectedTreatment}\n\nThe autonomous agricultural robot is en route to Sector ${weed.sector} and will begin ${weed.name} treatment shortly.`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-50">
      <div className="bg-black/80 border border-white/20 rounded-3xl p-8 max-w-2xl w-full mx-4 shadow-2xl shadow-black/80">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white/95">{weed.name} Treatment Options</h2>
            <p className="text-sm text-white/60 mt-2">Sector {weed.sector} • Select treatment method for deployment</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white/80 text-2xl cursor-pointer transition-colors">✕</button>
        </div>

        <div className="space-y-4 mb-8">
          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-4">Early Stage (Under 3 inches)</h3>
          <TreatmentOption id="pull" title="Manual Pulling" description="Physically remove weeds by hand or with a pulling tool. Most effective when soil is moist. Cost-effective for small infestations." icon="🤲" onSelect={onSelectTreatment} isSelected={selectedTreatment === 'pull'} />
          <TreatmentOption id="hoe" title="Hoeing" description="Use a hoe to cut weeds below the soil surface. Fast and effective for larger early-stage areas. Requires follow-up for root fragments." icon="⛏️" onSelect={onSelectTreatment} isSelected={selectedTreatment === 'hoe'} />
          <TreatmentOption id="mulch" title="Heavy Mulching" description="Apply 3-4 inches of mulch to block sunlight and prevent seed germination. Long-lasting solution, improves soil health." icon="🌾" onSelect={onSelectTreatment} isSelected={selectedTreatment === 'mulch'} />

          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-4 pt-4">Established Infestations</h3>
          <TreatmentOption id="herbicide" title="Chemical Herbicides" description="Apply selective or non-selective herbicides based on crop. Highly effective for large infestations. Follow safety guidelines and re-entry periods." icon="🧪" onSelect={onSelectTreatment} isSelected={selectedTreatment === 'herbicide'} />
          <TreatmentOption id="solarize" title="Soil Solarization" description="Cover soil with clear plastic for 4-6 weeks in hot weather. Heat kills weed seeds and pathogens. Ecological and chemical-free approach." icon="☀️" onSelect={onSelectTreatment} isSelected={selectedTreatment === 'solarize'} />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-white/80 font-semibold hover:bg-white/5 hover:border-white/30 transition-all duration-200 cursor-pointer">Cancel</button>
          <button
            onClick={handleExecute}
            disabled={!selectedTreatment}
            className={`flex-1 px-4 py-3 rounded-xl font-bold uppercase tracking-widest transition-all duration-200 cursor-pointer ${
              selectedTreatment
                ? 'bg-emerald-500/40 border border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/20'
                : 'bg-black/40 border border-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            🤖 Deploy Robot
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Calibration SidePanel subcomponent (from trynamerge) ──────────────────────

interface SidePanelProps {
  label:        string;
  accentClass:  'emerald' | 'pink';
  waypoints:    CameraSnapshot[];
  lineConfig:   LineConfig;
  mode:         CalibMode;
  calMode:      CalibMode;
  lineMode:     CalibMode;
  hasFittedLine: boolean;
  onStartCal:   () => void;
  onCapture:    () => void;
  onStartLine:  () => void;
}

function SidePanel({
  label, accentClass, waypoints, lineConfig, mode,
  calMode, lineMode, hasFittedLine,
  onStartCal, onCapture, onStartLine,
}: SidePanelProps) {
  const isCaling = mode === calMode;
  const color = accentClass === 'emerald'
    ? { dot: 'bg-emerald-500', btn: 'bg-emerald-600/60 hover:bg-emerald-600/80 border-emerald-500/40' }
    : { dot: 'bg-pink-500',    btn: 'bg-pink-600/60    hover:bg-pink-600/80    border-pink-500/40'    };
  const idle = mode === 'idle';

  return (
    <div className="bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="text-white/40 text-[10px] uppercase tracking-widest">{label}</div>

      <div className="flex items-center gap-2">
        {[0,1,2].map(i => (
          <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
            ${waypoints.length > i ? `${color.dot} text-white` : 'bg-white/10 text-white/30'}`}>
            {waypoints.length > i ? '✓' : i+1}
          </div>
        ))}
        <span className="text-white/40 text-[10px] font-mono ml-1">{waypoints.length}/3</span>
      </div>

      {isCaling ? (
        <button onClick={onCapture}
          className={`py-1.5 rounded-lg text-white text-xs font-mono transition-colors border ${color.btn}`}>
          Capture Position ({waypoints.length + 1}/3)
        </button>
      ) : (
        <button onClick={onStartCal} disabled={!idle}
          className="py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white/70 hover:text-white text-xs font-mono transition-colors">
          {waypoints.length === 3 ? 'Re-calibrate' : 'Start Cal'}
        </button>
      )}

      {waypoints.length === 3 && (
        <>
          <div className="h-px bg-white/10" />
          <button onClick={onStartLine} disabled={!idle}
            className="py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white/70 hover:text-white text-xs font-mono transition-colors">
            {lineConfig.cropPt ? 'Re-set Line & Offset' : 'Set Line & Offset'}
          </button>
          {lineConfig.start && lineConfig.end && lineConfig.cropPt && (
            <div className="text-[10px] font-mono text-white/30 flex gap-2 flex-wrap">
              <span>S({lineConfig.start[0].toFixed(1)},{lineConfig.start[2].toFixed(1)})</span>
              <span>→</span>
              <span>E({lineConfig.end[0].toFixed(1)},{lineConfig.end[2].toFixed(1)})</span>
              <span className="text-cyan-400/60 ml-1">offset set</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
