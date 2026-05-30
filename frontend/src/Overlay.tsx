import { useEffect, useState } from 'react';

type SplatStatus = 'loading' | 'loaded' | 'error';
type CameraMode = 'perspective' | 'topdown';

export default function Overlay() {
  const [status, setStatus] = useState<SplatStatus>('loading');
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective');

  useEffect(() => {
    const onLoaded = () => setStatus('loaded');
    const onError = () => setStatus('error');
    window.addEventListener('splat:loaded', onLoaded);
    window.addEventListener('splat:error', onError);
    return () => {
      window.removeEventListener('splat:loaded', onLoaded);
      window.removeEventListener('splat:error', onError);
    };
  }, []);

  const toggleCamera = () => {
    const viewer = (window as any).gsplatViewer;
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

  const statusLabel = {
    loading: 'Loading…',
    loaded: 'Ready',
    error: 'Failed to load',
  }[status];

  const statusColor = {
    loading: 'text-yellow-400',
    loaded: 'text-green-400',
    error: 'text-red-400',
  }[status];

  return (
    <>
      {/* Status HUD — top center */}
      <div
        data-ui="true"
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-sm font-mono select-none"
      >
        <span className={statusColor}>{statusLabel}</span>
        {status === 'loaded' && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-white/50 capitalize">{cameraMode}</span>
          </>
        )}
      </div>

      {/* Camera toggle — top right */}
      <button
        data-ui="true"
        onClick={toggleCamera}
        className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-sm font-mono text-white/70 hover:text-white hover:border-white/30 transition-colors select-none"
      >
        {cameraMode === 'perspective' ? 'Top-down' : 'Perspective'}
      </button>
    </>
  );
}
