/**
 * Headless drone flyover frame capture.
 * Reads flight-path.json, launches Puppeteer, moves the camera along the
 * flight line in two passes (left-facing, right-facing), and saves a PNG
 * per frame + manifest.json.
 *
 * Run: node scripts/capture.js
 * Prereqs: npm install puppeteer  (run once inside scripts/ or project root)
 * The Vite dev server must be running on http://localhost:5173.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const FLIGHT_PATH = path.resolve(__dirname, '../frontend/public/flight-path.json');
const FRAMES_DIR = path.resolve(__dirname, 'frames');
const VIEWPORT = { width: 1280, height: 720 };
const RENDER_SETTLE_MS = 400; // ms to wait after moving camera before screenshot

function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function capturePass(page, config, passSuffix, cameraConfig) {
  const { flightLine, frameWidth } = config;
  const start = flightLine.start; // [x, y, z]
  const end = flightLine.end;     // [x, y, z]

  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const totalDist = Math.sqrt(dx * dx + dz * dz);
  const MAX_STEP = 3.0; // cap step size so we always get enough frames
  const effectiveWidth = Math.min(frameWidth, MAX_STEP);
  const numFrames = Math.max(1, Math.floor(totalDist / effectiveWidth));
  const step = totalDist / numFrames;

  // Flight line direction unit vector in XZ
  const fwdX = dx / totalDist;
  const fwdZ = dz / totalDist;

  // The calibration camera has a perpendicular offset from the flight line.
  // Project the calibration camera position onto the perp axis to get that offset,
  // then add it to every frame position so the drone flies parallel to the row.
  const perpX = -fwdZ;
  const perpZ = fwdX;
  const basePerpOffset =
    (cameraConfig.position[0] - start[0]) * perpX +
    (cameraConfig.position[2] - start[2]) * perpZ;

  console.log(`  Pass ${passSuffix}: ${numFrames} frames, step=${step.toFixed(3)}, total dist=${totalDist.toFixed(3)}, perpOffset=${basePerpOffset.toFixed(3)}`);

  // Disable orbit controls for the whole pass so they don't fight the set quaternion
  await page.evaluate(() => {
    const v = window.gsplatViewer;
    if (v?.controls) v.controls.enabled = false;
  });

  const manifest = [];

  for (let i = 0; i < numFrames; i++) {
    const t = (i + 0.5) / numFrames; // center of each frame cell
    const flX = lerp(start[0], end[0], t);
    const flZ = lerp(start[2], end[2], t);
    // Apply the perpendicular offset so camera flies beside the row, not on the flight line
    const x = flX + basePerpOffset * perpX;
    const z = flZ + basePerpOffset * perpZ;
    const y = cameraConfig.position[1]; // use calibrated height, not flightLine.y
    const pos = [x, y, z];

    // Move camera to this position with the saved orientation.
    // Disable controls so they don't fight the manually set quaternion.
    await page.evaluate(({ pos, quat, fov }) => {
      const v = window.gsplatViewer;
      if (!v) return;
      if (v.controls) v.controls.enabled = false;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
      v.camera.fov = fov;
      v.camera.updateProjectionMatrix();
      v.camera.updateMatrixWorld();
    }, { pos, quat: cameraConfig.quaternion, fov: cameraConfig.fov });

    await sleep(RENDER_SETTLE_MS);

    const frameIdx = String(i).padStart(4, '0');
    const filename = `frame_${passSuffix}_${frameIdx}.png`;
    const filepath = path.join(FRAMES_DIR, filename);
    await page.screenshot({ path: filepath });

    manifest.push({ frame: filename, position: pos, pass: passSuffix });
    console.log(`    [${i + 1}/${numFrames}] ${filename} @ (${pos.map(n => n.toFixed(3)).join(', ')})`);
  }

  // Re-enable controls after pass
  await page.evaluate(() => {
    const v = window.gsplatViewer;
    if (v?.controls) v.controls.enabled = true;
  });

  return manifest;
}

(async () => {
  if (!fs.existsSync(FLIGHT_PATH)) {
    console.error('flight-path.json not found. Run the calibration UI first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(FLIGHT_PATH, 'utf8'));
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('Launching browser…');
  const browser = await puppeteer.launch({
    headless: false, // must be headed — headless can't render WebGL gaussian splats
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  console.log('Opening http://localhost:5173 …');
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for splat:loaded, with a fallback poll in case the event already fired
  console.log('Waiting for splat to load…');
  await page.evaluate(() =>
    new Promise((resolve, reject) => {
      // Already loaded
      if (window._splatLoaded) return resolve();
      // Listen for the event
      window.addEventListener('splat:loaded', resolve, { once: true });
      window.addEventListener('splat:error', () => reject(new Error('splat load error')), { once: true });
      // Fallback: poll every 500ms for up to 120s
      const start = Date.now();
      const poll = setInterval(() => {
        if (window._splatLoaded) { clearInterval(poll); resolve(); }
        if (Date.now() - start > 120000) { clearInterval(poll); reject(new Error('splat load timeout')); }
      }, 500);
    })
  );
  console.log('Splat loaded. Starting capture…');

  const allManifest = [];

  // Left-facing pass
  console.log('\n--- Left pass ---');
  const leftManifest = await capturePass(page, config, 'left', config.leftCamera);
  allManifest.push(...leftManifest);

  // Right-facing pass
  console.log('\n--- Right pass ---');
  const rightManifest = await capturePass(page, config, 'right', config.rightCamera);
  allManifest.push(...rightManifest);

  await browser.close();

  const manifestPath = path.join(FRAMES_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    frameWidth: config.frameWidth,
    flightLine: config.flightLine,
    crops: config.crops,
    viewport: VIEWPORT,
    frames: allManifest,
  }, null, 2));

  console.log(`\nDone. ${allManifest.length} frames captured.`);
  console.log(`Manifest: ${manifestPath}`);
  console.log('Next: python scripts/analyze.py');
})();
