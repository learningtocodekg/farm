import './index.css';
// @ts-expect-error — no types bundled
import * as GS3D from '@mkkellogg/gaussian-splats-3d';
import { createRoot } from 'react-dom/client';
import App from './App';

const splatRoot = document.getElementById('splat-root')!;

const viewer = new GS3D.Viewer({
  rootElement: splatRoot,
  cameraUp: [0, -1, 0],
  initialCameraPosition: [0, -1, 5],
  initialCameraLookAt: [0, 0, 0],
  // quality settings
  antialiased: true,
  gpuAcceleratedSort: false,
  sharedMemoryForWorkers: false,
  dynamicScene: false,
  integerBasedSort: true,
  splatSortDistanceMapPrecision: 20,       // max precision for integer sort
  sceneRevealMode: 2,                      // Instant — no fade-in blur
  sphericalHarmonicsDegree: 2,             // full SH for view-dependent color
  devicePixelRatio: window.devicePixelRatio, // render at native screen resolution
  selfDrivenMode: true,
});

(window as any).gsplatViewer = viewer;

viewer
  .addSplatScene('/scene.ply', {
    splatAlphaRemovalThreshold: 1,
    showLoadingUI: false,
    progressiveLoad: false,
  })
  .then(() => {
    viewer.start();
    (window as any)._splatLoaded = true;
    window.dispatchEvent(new CustomEvent('splat:loaded'));
  })
  .catch((err: unknown) => {
    console.error('Splat load error:', err);
    window.dispatchEvent(new CustomEvent('splat:error'));
  });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    viewer.stop();
    viewer.dispose();
  });
}

createRoot(document.getElementById('root')!).render(<App />);
