import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type SplatStatus = 'loading' | 'loaded' | 'error';

// Modes for the current interaction
type CalibMode =
  | 'idle'
  | 'left_cal'        // capturing 3 left waypoints
  | 'right_cal'       // capturing 3 right waypoints
  | 'left_line'       // top-down: set left line start/end + offset
  | 'right_line';     // top-down: set right line start/end + offset

// Sub-phases within a line-setup mode
type LinePhase = 'start' | 'end' | 'offset';

interface CameraSnapshot {
  position:   [number, number, number];
  quaternion: [number, number, number, number];
  fov:        number;
}

interface LineConfig {
  start:  [number, number, number] | null; // point on fitted line
  end:    [number, number, number] | null; // point on fitted line
  cropPt: [number, number, number] | null; // perpendicular crop row click
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

// Power-iteration PCA line fit through waypoint positions
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

// Signed distance of p from line origin along dir
function projectT(p: number[], origin: number[], dir: number[]) { return dot3(sub3(p, origin), dir); }

// Project a world point onto the fitted line, return the snapped 3D position
function snapToLine(p: [number,number,number], origin: [number,number,number], dir: [number,number,number]): [number,number,number] {
  const t = projectT(p, origin, dir);
  return add3(origin, scale3(dir, t));
}

// Perpendicular direction to dir in XZ plane
function perpXZ(dir: [number,number,number]): [number,number,number] {
  return norm3([-dir[2], 0, dir[0]]);
}

// Project p onto the perpendicular line through lineOrigin
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

// ── helpers to hydrate saved data ─────────────────────────────────────────────

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
  const [status, setStatus]         = useState<SplatStatus>('loading');
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

  // Load existing flight-path.json on mount so prior calibration survives reload
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

  // Fitted lines derived from waypoints (null until 3 waypoints captured)
  const leftLine  = calib.leftWaypoints.length  === 3 ? fitLine(calib.leftWaypoints)  : null;
  const rightLine = calib.rightWaypoints.length === 3 ? fitLine(calib.rightWaypoints) : null;

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

  // ── viewer controls ───────────────────────────────────────────────────────

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
      // offset — snap to perpendicular through the midpoint of start/end
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
      // Draw the full fitted line extended far in both directions
      const FAR = 30;
      const lineColor = activeSide === 'left' ? '#34d399' : '#f472b6';
      const p1 = worldToScreen(add3(line.origin, scale3(line.dir,  FAR)), cam, w, h);
      const p2 = worldToScreen(add3(line.origin, scale3(line.dir, -FAR)), cam, w, h);
      if (p1 && p2) els.push(
        <line key="fitted" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
          stroke={lineColor} strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />
      );

      // Waypoint dots on the line
      const snaps = activeSide === 'left' ? calib.leftWaypoints : calib.rightWaypoints;
      snaps.forEach((s, i) => {
        const snappedPos = snapToLine(s.position as [number,number,number], line.origin, line.dir);
        els.push(dot(`wp-${i}`, snappedPos, lineColor, 5));
      });

      // Start / end markers
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
        // Draw the solid start→end segment
        const ss = worldToScreen(lineConfig.start!, cam, w, h);
        const se = worldToScreen(lineConfig.end,   cam, w, h);
        if (ss && se) els.push(
          <line key="seg" x1={ss[0]} y1={ss[1]} x2={se[0]} y2={se[1]}
            stroke="#ffffff" strokeWidth={2.5} opacity={0.9} />
        );
      }

      // Perpendicular line for offset phase
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

      // Crop point
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

      // Fetch existing saved data so we can merge — saving one side never wipes the other
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
  const statusLabel = { loading: 'Loading…', loaded: 'Ready', error: 'Failed to load' }[status];
  const statusColor = { loading: 'text-yellow-400', loaded: 'text-green-400', error: 'text-red-400' }[status];

  const activeSide  = mode === 'left_line' ? 'left' : mode === 'right_line' ? 'right' : null;
  const phaseLabel: Record<LinePhase, string> = {
    start:  'Click to set scan START',
    end:    'Click to set scan END',
    offset: 'Click the crop row (cyan line)',
  };

  return (
    <>
      {/* Status pill */}
      <div data-ui="true"
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-sm font-mono select-none">
        <span className={statusColor}>{statusLabel}</span>
      </div>

      {/* SVG overlay */}
      {isTopDown && (
        <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}
          width={svgSize.w} height={svgSize.h}>
          {svgOverlay}
        </svg>
      )}

      {/* Click blocker for top-down */}
      {isTopDown && (
        <div
          onClick={handleTopDownClick}
          onMouseMove={handleTopDownMouseMove}
          style={{ position: 'fixed', inset: 0, cursor: 'crosshair', pointerEvents: 'auto', zIndex: 9 }}
        />
      )}

      {/* Top-down instruction banner */}
      {isTopDown && (
        <div data-ui="true"
          className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none" style={{ zIndex: 20 }}>
          <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 pointer-events-auto">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">
              {activeSide} row — {linePhase}
            </div>

            {/* Phase steps */}
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

      {/* ── Main control panel ── */}
      {status === 'loaded' && !isTopDown && !IS_CAPTURE && (
        <div data-ui="true"
          className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-auto"
          style={{ zIndex: 20, minWidth: 230 }}>

          {/* Left row */}
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

          {/* Right row */}
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

          {/* Save */}
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

          {/* In-cal instructions */}
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

// ── SidePanel sub-component ───────────────────────────────────────────────────

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

      {/* Waypoint dots */}
      <div className="flex items-center gap-2">
        {[0,1,2].map(i => (
          <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
            ${waypoints.length > i ? `${color.dot} text-white` : 'bg-white/10 text-white/30'}`}>
            {waypoints.length > i ? '✓' : i+1}
          </div>
        ))}
        <span className="text-white/40 text-[10px] font-mono ml-1">{waypoints.length}/3</span>
      </div>

      {/* Cal button / capture button */}
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

      {/* Line setup — only available after 3 waypoints */}
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
