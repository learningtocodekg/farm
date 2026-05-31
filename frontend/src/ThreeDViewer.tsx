import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, MapPin, Copy, Download } from 'lucide-react';
import * as THREE from 'three';

function getViewer() { return (window as any).gsplatViewer ?? null; }

type CameraMode = 'perspective' | 'topdown';

export default function ThreeDViewer() {
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective');
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    (window as any)._splatLoaded ? 'loaded' : 'loading'
  );
  const [pointMode, setPointMode] = useState(false);
  const [placedPoint, setPlacedPoint] = useState<{ x: number; y: number; z: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const markerRef = useRef<THREE.Object3D | null>(null);

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

  // On mount: make splat interactive, clear any crop, restore perspective camera
  useEffect(() => {
    const splat = document.getElementById('splat-root');
    if (splat) {
      splat.style.pointerEvents = 'auto';
      splat.style.clipPath = '';
    }

    if (status !== 'loaded') return;
    const viewer = getViewer();
    if (!viewer?.controls) return;
    viewer.controls.enabled = true;
    viewer.camera.position.set(0, -1, 5);
    viewer.camera.up.set(0, -1, 0);
    viewer.controls.target.set(0, 0, 0);
    viewer.controls.update();
    setCameraMode('perspective');

    // Hide the dashboard brown ground plane in 3D view
    const scene = (viewer as any).threeScene ?? (viewer as any).scene;
    const plane = scene?.getObjectByName('dashboard-ground');
    if (plane) plane.visible = false;
  }, [status]);

  // On unmount: snap back to top-down so dashboard is ready immediately
  useEffect(() => {
    return () => {
      const splat = document.getElementById('splat-root');
      if (splat) splat.style.pointerEvents = 'none';
      const viewer = getViewer();
      if (!viewer?.controls) return;
      viewer.controls.enabled = false;
      viewer.controls.target.set(0, 0, 0);
      viewer.camera.position.set(0, -10, 0);
      viewer.camera.up.set(0, 0, 1);
      viewer.camera.lookAt(0, 0, 0);
      viewer.camera.updateProjectionMatrix();
      viewer.camera.updateMatrixWorld();
    };
  }, []);

  // Point placement click handler
  useEffect(() => {
    if (status !== 'loaded' || !pointMode) return;

    const splatRoot = document.getElementById('splat-root');
    const canvas = splatRoot?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    canvas.style.cursor = 'crosshair';

    let startX = 0, startY = 0, dragged = false;

    const onDown = (e: MouseEvent) => {
      startX = e.clientX; startY = e.clientY; dragged = false;
    };
    const onMove = (e: MouseEvent) => {
      if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) dragged = true;
    };
    const onClick = (e: MouseEvent) => {
      if (dragged) return;
      const viewer = getViewer();
      if (!viewer?.camera) return;

      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), viewer.camera);

      // Intersect with the ground plane Y = 0
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, hit)) return;

      setPlacedPoint({ x: hit.x, y: hit.y, z: hit.z });

      const scene = (viewer as any).threeScene ?? (viewer as any).scene;
      if (!scene) return;

      if (markerRef.current) scene.remove(markerRef.current);

      const group = new THREE.Group();

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false }),
      );
      sphere.position.copy(hit);
      group.add(sphere);

      // Vertical spike so the pin is visible from any camera angle
      const pts = [
        new THREE.Vector3(hit.x, hit.y - 1.5, hit.z),
        new THREE.Vector3(hit.x, hit.y + 0.4, hit.z),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff3333 }),
      );
      group.add(line);

      scene.add(group);
      markerRef.current = group;
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);

    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.style.cursor = 'default';
    };
  }, [pointMode, status]);

  // Remove marker + clear coords when point mode is turned off
  useEffect(() => {
    if (!pointMode) {
      if (markerRef.current) {
        const viewer = getViewer();
        const scene = (viewer as any)?.threeScene ?? (viewer as any)?.scene;
        scene?.remove(markerRef.current);
        markerRef.current = null;
      }
      setPlacedPoint(null);
    }
  }, [pointMode]);

  // Remove marker on page unmount
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        const viewer = getViewer();
        const scene = (viewer as any)?.threeScene ?? (viewer as any)?.scene;
        scene?.remove(markerRef.current);
      }
    };
  }, []);

  function copyPoint() {
    if (!placedPoint) return;
    const fmt = (n: number) => +n.toFixed(4);
    navigator.clipboard.writeText(
      JSON.stringify({ x: fmt(placedPoint.x), y: fmt(placedPoint.y), z: fmt(placedPoint.z) }, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadPoint() {
    if (!placedPoint) return;
    const fmt = (n: number) => +n.toFixed(4);
    const blob = new Blob(
      [JSON.stringify({ x: fmt(placedPoint.x), y: fmt(placedPoint.y), z: fmt(placedPoint.z) }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'point.json' });
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleCamera() {
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
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {/* Top-right button bar */}
      <div style={{
        position: 'absolute', top: 72, right: 24,
        display: 'flex', gap: 12, pointerEvents: 'auto',
      }}>
        {status === 'loaded' && (
          <>
            <Link
              to="/report"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 12,
                background: 'rgba(34,197,94,0.25)', border: '1px solid rgba(34,197,94,0.4)',
                color: '#6ee7b7', fontSize: 11, fontFamily: 'monospace',
                fontWeight: 600, textDecoration: 'none', textTransform: 'uppercase',
                letterSpacing: '0.08em', cursor: 'pointer',
              }}
            >
              <FileText size={14} />
              Generate Report
            </Link>

            <button
              onClick={() => setPointMode(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 12,
                background: pointMode ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.5)',
                border: `1px solid ${pointMode ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.15)'}`,
                color: pointMode ? '#fca5a5' : 'rgba(255,255,255,0.75)',
                fontSize: 11, fontFamily: 'monospace',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              <MapPin size={14} />
              {pointMode ? 'Exit Point Mode' : 'Place Point'}
            </button>

            <button
              onClick={toggleCamera}
              style={{
                padding: '10px 20px', borderRadius: 12,
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.75)', fontSize: 11, fontFamily: 'monospace',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              {cameraMode === 'perspective' ? 'Top-Down View' : 'Perspective View'}
            </button>
          </>
        )}
      </div>

      {/* Hint shown while point mode is active but no point placed yet */}
      {pointMode && !placedPoint && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 12, padding: '10px 22px',
          color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: 'monospace',
          pointerEvents: 'none',
        }}>
          Click anywhere in the scene to place a point
        </div>
      )}

      {/* Coordinate readout panel */}
      {placedPoint && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, padding: '14px 22px',
          display: 'flex', alignItems: 'center', gap: 24,
          pointerEvents: 'auto',
        }}>
          {/* X Y Z values */}
          <div style={{ display: 'flex', gap: 22 }}>
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} style={{ textAlign: 'center' }}>
                <div style={{
                  color: axis === 'x' ? '#f87171' : axis === 'y' ? '#4ade80' : '#60a5fa',
                  fontSize: 10, fontFamily: 'monospace', fontWeight: 700, marginBottom: 3,
                  textTransform: 'uppercase',
                }}>
                  {axis}
                </div>
                <div style={{ color: 'white', fontSize: 15, fontFamily: 'monospace', fontWeight: 600 }}>
                  {placedPoint[axis].toFixed(3)}
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={copyPoint}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: copied ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${copied ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.2)'}`,
                color: copied ? '#6ee7b7' : 'rgba(255,255,255,0.8)',
                fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
              }}
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
            <button
              onClick={downloadPoint}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
              }}
            >
              <Download size={12} />
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
