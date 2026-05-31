import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import {
  ShieldAlert, Sprout, FileText,
  Bot, CheckCircle, AlertCircle
} from 'lucide-react';
import { HeatmapLayer, LAYER_GRADIENTS, LAYER_RANGES, COLOR_SCALES, mapColor } from './components/SoilHeatmap';
import SoilSensorOverlay from './components/SoilSensorOverlay';
import soilData from './data/soilSensors.json';
import ProblemMarkers, { PROBLEMS } from './ProblemMarkers';

// ── types ─────────────────────────────────────────────────────────────────────

type SplatStatus = 'loading' | 'loaded' | 'error';
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

function applyTopDown(viewer: any, px = 0, pz = 0, py = -7) {
  viewer.controls.enabled = false;
  viewer.controls.target.set(px, 0, pz);
  viewer.camera.position.set(px, py, pz);
  viewer.camera.up.set(0, 0, 1);
  viewer.camera.lookAt(px, 0, pz);
  viewer.camera.updateProjectionMatrix();
  viewer.camera.updateMatrixWorld();
}

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
  // Field / Soil sub-mode
  const [pageMode, setPageMode] = useState<'field' | 'soil'>('field');

  // Camera pan + height for top-down view
  const [panX] = useState(-1.25);
  const [panZ] = useState(0);
  const [camH] = useState(-8.5);

  const [denseBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Splat / viewer status
  const [status, setStatus]         = useState<SplatStatus>('loading');

  // Splat always visible, fully non-interactive on dashboard
  useEffect(() => {
    const splat = document.getElementById('splat-root');
    if (!splat) return;
    splat.style.display = 'block';
    splat.style.pointerEvents = 'none';
    splat.style.clipPath = '';
  }, []);

  // Lock camera top-down on mount (handles returning from 3D page when splat already loaded)
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer?.controls || !(window as any)._splatLoaded) return;
    applyTopDown(viewer, panX, panZ, camH);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock camera top-down, re-runs when splat loads or pan changes
  useEffect(() => {
    if (status !== 'loaded') return;
    const viewer = getViewer();
    if (!viewer?.controls) return;
    applyTopDown(viewer, panX, panZ, camH);

    // Dirt ground plane — shows through transparent splat gaps
    const scene = (viewer as any).threeScene ?? (viewer as any).scene;
    if (scene) {
      let plane = scene.getObjectByName('dashboard-ground');
      if (!plane) {
        const geo = new THREE.PlaneGeometry(200, 200);
        const mat = new THREE.MeshBasicMaterial({ color: 0xA07850, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'dashboard-ground';
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 1;
        scene.add(mesh);
        plane = mesh;
      }
      (plane as THREE.Mesh).visible = true;
    }
  }, [status, panX, panZ, camH]);

  const [focalUrl, setFocalUrl] = useState<string | null>(null);

  // Soil view layer selector
  const [soilLayer, setSoilLayer] = useState<HeatmapLayer>('moisture');

  // Left panel tab
  const [leftTab, setLeftTab] = useState<'agent-log' | 'problems'>('agent-log');

  // Dashboard UI state
  const [showActionModal, setShowActionModal]       = useState(false);
  const [selectedTreatment, setSelectedTreatment]   = useState<string | null>(null);
  const [showWeedModal, setShowWeedModal]           = useState(false);
  const [selectedWeed, setSelectedWeed]             = useState<string | null>(null);
  const [actionWeed, setActionWeed]                 = useState<string | null>(null);

  // Drone dispatch state
  const [activeDroneProblemId, setActiveDroneProblemId] = useState<string | null>(null);
  const [completedDrones, setCompletedDrones]           = useState<Set<string>>(new Set());
  const [dropdownProblemId, setDropdownProblemId]       = useState<string | null>(null);

  const handleDroneComplete = (problemId: string) => {
    setCompletedDrones(prev => new Set([...prev, problemId]));
    setActiveDroneProblemId(null);
  };

  const dispatchDrone = (problemId: string) => {
    setDropdownProblemId(null);
    setActiveDroneProblemId(problemId);
  };

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

      const existing: any = await fetch('/flight-path.json')
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

  const BG = '#f9f9f9';
  const BORDER = '1px solid #1b1b1b';
  const BORDER_SUBTLE = '1px solid #c8c8c8';

  return (
    <>
      {/* 32px edge masks — cover outer padding so splat doesn't bleed around panels */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 32, background: BG, zIndex: 3, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 32, background: BG, zIndex: 3, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 32, background: BG, zIndex: 3, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 32, background: BG, zIndex: 3, pointerEvents: 'none' }} />

      {/* Click blocker — keeps splat non-interactive */}
      {!isTopDown && <div style={{ position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'auto', cursor: 'default' }} />}



      {/* Dense region outline */}
      {denseBox && pageMode === 'field' && (
        <div style={{
          position: 'fixed',
          left: `${denseBox.left}%`, top: `${denseBox.top}%`,
          width: `${denseBox.width}%`, height: `${denseBox.height}%`,
          border: '2px solid rgba(34,197,94,0.85)',
          boxShadow: '0 0 12px rgba(34,197,94,0.3)',
          pointerEvents: 'none', zIndex: 8,
        }} />
      )}

      {/* ── Main layout ── */}
      <div className="absolute inset-0 flex flex-col" style={{ zIndex: 10, pointerEvents: 'none', padding: 32 }}>

        {/* Header */}
        <header className="flex-shrink-0 pb-5" style={{ background: BG }}>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: '#474747' }}>
            <span>FarmOS PRECISION v4.0</span>
            <span style={{ color: '#c8c8c8' }}>/</span>
            <span style={{ color: '#1b1b1b' }}>Dashboard</span>
          </div>
          <div className="flex items-end justify-between">
            <h1 className="font-bold uppercase" style={{ fontSize: '4rem', letterSpacing: '-0.04em', lineHeight: 1, color: '#1b1b1b' }}>
              F<span className="normal-case">arm</span>OS DASHBOARD
            </h1>
            <div className="flex items-center gap-3 pointer-events-auto mb-1">
              <Link to="/report" className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors" style={{ border: BORDER, background: BG, color: '#1b1b1b' }}>
                <FileText className="w-3.5 h-3.5" />
                Generate Report
              </Link>
            </div>
          </div>
        </header>

        {/* ── 3-column grid ── */}
        <div
          className="flex-1 min-h-0 grid grid-cols-12"
          onClick={isTopDown ? handleTopDownClick : undefined}
          onMouseMove={isTopDown ? handleTopDownMouseMove : undefined}
        >

          {/* LEFT — Agent Log / Soil Quality (col-span-3) */}
          <section className="col-span-3 flex flex-col overflow-hidden pointer-events-auto" style={{ background: BG, border: BORDER }}>
            {pageMode === 'soil' ? (
              <>
                <div className="flex-shrink-0 flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ padding: '16px 20px', borderBottom: BORDER, background: '#ebebeb', color: '#1b1b1b' }}>
                  <Sprout className="w-4 h-4" /> Soil Quality
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <SoilQualityPanel layer={soilLayer} onLayerChange={setSoilLayer} />
                </div>
              </>
            ) : (
              <>
                <div className="flex-shrink-0 flex justify-between items-center" style={{ padding: '16px 20px', borderBottom: BORDER, background: '#ebebeb' }}>
                  <h2 className="text-xs font-bold tracking-widest uppercase flex items-center gap-2" style={{ color: '#1b1b1b' }}>
                    <Bot className="w-4 h-4" /> Agent Log
                  </h2>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a8220' }}>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#4a8220' }} />
                        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#4a8220' }} />
                      </span>
                      Live
                    </div>
                    <span className="text-white text-[10px] font-bold px-1.5 py-0.5 leading-none" style={{ background: '#ba1a1a' }}>2 PROBLEMS</span>
                  </div>
                </div>
                {/* Tabs */}
                <div className="flex flex-shrink-0" style={{ borderBottom: BORDER }}>
                  <button onClick={() => setLeftTab('agent-log')} className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest cursor-pointer focus:outline-none" style={{ background: leftTab === 'agent-log' ? BG : '#ebebeb', color: leftTab === 'agent-log' ? '#1b1b1b' : '#767676', borderBottom: leftTab === 'agent-log' ? '2px solid #1b1b1b' : '2px solid transparent' }}>
                    <Bot className="w-3.5 h-3.5" /> Agent Log
                  </button>
                  <div style={{ width: 1, background: '#1b1b1b' }} />
                  <button onClick={() => setLeftTab('problems')} className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest cursor-pointer focus:outline-none" style={{ background: leftTab === 'problems' ? BG : '#ebebeb', color: leftTab === 'problems' ? '#ba1a1a' : '#767676', borderBottom: leftTab === 'problems' ? '2px solid #ba1a1a' : '2px solid transparent' }}>
                    <ShieldAlert className="w-3.5 h-3.5" /> Problems
                    <span className="text-white text-[10px] font-bold px-1.5 py-0.5" style={{ background: '#ba1a1a' }}>2</span>
                  </button>
                </div>
                {leftTab === 'agent-log' && (
                  <div className="flex-1 overflow-y-auto p-3 font-mono" style={{ fontSize: 12, color: '#1b1b1b' }}>
                    {[
                      { time: '09:38', message: 'sent drone #33 to spray pesticides to 36.7893, -119.4145 due to high pest spotting' },
                      { time: '09:35', message: 'sent drone #21 to spread fertilizer to 36.7905, -119.4181 due to sensors showing low nutrient levels' },
                      { time: '09:28', message: 'activated sprinkler in 36.7870, -119.4145 due to low moisture levels in soil' },
                      { time: '09:22', message: 'sent drone #17 to spread fertilizer to 36.7903, -119.4167 due to sensors showing low nutrient levels' },
                      { time: '09:15', message: 'activated sprinkler in 36.7871, -119.4132 due to low moisture levels in soil' },
                    ].map((entry, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: BORDER_SUBTLE }}>
                        [{entry.time}] {entry.message}
                      </div>
                    ))}
                  </div>
                )}
                {leftTab === 'problems' && (
                  <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#767676' }}>Active Issues</span>
                      <span className="text-white text-[10px] font-bold px-2 py-0.5" style={{ background: '#ba1a1a' }}>
                        {PROBLEMS.length - completedDrones.size} unresolved
                      </span>
                    </div>

                    {PROBLEMS.map(problem => {
                      const isActive = activeDroneProblemId === problem.id;
                      const isDone   = completedDrones.has(problem.id);
                      const isOpen   = dropdownProblemId === problem.id;
                      return (
                        <div key={problem.id} style={{ border: `1px solid ${problem.color}50`, background: `${problem.color}08` }}>
                          {/* Problem row */}
                          <div className="flex items-center gap-3 p-3">
                            <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: problem.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="text-sm font-bold" style={{ color: '#1b1b1b' }}>{problem.label}</h4>
                                <span className="text-white text-[9px] font-bold px-1.5 py-0.5 uppercase" style={{ background: problem.color }}>
                                  {problem.severity}
                                </span>
                              </div>
                              <p className="text-xs font-medium" style={{
                                color: isActive ? '#00658f' : isDone ? '#4a8220' : problem.color,
                              }}>
                                {isActive ? '🚁 Drone en route…' : isDone ? '✓ Treatment complete' : problem.detail}
                              </p>
                            </div>
                            {isDone ? (
                              <span className="text-[10px] font-bold px-2 py-1 shrink-0" style={{ color: '#4a8220', border: '1px solid #4a822040', background: '#4a822010' }}>✓ Done</span>
                            ) : (
                              <button
                                onClick={() => setDropdownProblemId(isOpen ? null : problem.id)}
                                disabled={!!activeDroneProblemId}
                                className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest cursor-pointer shrink-0 flex items-center gap-1 transition-opacity"
                                style={{
                                  background: `${problem.color}18`,
                                  border: `1px solid ${problem.color}50`,
                                  color: problem.color,
                                  opacity: activeDroneProblemId ? 0.45 : 1,
                                }}
                              >
                                {isActive ? '…' : 'Take Action'}
                                {!isActive && <span style={{ fontSize: '0.6rem' }}>{isOpen ? '▲' : '▼'}</span>}
                              </button>
                            )}
                          </div>

                          {/* Inline dropdown */}
                          {isOpen && !isDone && (
                            <div style={{ borderTop: `1px solid ${problem.color}30`, padding: '8px 12px 10px', background: `${problem.color}05` }}>
                              <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: '#767676' }}>Deploy Action</p>
                              <button
                                onClick={() => dispatchDrone(problem.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest cursor-pointer hover:opacity-80 transition-opacity"
                                style={{ background: '#1b1b1b', color: '#fff', border: 'none' }}
                              >
                                <span style={{ fontSize: '1rem' }}>🚁</span>
                                <span>Send Drone</span>
                                <span className="ml-auto" style={{ opacity: 0.4, fontSize: '0.7rem' }}>→</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Static infrastructure issues */}
                    <div className="p-3" style={{ border: BORDER_SUBTLE }}>
                      <div className="flex justify-between text-xs"><span style={{ color: '#474747' }}>Irrigation deficit</span><span className="font-bold" style={{ color: '#ba1a1a' }}>Critical</span></div>
                      <p className="text-[11px] mt-1" style={{ color: '#767676' }}>Bottom-right zone: moisture 18–27% — below 35%</p>
                    </div>
                    <div className="p-3" style={{ border: BORDER_SUBTLE }}>
                      <div className="flex justify-between text-xs"><span style={{ color: '#474747' }}>NPK deficiency</span><span className="font-bold" style={{ color: '#b97b00' }}>Warning</span></div>
                      <p className="text-[11px] mt-1" style={{ color: '#767676' }}>Top-left zone: N/P/K critically low — fertilization needed</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* CENTER — Gaussian splat top view (col-span-6) */}
          <section className="col-span-6 flex flex-col" style={{ borderTop: BORDER, borderBottom: BORDER }}>
            <div className="flex-shrink-0 flex justify-between items-center" style={{ background: BG, borderBottom: BORDER, padding: '16px 20px' }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: '#4a8220' }} />
                <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#1b1b1b' }}>
                  {pageMode === 'soil' ? 'SOIL HEATMAP: VINEYARD BLOCK A' : 'LIVE FEED: VINEYARD BLOCK A'}
                </span>
              </div>
            </div>
            {/* Transparent body — gaussian splat renders here */}
            <div className="flex-1 relative" style={{ background: 'transparent', overflow: 'hidden' }}>
              {pageMode === 'soil' && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(249,249,249,0.9)' }}>
                  <div style={{ height: '100%', maxWidth: '100%', aspectRatio: '385 / 581', overflow: 'hidden' }}>
                    <SoilSensorOverlay layer={soilLayer} onLayerChange={setSoilLayer} />
                  </div>
                </div>
              )}
              {/* Drone status banner */}
              {activeDroneProblemId && (() => {
                const p = PROBLEMS.find(x => x.id === activeDroneProblemId);
                return p ? (
                  <div className="absolute top-4 left-1/2 pointer-events-none" style={{ transform: 'translateX(-50%)', zIndex: 20 }}>
                    <div className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider" style={{ background: '#1b1b1b', color: '#fff', border: `1px solid ${p.color}60` }}>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#00ff88' }} />
                        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#00ff88' }} />
                      </span>
                      🚁 Drone dispatched → {p.label}
                    </div>
                  </div>
                ) : null;
              })()}

              <div className="absolute bottom-4 left-4 pointer-events-none" style={{ background: BG, border: BORDER, padding: '10px 14px' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#474747' }}>Coordinates</div>
                <div className="font-mono text-sm" style={{ color: '#1b1b1b' }}>41.40338, 2.17403</div>
              </div>
            </div>
          </section>

          {/* RIGHT — Ambient Conditions + Forecast (col-span-3) */}
          <section className="col-span-3 flex flex-col overflow-y-auto pointer-events-auto" style={{ background: BG, border: BORDER, borderLeft: 'none' }}>
            <div className="flex-shrink-0 text-xs font-bold uppercase tracking-widest" style={{ padding: '16px 20px', borderBottom: BORDER, background: '#ebebeb', color: '#1b1b1b' }}>
              Ambient Conditions
            </div>
            <div className="grid grid-cols-2 flex-shrink-0" style={{ borderBottom: BORDER }}>
              <InstitutionalSensor label="TEMPERATURE" value="24.2" unit="°C" />
              <InstitutionalSensor label="HUMIDITY" value="55" unit="%" borderLeft />
              <InstitutionalSensor label="UV INDEX" value="7.2" unit="" badge="HIGH" badgeColor="#b97b00" borderTop />
              <InstitutionalSensor label="SOLAR RAD." value="850" unit="W/m²" borderLeft borderTop />
            </div>
            <InstitutionalForecast />
          </section>

        </div>
      </div>

      {/* SVG calibration overlay */}
      {svgOverlay && (
        <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 15, pointerEvents: 'none' }}>
          {svgOverlay}
        </svg>
      )}

      {/* Calibration instruction banner */}
      {isTopDown && (
        <div data-ui="true" className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none" style={{ zIndex: 20 }}>
          <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 pointer-events-auto">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">{activeSide} row — {linePhase}</div>
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
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${done ? 'bg-green-500 text-white' : active ? 'bg-white text-black' : 'bg-white/10 text-white/30'}`}>{done ? '✓' : i + 1}</span>
                      <span className={`text-[9px] font-mono ${active ? 'text-white' : done ? 'text-green-400' : 'text-white/30'}`}>{labels[p]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-white/70 text-xs font-mono">{phaseLabel[linePhase]}</p>
            {linePhase === 'offset' && <p className="text-cyan-400/70 text-[10px] font-mono">Snap to cyan perpendicular line</p>}
            <button onClick={() => { exitTopDown(); setMode('idle'); }} className="text-white/30 text-xs hover:text-white/60 transition-colors mt-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Focal rows result */}
      {focalUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }} onClick={() => setFocalUrl(null)}>
          <div className="text-white/40 text-xs uppercase tracking-widest font-mono">Focal Rows — highest heatmap variance</div>
          <img src={focalUrl} alt="Focal crop rows" style={{ maxHeight: '80vh', maxWidth: '90vw', borderRadius: 12, boxShadow: '0 0 60px rgba(139,92,246,0.3)' }} onClick={e => e.stopPropagation()} />
          <button onClick={() => setFocalUrl(null)} className="px-6 py-2 rounded-xl bg-white/10 border border-white/20 text-white/70 text-xs font-semibold uppercase tracking-widest hover:bg-white/20 transition-all cursor-pointer">Close</button>
        </div>
      )}

      {/* Modals */}
      {showActionModal && (
        <WeedActionModal weedType={actionWeed} onClose={() => { setShowActionModal(false); setSelectedTreatment(null); setActionWeed(null); }} onSelectTreatment={setSelectedTreatment} selectedTreatment={selectedTreatment} />
      )}
      {showWeedModal && (
        <WeedInfoModal weedType={selectedWeed} onClose={() => { setShowWeedModal(false); setSelectedWeed(null); }} />
      )}

      {/* Problem markers + drone animation on the splat */}
      <ProblemMarkers
        activeDroneProblemId={activeDroneProblemId}
        onDroneComplete={handleDroneComplete}
      />

      {/* Calibration panel — disabled */}
      {false && status === 'loaded' && !isTopDown && !IS_CAPTURE && (
        <div data-ui="true" style={{ position: 'fixed', top: 96, right: 16, zIndex: 30, minWidth: 230 }} className="flex flex-col gap-2">
          <SidePanel label="Left Row" accentClass="emerald" waypoints={calib.leftWaypoints} lineConfig={calib.left} mode={mode} calMode="left_cal" lineMode="left_line" hasFittedLine={!!leftLine} onStartCal={() => startRowCal('left')} onCapture={captureWaypoint} onStartLine={() => startLinePick('left')} />
          <SidePanel label="Right Row" accentClass="pink" waypoints={calib.rightWaypoints} lineConfig={calib.right} mode={mode} calMode="right_cal" lineMode="right_line" hasFittedLine={!!rightLine} onStartCal={() => startRowCal('right')} onCapture={captureWaypoint} onStartLine={() => startLinePick('right')} />
          {canSave && (
            <button onClick={save} disabled={saveStatus === 'saving'} className={`py-2 rounded-xl text-sm font-mono transition-colors ${saveStatus === 'saved' ? 'bg-green-600/60 text-green-200 border border-green-500/30' : saveStatus === 'error' ? 'bg-red-600/60 text-red-200 border border-red-500/30' : 'bg-green-700/50 hover:bg-green-700/70 text-white border border-green-500/30'}`}>
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved!' : saveStatus === 'error' ? '✗ Failed' : leftComplete && rightComplete ? 'Save Both Sides' : leftComplete ? 'Save Left Side' : 'Save Right Side'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ── Soil Quality panel ────────────────────────────────────────────────────────

const LAYER_LABELS: Record<HeatmapLayer, string> = {
  moisture:   'Moisture',
  nitrogen:   'Nitrogen',
  phosphorus: 'Phosphorus',
  potassium:  'Potassium',
  ph:         'pH',
};

const LAYER_UNITS: Record<HeatmapLayer, string> = {
  moisture:   '%',
  nitrogen:   ' ppm',
  phosphorus: ' ppm',
  potassium:  ' ppm',
  ph:         '',
};

const LAYER_DESC: Record<HeatmapLayer, string> = {
  moisture:   'Soil water content — below 35% triggers irrigation.',
  nitrogen:   'Primary macronutrient for leaf & stem growth.',
  phosphorus: 'Root development & energy transfer nutrient.',
  potassium:  'Regulates water uptake and disease resistance.',
  ph:         'Optimal range 6.0–7.0 for most crops.',
};

function SoilQualityPanel({
  layer, onLayerChange,
}: {
  layer: HeatmapLayer;
  onLayerChange: (l: HeatmapLayer) => void;
}) {
  const sensors = soilData.sensors;
  const values = sensors.map(s => {
    switch (layer) {
      case 'moisture':   return s.moisture;
      case 'nitrogen':   return s.nitrogen;
      case 'phosphorus': return s.phosphorus;
      case 'potassium':  return s.potassium;
      case 'ph':         return s.ph;
    }
  });
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Normalize ppm values to the 0–100 color scale range before mapping colour
  function normForScale(v: number): number {
    if (layer === 'nitrogen')   return (v / 60) * 100;
    if (layer === 'phosphorus') return (v / 50) * 100;
    if (layer === 'potassium')  return ((v - 100) / 150) * 100;
    return v;
  }

  const [minR, minG, minB] = mapColor(normForScale(min), COLOR_SCALES[layer]);
  const [maxR, maxG, maxB] = mapColor(normForScale(max), COLOR_SCALES[layer]);
  const [avgR, avgG, avgB] = mapColor(normForScale(avg), COLOR_SCALES[layer]);

  const layers: HeatmapLayer[] = ['moisture', 'nitrogen', 'phosphorus', 'potassium', 'ph'];

  const fmt = (v: number) =>
    layer === 'ph' ? v.toFixed(1) : Math.round(v).toString();

  return (
    <div className="rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 shadow-2xl overflow-hidden">
      {/* Title */}
      <div className="px-5 pt-5 pb-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <Sprout className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-bold text-white/90 tracking-wide">Soil Quality</span>
        </div>
        <p className="text-[11px] text-white/40 mt-1">20 sensors · rows 0–3</p>
      </div>

      {/* Layer tabs */}
      <div className="px-4 pt-4 pb-2 flex flex-col gap-1.5">
        {layers.map(l => (
          <button
            key={l}
            onClick={() => onLayerChange(l)}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-150 cursor-pointer flex items-center justify-between ${
              l === layer
                ? 'bg-white/15 text-white border border-white/25'
                : 'text-white/50 hover:text-white/80 hover:bg-white/8 border border-transparent'
            }`}
          >
            <span>{LAYER_LABELS[l]}</span>
            {l === layer && (
              <span className="text-[10px] font-mono text-white/60">{fmt(avg)} avg</span>
            )}
          </button>
        ))}
      </div>

      {/* Active layer stats */}
      <div className="px-4 pb-5 pt-2">
        <p className="text-[11px] text-white/40 mb-3">{LAYER_DESC[layer]}</p>

        {/* Gradient bar */}
        <div className="mb-3">
          <div className="h-2 rounded-full w-full" style={{ background: LAYER_GRADIENTS[layer] }} />
          <div className="flex justify-between text-[10px] text-white/40 mt-1">
            <span>{LAYER_RANGES[layer].min}</span>
            <span>{LAYER_RANGES[layer].max}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Min', val: min, r: minR, g: minG, b: minB },
            { label: 'Avg', val: avg, r: avgR, g: avgG, b: avgB },
            { label: 'Max', val: max, r: maxR, g: maxG, b: maxB },
          ].map(({ label, val, r, g, b }) => (
            <div key={label} className="rounded-xl bg-white/6 border border-white/10 px-2 py-2 text-center">
              <div className="text-[10px] text-white/40 uppercase tracking-widest">{label}</div>
              <div className="text-sm font-bold font-mono mt-0.5" style={{ color: `rgb(${r},${g},${b})` }}>
                {fmt(val)}{LAYER_UNITS[layer]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Institutional sub-components ─────────────────────────────────────────────

function InstitutionalSensor({ label, value, unit, badge, badgeColor, borderLeft, borderTop }: {
  label: string; value: string; unit: string;
  badge?: string; badgeColor?: string;
  borderLeft?: boolean; borderTop?: boolean;
}) {
  const style: React.CSSProperties = {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };
  if (borderLeft) style.borderLeft = '1px solid #c8c8c8';
  if (borderTop) style.borderTop = '1px solid #c8c8c8';
  return (
    <div style={style}>
      <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#474747' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: '2rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#1b1b1b' }}>{value}</span>
        {unit && <span style={{ fontSize: '0.9rem', color: '#474747' }}>{unit}</span>}
        {badge && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: badgeColor ?? '#1b1b1b', textTransform: 'uppercase' }}>{badge}</span>}
      </div>
    </div>
  );
}

function InstitutionalForecast() {
  const past = [
    { day: 'May 26', icon: '☀️', temp: 22 },
    { day: 'May 27', icon: '⛅', temp: 19 },
    { day: 'May 28', icon: '🌧️', temp: 18 },
    { day: 'May 29', icon: '☁️', temp: 21 },
  ];
  const future = [
    { day: 'Today',    icon: '☀️',  temp: 24 },
    { day: 'Tomorrow', icon: '⛅',  temp: 23 },
    { day: 'Jun 1',    icon: '🌧️', temp: 20 },
  ];
  const BORDER = '1px solid #1b1b1b';
  const SUBTLE = '1px solid #c8c8c8';
  return (
    <div className="flex flex-col flex-1">
      <div className="flex justify-between items-center" style={{ padding: '16px 20px', borderBottom: BORDER, background: '#ebebeb' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#1b1b1b' }}>7-Day Temperature Forecast</span>
      </div>
      <div style={{ padding: '10px 16px 4px', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#767676', borderBottom: SUBTLE }}>← Past 4 Days</div>
      <div className="grid grid-cols-4" style={{ borderBottom: BORDER }}>
        {past.map((d, i) => (
          <div key={i} className="flex flex-col items-center" style={{ padding: '12px 8px', borderRight: i < 3 ? SUBTLE : 'none', gap: 4 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: '#474747' }}>{d.day}</span>
            <span style={{ fontSize: '1.2rem' }}>{d.icon}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700, color: '#1b1b1b' }}>{d.temp}°</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '10px 16px 4px', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#767676', borderBottom: SUBTLE }}>Next 3 Days →</div>
      <div className="grid grid-cols-3" style={{ background: '#ebebeb' }}>
        {future.map((d, i) => (
          <div key={i} className="flex flex-col items-center" style={{ padding: '16px 8px', borderRight: i < 2 ? BORDER : 'none', gap: 4 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#1b1b1b' }}>{d.day}</span>
            <span style={{ fontSize: '1.4rem' }}>{d.icon}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, color: '#4a8220' }}>{d.temp}°</span>
          </div>
        ))}
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
  calMode,
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
