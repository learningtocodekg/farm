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
  // allows toDataURL() to read back the rendered frame
  rendererParams: { preserveDrawingBuffer: true },
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

const splatFile = new URLSearchParams(window.location.search).get('scene') === 'clean'
  ? '/scene_clean.ply'
  : '/scene.ply';

viewer
  .addSplatScene(splatFile, {
    splatAlphaRemovalThreshold: 1,
    showLoadingUI: false,
    progressiveLoad: false,
  })
  .then(() => {
    viewer.start();
    (window as any)._splatLoaded = true;

    // If loaded inside the review iframe, teleport camera to the frame position
    const params = new URLSearchParams(window.location.search);
    if (params.has('cx')) {
      import('three').then(({ Quaternion, Vector3, Euler }) => {
        const px = parseFloat(params.get('cx')!);
        const py = parseFloat(params.get('cy')!);
        const pz = parseFloat(params.get('cz')!);
        const qx = parseFloat(params.get('qx')!);
        const qy = parseFloat(params.get('qy')!);
        const qz = parseFloat(params.get('qz')!);
        const qw = parseFloat(params.get('qw')!);

        const cam = viewer.camera;
        cam.position.set(px, py, pz);
        cam.quaternion.set(qx, qy, qz, qw);
        cam.updateMatrixWorld();

        // Derive a lookAt target: 2 units ahead along camera -Z
        const forward = new Vector3(0, 0, -2).applyQuaternion(
          new Quaternion(qx, qy, qz, qw)
        );
        cam.lookAt(px + forward.x, py + forward.y, pz + forward.z);
      });

      // Hide the React UI overlay so only the splat is visible
      const reactRoot = document.getElementById('root');
      if (reactRoot) reactRoot.style.display = 'none';
    }

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
