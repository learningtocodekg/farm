import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

function getViewer() { return (window as any).gsplatViewer ?? null; }

interface ManifestFrame {
  frame: string;
  position: [number, number, number];
  pass: 'left' | 'right';
}

interface Manifest {
  frameWidth: number;
  flightLine: { start: [number, number, number]; end: [number, number, number]; y: number };
  crops: { leftOffset: number; rightOffset: number };
  viewport: { width: number; height: number };
  frames: ManifestFrame[];
}

interface CameraSnapshot {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
}

interface FlightPath {
  leftCamera: CameraSnapshot;
  rightCamera: CameraSnapshot;
  flightLine: { start: [number, number, number]; end: [number, number, number]; y: number };
  crops: { leftOffset: number; rightOffset: number };
  frameWidth: number;
}

interface Deltas {
  fov: number;
  y: number;
  forward: number;
  lateral: number;
}

interface FrameAdjustment {
  frame: string;
  pass_: string;
  position: [number, number, number];
  baseCamera: CameraSnapshot;
  deltas: Deltas;
  effectiveCamera: CameraSnapshot;
}

const ZERO_DELTAS: Deltas = { fov: 0, y: 0, forward: 0, lateral: 0 };

// Reconstruct where capture.js would have placed the camera for this frame.
// capture.js moves X and Z along the flight line but keeps the same quaternion and FOV
// from the calibration. The calibration camera's Y and perpendicular offset are fixed.
function frameCamera(
  frame: ManifestFrame,
  flightPath: FlightPath,
  deltas: Deltas,
): CameraSnapshot {
  const base = frame.pass === 'left' ? flightPath.leftCamera : flightPath.rightCamera;
  const flStart = flightPath.flightLine.start;
  const flEnd = flightPath.flightLine.end;

  // The flight line direction in XZ
  const dx = flEnd[0] - flStart[0];
  const dz = flEnd[2] - flStart[2];
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const fwdX = dx / len;
  const fwdZ = dz / len;
  // Perpendicular in XZ
  const perpX = -fwdZ;
  const perpZ = fwdX;

  // The base calibration camera has a fixed perpendicular offset from the flight line.
  // For each frame, the drone is at frame.position (on the flight line).
  // Reconstruct: keep the same perp offset from the base camera, but move along the flight line
  // to match where the drone actually was for this frame.
  //
  // The base camera was captured when the drone was at the flight line start.
  // So: base.position = flightStart + perpOffset + any along-line offset at calibration time.
  // We want: framePos_along_line + same perpOffset.
  //
  // Project base.position onto perp to get the perp offset magnitude:
  const basePerpOffset =
    (base.position[0] - flStart[0]) * perpX +
    (base.position[2] - flStart[2]) * perpZ;

  // The camera X/Z = frame's flight-line XZ + the perp offset
  const camX = frame.position[0] + basePerpOffset * perpX + deltas.lateral * perpX + deltas.forward * fwdX;
  const camY = base.position[1] + deltas.y;
  const camZ = frame.position[2] + basePerpOffset * perpZ + deltas.lateral * perpZ + deltas.forward * fwdZ;

  return {
    position: [camX, camY, camZ],
    quaternion: base.quaternion,
    fov: base.fov + deltas.fov,
  };
}

function applyCamera(cam: CameraSnapshot) {
  const viewer = getViewer();
  if (!viewer) return;
  if (viewer.controls) viewer.controls.enabled = false;
  viewer.camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
  viewer.camera.quaternion.set(cam.quaternion[0], cam.quaternion[1], cam.quaternion[2], cam.quaternion[3]);
  viewer.camera.fov = cam.fov;
  viewer.camera.updateProjectionMatrix();
  viewer.camera.updateMatrixWorld();
}

export default function ReviewPage() {
  const [splatLoaded, setSplatLoaded] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [flightPath, setFlightPath] = useState<FlightPath | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [frameIndex, setFrameIndex] = useState(0);
  const [deltas, setDeltas] = useState<Deltas>(ZERO_DELTAS);
  const adjustmentsRef = useRef<Map<number, FrameAdjustment>>(new Map());
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if ((window as any)._splatLoaded) { setSplatLoaded(true); return; }
    const onLoad = () => setSplatLoaded(true);
    window.addEventListener('splat:loaded', onLoad, { once: true });
    return () => window.removeEventListener('splat:loaded', onLoad);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/manifest').then(r => { if (!r.ok) throw new Error(`manifest: ${r.status}`); return r.json(); }),
      fetch('/flight-path.json').then(r => { if (!r.ok) throw new Error(`flight-path: ${r.status}`); return r.json(); }),
    ])
      .then(([m, fp]) => { setManifest(m); setFlightPath(fp); })
      .catch(e => setLoadError(e.message));
  }, []);

  // Position splat camera to match what capture.js saw for this frame
  useEffect(() => {
    if (!splatLoaded || !manifest || !flightPath) return;
    const frames = manifest.frames;
    if (frames.length === 0) return;

    const cam = frameCamera(frames[frameIndex], flightPath, deltas);
    applyCamera(cam);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => applyCamera(cam));
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [splatLoaded, manifest, flightPath, frameIndex, deltas]);

  // Lock controls for the whole review session
  useEffect(() => {
    const viewer = getViewer();
    if (viewer?.controls) viewer.controls.enabled = false;
    return () => { if (viewer?.controls) viewer.controls.enabled = true; };
  }, []);

  if (loadError) {
    return (
      <div data-ui="true" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)', color: '#f87171', fontFamily: 'monospace', zIndex: 100, flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 16 }}>Failed to load</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{loadError}</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>Make sure backend is running and capture.js has been run first.</div>
      </div>
    );
  }

  if (!manifest || !flightPath || !splatLoaded) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', color: '#fff', fontFamily: 'monospace', zIndex: 100 }}>
        {!splatLoaded ? 'Loading splat…' : 'Loading capture data…'}
      </div>
    );
  }

  const frames = manifest.frames;
  const total = frames.length;
  if (total === 0) {
    return (
      <div data-ui="true" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)', color: '#fbbf24', fontFamily: 'monospace', zIndex: 100 }}>
        No frames in manifest. Run capture.js first.
      </div>
    );
  }

  const entry = frames[frameIndex];
  const base = entry.pass === 'left' ? flightPath.leftCamera : flightPath.rightCamera;
  const liveCam = frameCamera(entry, flightPath, deltas);

  function commitAndGo(targetIndex: number) {
    adjustmentsRef.current.set(frameIndex, {
      frame: entry.frame,
      pass_: entry.pass,
      position: entry.position,
      baseCamera: base,
      deltas: { ...deltas },
      effectiveCamera: liveCam,
    });
    setVisited(v => new Set(v).add(frameIndex));
    const stored = adjustmentsRef.current.get(targetIndex);
    setDeltas(stored ? { ...stored.deltas } : { ...ZERO_DELTAS });
    setFrameIndex(targetIndex);
  }

  async function saveLog() {
    adjustmentsRef.current.set(frameIndex, {
      frame: entry.frame,
      pass_: entry.pass,
      position: entry.position,
      baseCamera: base,
      deltas: { ...deltas },
      effectiveCamera: liveCam,
    });

    const adjustments: FrameAdjustment[] = frames.map((fr, i) => {
      const stored = adjustmentsRef.current.get(i);
      if (stored) return stored;
      const bc = fr.pass === 'left' ? flightPath!.leftCamera : flightPath!.rightCamera;
      return {
        frame: fr.frame, pass_: fr.pass, position: fr.position, baseCamera: bc,
        deltas: { ...ZERO_DELTAS },
        effectiveCamera: frameCamera(fr, flightPath!, ZERO_DELTAS),
      };
    });

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/save-review-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savedAt: new Date().toISOString(), frameCount: total, adjustments }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  const passColor = entry.pass === 'left' ? '#22d3ee' : '#a78bfa';

  return (
    <>
      {/* Full-screen pointer blocker so orbit controls never fire — sits below all UI */}
      <div data-ui="true" style={{ position: 'fixed', inset: 0, zIndex: 1 }} />

      {/* ── Left half: captured PNG ── */}
      <div data-ui="true" style={{
        position: 'fixed', top: 0, left: 0, width: '50%', height: '100%',
        background: '#0a0a0a', zIndex: 10,
        display: 'flex', flexDirection: 'column', fontFamily: 'monospace', color: '#e5e7eb',
      }}>
        {/* Header */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>CAPTURED</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            frame {frameIndex + 1}/{total} · <span style={{ color: passColor }}>{entry.pass}</span>
          </span>
        </div>

        {/* PNG */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, overflow: 'hidden', paddingBottom: 130 }}>
          <img
            src={`/frames/${entry.frame}`}
            alt={entry.frame}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', border: '1px solid #1f2937' }}
          />
        </div>

        {/* Frame info */}
        <div style={{ padding: '6px 12px', borderTop: '1px solid #1f2937', fontSize: 10, color: '#4b5563', flexShrink: 0, paddingBottom: 130 }}>
          <div>{entry.frame}</div>
          <div>drone pos: [{entry.position.map(n => n.toFixed(3)).join(', ')}]</div>
        </div>
      </div>

      {/* ── Right half label (the splat shows through here) ── */}
      <div data-ui="true" style={{
        position: 'fixed', top: 0, left: '50%', width: '50%',
        padding: '8px 12px', zIndex: 10, pointerEvents: 'none',
        display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace',
      }}>
        <span style={{ fontSize: 12, color: '#9ca3af', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 3 }}>SPLAT (reconstructed)</span>
        <span style={{ fontSize: 10, color: '#4b5563', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 3 }}>
          cam [{liveCam.position.map(n => n.toFixed(2)).join(', ')}] fov {liveCam.fov.toFixed(1)}°
        </span>
      </div>

      {/* ── Bottom control bar ── */}
      <div data-ui="true" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(8,8,8,0.97)', borderTop: '1px solid #1f2937',
        zIndex: 20, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Sliders */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {([
            { label: 'FOV', field: 'fov' as const, min: -30, max: 30, step: 0.5, baseVal: base.fov },
            { label: 'Height', field: 'y' as const, min: -1, max: 1, step: 0.01, baseVal: base.position[1] },
            { label: 'Forward', field: 'forward' as const, min: -2, max: 2, step: 0.01, baseVal: 0 },
            { label: 'Lateral', field: 'lateral' as const, min: -2, max: 2, step: 0.01, baseVal: 0 },
          ]).map(({ label, field, min, max, step, baseVal }) => {
            const delta = deltas[field];
            return (
              <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 160 }}>
                <span style={{ fontSize: 10, width: 50, flexShrink: 0, color: '#6b7280' }}>{label}</span>
                <input type="range" min={min} max={max} step={step} value={delta}
                  style={{ flex: 1 }}
                  onChange={e => setDeltas(d => ({ ...d, [field]: parseFloat(e.target.value) }))}
                />
                <span style={{ fontSize: 10, width: 70, textAlign: 'right', color: delta !== 0 ? '#fbbf24' : '#4b5563' }}>
                  {(baseVal + delta).toFixed(2)}{delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(2)})` : ''}
                </span>
                {delta !== 0 && (
                  <button onClick={() => setDeltas(d => ({ ...d, [field]: 0 }))}
                    style={{ fontSize: 9, padding: '1px 4px', background: '#1f2937', border: 'none', color: '#6b7280', cursor: 'pointer', borderRadius: 2 }}>✕</button>
                )}
              </div>
            );
          })}
        </div>

        {/* Nav buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => frameIndex > 0 && commitAndGo(frameIndex - 1)}
            disabled={frameIndex === 0}
            style={{ padding: '4px 12px', background: '#1f2937', border: '1px solid #374151', color: frameIndex === 0 ? '#374151' : '#e5e7eb', cursor: frameIndex === 0 ? 'default' : 'pointer', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}
          >← Prev</button>

          <button onClick={() => frameIndex < total - 1 ? commitAndGo(frameIndex + 1) : saveLog()}
            style={{ padding: '4px 16px', background: frameIndex < total - 1 ? '#1d4ed8' : '#065f46', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 4, fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}
          >{frameIndex < total - 1 ? 'Next →' : 'Finish + Save'}</button>

          {visited.size > 0 && (
            <button onClick={saveLog} disabled={saveStatus === 'saving'}
              style={{ padding: '4px 12px', background: '#111827', border: '1px solid #374151', color: saveStatus === 'saved' ? '#34d399' : saveStatus === 'error' ? '#f87171' : '#9ca3af', cursor: 'pointer', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' }}
            >{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? '✗ Error' : 'Save Log'}</button>
          )}

          <span style={{ fontSize: 10, color: '#374151', marginLeft: 'auto' }}>
            visited {visited.size}/{total} · tweak sliders so splat matches the captured frame
          </span>
        </div>
      </div>
    </>
  );
}
