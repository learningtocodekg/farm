import { useEffect, useState } from 'react';

function getViewer() { return (window as any).gsplatViewer ?? null; }

export default function ThreeDViewer() {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    (window as any)._splatLoaded ? 'loaded' : 'loading'
  );

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

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }} />
  );
}
