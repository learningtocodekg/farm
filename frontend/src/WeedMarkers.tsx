import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface Anomaly {
  id: string;
  type: 'weed' | 'dry_spot' | 'pest';
  position: [number, number, number];
}

const TYPE_CONFIG = {
  weed:     { label: 'WEED',     color: '#00ff88', pulse: '#00ff88' },
  dry_spot: { label: 'DRY SPOT', color: '#ffcc00', pulse: '#ffcc00' },
  pest:     { label: 'PEST',     color: '#ff4444', pulse: '#ff4444' },
};

interface MarkerState {
  anomaly: Anomaly;
  vec: THREE.Vector3;
}

export default function WeedMarkers() {
  const [markers, setMarkers] = useState<MarkerState[]>([]);
  const markerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fetch('/anomalies.json')
      .then(r => r.ok ? r.json() : null)
      .then((data: Anomaly[] | null) => {
        if (!data) return;
        setMarkers(data.map(a => ({
          anomaly: a,
          vec: new THREE.Vector3(...a.position),
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (markers.length === 0) return;

    const loop = () => {
      const viewer = (window as any).gsplatViewer;
      const cam: THREE.PerspectiveCamera | undefined = viewer?.camera;
      if (!cam) { rafRef.current = requestAnimationFrame(loop); return; }

      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const { anomaly, vec } of markers) {
        const el = markerRefs.current[anomaly.id];
        if (!el) continue;

        const projected = vec.clone().project(cam);
        const x = ((projected.x + 1) / 2) * w;
        const y = (-(projected.y - 1) / 2) * h;
        const visible =
          projected.z >= -1 && projected.z <= 1 &&
          x >= -60 && x <= w + 60 && y >= -60 && y <= h + 60;

        el.style.display = visible ? 'block' : 'none';
        el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [markers]);

  if (markers.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      {markers.map(({ anomaly }) => {
        const cfg = TYPE_CONFIG[anomaly.type] ?? TYPE_CONFIG.weed;
        return (
          <div
            key={anomaly.id}
            ref={el => { markerRefs.current[anomaly.id] = el; }}
            style={{
              display: 'none',
              position: 'absolute',
              top: 0, left: 0,
            }}
          >
            {/* Badge */}
            <div style={{
              position: 'absolute',
              transform: 'translate(-50%, -200%)',
              background: 'rgba(0,0,0,0.75)',
              border: `1px solid ${cfg.color}`,
              color: cfg.color,
              fontSize: 10,
              fontFamily: 'monospace',
              padding: '2px 6px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              letterSpacing: 1,
            }}>
              {cfg.label}
            </div>
            {/* Sphere dot */}
            <div style={{
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: cfg.color,
              boxShadow: `0 0 8px 2px ${cfg.color}`,
            }} />
            {/* Pulse ring */}
            <div style={{
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: `2px solid ${cfg.color}`,
              animation: 'anomaly-pulse 1.8s ease-out infinite',
            }} />
            <style>{`
              @keyframes anomaly-pulse {
                0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.8; }
                100% { transform: translate(-50%,-50%) scale(3.5); opacity: 0; }
              }
            `}</style>
          </div>
        );
      })}
    </div>
  );
}
