/**
 * Headless drone flyover frame capture.
 * Reads flight-path.json (3-waypoint format), fits a line through each side's
 * waypoints, walks the camera along that line between the saved start/end,
 * and saves a PNG per frame + manifest.json with full per-frame unproject data.
 *
 * Run: node scripts/capture.js
 * The Vite dev server must be running on http://localhost:5173.
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const FLIGHT_PATH   = path.resolve(__dirname, '../frontend/public/flight-path.json');
const FRAMES_DIR    = path.resolve(__dirname, 'frames');
const VIEWPORT      = { width: 1280, height: 720 };
const RENDER_SETTLE = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── math ──────────────────────────────────────────────────────────────────────

function dot3(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function sub3(a, b)   { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function add3(a, b)   { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale3(v, s) { return [v[0]*s, v[1]*s, v[2]*s]; }
function len3(v)      { return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); }
function norm3(v)     { const l = len3(v); return l < 1e-10 ? v : scale3(v, 1/l); }

// Power-iteration PCA — dominant direction through waypoint positions
function fitLine(waypoints) {
  const pts = waypoints.map(w => w.position);
  const n   = pts.length;
  const cx  = pts.reduce((a,p) => a+p[0], 0)/n;
  const cy  = pts.reduce((a,p) => a+p[1], 0)/n;
  const cz  = pts.reduce((a,p) => a+p[2], 0)/n;
  const c   = [cx, cy, cz];
  const centered = pts.map(p => sub3(p, c));

  let dir = centered.reduce((best, v) => len3(v) > len3(best) ? v : best, centered[0]).slice();
  dir = norm3(dir);
  for (let i = 0; i < 64; i++) {
    const next = [0,0,0];
    for (const v of centered) {
      const d = dot3(v, dir);
      next[0] += v[0]*d; next[1] += v[1]*d; next[2] += v[2]*d;
    }
    if (len3(next) < 1e-10) break;
    dir = norm3(next);
  }
  return { origin: c, dir };
}

function projectT(p, origin, dir) { return dot3(sub3(p, origin), dir); }

// ── capture pass ──────────────────────────────────────────────────────────────

async function capturePass(page, sideConfig, waypoints, side) {
  const line = fitLine(waypoints);

  // Project saved start/end onto the fitted line to get t range
  const tStart = projectT(sideConfig.flightLine.start, line.origin, line.dir);
  const tEnd   = projectT(sideConfig.flightLine.end,   line.origin, line.dir);
  const tMin   = Math.min(tStart, tEnd);
  const tMax   = Math.max(tStart, tEnd);
  const totalDist = tMax - tMin;

  const MAX_STEP = 3.0;
  const effectiveStep = Math.min(sideConfig.frameWidth, MAX_STEP);
  const numFrames = Math.max(1, Math.floor(totalDist / effectiveStep));

  // Use middle waypoint orientation for all frames
  const nomSnap = waypoints[1];

  console.log(`  Pass ${side}: ${numFrames} frames, dist=${totalDist.toFixed(3)}, frameWidth=${sideConfig.frameWidth.toFixed(3)}`);

  await page.evaluate(() => {
    const v = window.gsplatViewer;
    if (v?.controls) v.controls.enabled = false;
  });

  const frames = [];

  for (let i = 0; i < numFrames; i++) {
    const t   = tMin + (i + 0.5) * (totalDist / numFrames);
    const pos = add3(line.origin, scale3(line.dir, t));

    await page.evaluate(({ pos, quat, fov }) => {
      const v = window.gsplatViewer;
      if (!v) return;
      if (v.controls) v.controls.enabled = false;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
      v.camera.fov = fov;
      v.camera.updateProjectionMatrix();
      v.camera.updateMatrixWorld();
    }, { pos, quat: nomSnap.quaternion, fov: nomSnap.fov });

    await sleep(RENDER_SETTLE);

    const idx      = String(i).padStart(4, '0');
    const filename = `frame_${side}_${idx}.png`;
    await page.screenshot({ path: path.join(FRAMES_DIR, filename) });

    frames.push({
      frame:      filename,
      pass:       side,
      // Full camera state for pixel→3D unprojection
      position:   pos,
      quaternion: nomSnap.quaternion,
      fov:        nomSnap.fov,
      aspect:     VIEWPORT.width / VIEWPORT.height,
      // Which crop plane to intersect for this side
      cropPlane:  sideConfig.cropPlane,
      cropPt:     sideConfig.cropPt,
    });

    console.log(`    [${i+1}/${numFrames}] ${filename} @ (${pos.map(n => n.toFixed(3)).join(', ')})`);
  }

  await page.evaluate(() => {
    const v = window.gsplatViewer;
    if (v?.controls) v.controls.enabled = true;
  });

  return frames;
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!fs.existsSync(FLIGHT_PATH)) {
    console.error('flight-path.json not found. Run the calibration UI first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(FLIGHT_PATH, 'utf8'));

  if (!config.leftWaypoints || config.leftWaypoints.length !== 3 ||
      !config.rightWaypoints || config.rightWaypoints.length !== 3 ||
      !config.left?.flightLine?.start || !config.right?.flightLine?.start) {
    console.error('flight-path.json is incomplete or in the old format. Re-run calibration in the UI.');
    process.exit(1);
  }

  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('Launching browser…');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  console.log('Opening http://localhost:5173 …');
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Waiting for splat to load…');
  await page.evaluate(() =>
    new Promise((resolve, reject) => {
      if (window._splatLoaded) return resolve();
      window.addEventListener('splat:loaded', resolve, { once: true });
      window.addEventListener('splat:error', () => reject(new Error('splat load error')), { once: true });
      const start = Date.now();
      const poll = setInterval(() => {
        if (window._splatLoaded) { clearInterval(poll); resolve(); }
        if (Date.now() - start > 120000) { clearInterval(poll); reject(new Error('timeout')); }
      }, 500);
    })
  );
  console.log('Splat loaded. Starting capture…');

  const allFrames = [];

  console.log('\n--- Left pass ---');
  allFrames.push(...await capturePass(page, config.left, config.leftWaypoints, 'left'));

  console.log('\n--- Right pass ---');
  allFrames.push(...await capturePass(page, config.right, config.rightWaypoints, 'right'));

  await browser.close();

  // manifest.json — everything needed to map pixel → 3D world point offline
  const manifest = {
    viewport:       VIEWPORT,
    leftWaypoints:  config.leftWaypoints,
    rightWaypoints: config.rightWaypoints,
    left:  config.left,   // flightLine, cropPt, cropPlane, flightDir, frameWidth
    right: config.right,
    frames: allFrames,
    // Unproject recipe:
    //   Given pixel (px, py) in a frame:
    //   1. ndcX = (px / viewport.width)  * 2 - 1
    //      ndcY = (py / viewport.height) * 2 - 1   (note: may need -1 * for y depending on convention)
    //   2. Build ray from frame.position through NDC using frame.fov + frame.aspect + frame.quaternion
    //   3. Intersect ray with frame.cropPlane: t = (d - dot(n, rayOrigin)) / dot(n, rayDir)
    //   4. worldPoint = rayOrigin + t * rayDir
    unprojectRecipe: {
      planeEquation: 'dot(cropPlane.normal, point) = cropPlane.d',
      t:             't = (cropPlane.d - dot(normal, rayOrigin)) / dot(normal, rayDir)',
      worldPoint:    'rayOrigin + t * rayDir',
    },
  };

  const manifestPath = path.join(FRAMES_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nDone. ${allFrames.length} frames captured.`);
  console.log(`Manifest: ${manifestPath}`);
})();
