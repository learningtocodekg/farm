/// <reference types="vite/client" />
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
  gpuAcceleratedSort: false,
  sharedMemoryForWorkers: false,
  antialiased: false,
  selfDrivenMode: true,
  dynamicScene: false,
});

(window as any).gsplatViewer = viewer;

viewer
  .addSplatScene('/scene.ply', {
    splatAlphaRemovalThreshold: 12,
    showLoadingUI: false,
    progressiveLoad: true,
  })
  .then(() => {
    viewer.start();
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
