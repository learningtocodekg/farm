import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface WeedEntry {
  id: string;
  position: [number, number, number];
}

interface MarkerState {
  weed: WeedEntry;
  vec: THREE.Vector3;
}

export default function WeedMarkers() {
  const [markers, setMarkers] = useState<MarkerState[]>([]);
  const markerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fetch('/weeds.json')
      .then(r => r.ok ? r.json() : null)
      .then((data: WeedEntry[] | null) => {
        if (!data) return;
        setMarkers(data.map(w => ({
          weed: w,
          vec: new THREE.Vector3(...w.position),
        })));
      })
      .catch(() => {/* no weeds.json yet, silently skip */});
  }, []);

  useEffect(() => {
    if (markers.length === 0) return;

    const loop = () => {
      const viewer = (window as any).gsplatViewer;
      const cam: THREE.PerspectiveCamera | undefined = viewer?.camera;
      if (!cam) { rafRef.current = requestAnimationFrame(loop); return; }

      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const { weed, vec } of markers) {
        const el = markerRefs.current[weed.id];
        if (!el) continue;

        const projected = vec.clone().project(cam);
        const x = ((projected.x + 1) / 2) * w;
        const y = (-(projected.y - 1) / 2) * h;
        const visible = projected.z >= -1 && projected.z <= 1 && x >= -60 && x <= w + 60 && y >= -60 && y <= h + 60;

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
      {markers.map(({ weed }) => (
        <div
          key={weed.id}
          ref={el => { markerRefs.current[weed.id] = el; }}
          className="weed-pin"
          style={{ display: 'none' }}
        >
          <div className="weed-badge">WEED</div>
          <div className="weed-pulse" />
          <div className="weed-pulse weed-pulse--delay" />
          <div className="weed-dot" />
        </div>
      ))}
    </div>
  );
}
