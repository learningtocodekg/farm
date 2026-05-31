/**
 * One-time Firestore seed script.
 * Run: node seed.js
 * Then delete this entire firebase-migration/ folder.
 *
 * Prerequisites:
 *   1. npm install
 *   2. Place your Firebase service account JSON next to this file as serviceAccount.json
 *      (Download from Firebase Console → Project Settings → Service Accounts → Generate new private key)
 *   3. Set your Firestore database URL below if you are NOT using the default US region.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'));

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();

// ─── 1. Soil Sensors ──────────────────────────────────────────────────────────
const soilSensors = [
  { id: 'SOIL-001', lat: 36.7905, lng: -119.4181, x: 0.17, y: 0.11, moisture: 47, nitrogen: 12,  phosphorus: 9,  potassium: 128, ph: 6.3 },
  { id: 'SOIL-002', lat: 36.7903, lng: -119.4167, x: 0.34, y: 0.09, moisture: 52, nitrogen: 15,  phosphorus: 12, potassium: 138, ph: 6.4 },
  { id: 'SOIL-003', lat: 36.7904, lng: -119.4155, x: 0.50, y: 0.10, moisture: 58, nitrogen: 38,  phosphorus: 24, potassium: 168, ph: 6.5 },
  { id: 'SOIL-004', lat: 36.7905, lng: -119.4144, x: 0.67, y: 0.11, moisture: 61, nitrogen: 47,  phosphorus: 31, potassium: 185, ph: 6.6 },
  { id: 'SOIL-005', lat: 36.7903, lng: -119.4131, x: 0.81, y: 0.09, moisture: 59, nitrogen: 51,  phosphorus: 33, potassium: 192, ph: 6.7 },
  { id: 'SOIL-006', lat: 36.7894, lng: -119.4181, x: 0.18, y: 0.38, moisture: 51, nitrogen: 16,  phosphorus: 11, potassium: 135, ph: 6.4 },
  { id: 'SOIL-007', lat: 36.7892, lng: -119.4168, x: 0.32, y: 0.36, moisture: 56, nitrogen: 22,  phosphorus: 17, potassium: 152, ph: 6.5 },
  { id: 'SOIL-008', lat: 36.7894, lng: -119.4157, x: 0.51, y: 0.37, moisture: 63, nitrogen: 42,  phosphorus: 27, potassium: 175, ph: 6.5 },
  { id: 'SOIL-009', lat: 36.7893, lng: -119.4145, x: 0.65, y: 0.38, moisture: 58, nitrogen: 50,  phosphorus: 34, potassium: 188, ph: 6.7 },
  { id: 'SOIL-010', lat: 36.7892, lng: -119.4132, x: 0.83, y: 0.36, moisture: 53, nitrogen: 48,  phosphorus: 32, potassium: 183, ph: 6.8 },
  { id: 'SOIL-011', lat: 36.7883, lng: -119.4180, x: 0.17, y: 0.64, moisture: 54, nitrogen: 31,  phosphorus: 21, potassium: 162, ph: 6.4 },
  { id: 'SOIL-012', lat: 36.7882, lng: -119.4167, x: 0.34, y: 0.62, moisture: 59, nitrogen: 39,  phosphorus: 25, potassium: 172, ph: 6.5 },
  { id: 'SOIL-013', lat: 36.7883, lng: -119.4155, x: 0.49, y: 0.63, moisture: 63, nitrogen: 48,  phosphorus: 31, potassium: 185, ph: 6.6 },
  { id: 'SOIL-014', lat: 36.7881, lng: -119.4144, x: 0.66, y: 0.64, moisture: 41, nitrogen: 52,  phosphorus: 36, potassium: 195, ph: 7.1 },
  { id: 'SOIL-015', lat: 36.7882, lng: -119.4133, x: 0.82, y: 0.62, moisture: 28, nitrogen: 45,  phosphorus: 30, potassium: 178, ph: 7.3 },
  { id: 'SOIL-016', lat: 36.7872, lng: -119.4181, x: 0.19, y: 0.86, moisture: 55, nitrogen: 37,  phosphorus: 24, potassium: 170, ph: 6.5 },
  { id: 'SOIL-017', lat: 36.7871, lng: -119.4169, x: 0.33, y: 0.88, moisture: 57, nitrogen: 44,  phosphorus: 29, potassium: 180, ph: 6.6 },
  { id: 'SOIL-018', lat: 36.7872, lng: -119.4156, x: 0.50, y: 0.87, moisture: 44, nitrogen: 50,  phosphorus: 33, potassium: 190, ph: 6.8 },
  { id: 'SOIL-019', lat: 36.7870, lng: -119.4145, x: 0.67, y: 0.86, moisture: 22, nitrogen: 53,  phosphorus: 35, potassium: 200, ph: 7.2 },
  { id: 'SOIL-020', lat: 36.7871, lng: -119.4132, x: 0.82, y: 0.88, moisture: 17, nitrogen: 49,  phosphorus: 31, potassium: 185, ph: 7.5 },
];

// ─── 2. Agent Logs ────────────────────────────────────────────────────────────
const agentLogs = [
  { time: '09:38', message: 'sent drone #33 to spray pesticides to 36.7893, -119.4145 due to high pest spotting',         ts: Timestamp.fromDate(new Date('2026-05-31T09:38:00Z')) },
  { time: '09:35', message: 'sent drone #21 to spread fertilizer to 36.7905, -119.4181 due to sensors showing low nutrient levels', ts: Timestamp.fromDate(new Date('2026-05-31T09:35:00Z')) },
  { time: '09:28', message: 'activated sprinkler in 36.7870, -119.4145 due to low moisture levels in soil',                ts: Timestamp.fromDate(new Date('2026-05-31T09:28:00Z')) },
  { time: '09:22', message: 'sent drone #17 to spread fertilizer to 36.7903, -119.4167 due to sensors showing low nutrient levels', ts: Timestamp.fromDate(new Date('2026-05-31T09:22:00Z')) },
  { time: '09:15', message: 'activated sprinkler in 36.7871, -119.4132 due to low moisture levels in soil',                ts: Timestamp.fromDate(new Date('2026-05-31T09:15:00Z')) },
];

// ─── 3. Ambient Conditions ────────────────────────────────────────────────────
const ambientConditions = {
  temperature: 24.2,
  humidity: 55,
  uvIndex: 7.2,
  solarRadiation: 850,
  updatedAt: Timestamp.now(),
};

// ─── 4. Forecast ──────────────────────────────────────────────────────────────
const forecast = {
  past: [
    { day: 'May 26', icon: '☀️',  temp: 22 },
    { day: 'May 27', icon: '⛅', temp: 19 },
    { day: 'May 28', icon: '🌧️', temp: 18 },
    { day: 'May 29', icon: '☁️',  temp: 21 },
  ],
  future: [
    { day: 'Today',    icon: '☀️',  tempHigh: 24, tempLow: 16 },
    { day: 'Tomorrow', icon: '⛅', tempHigh: 22, tempLow: 15 },
    { day: 'Jun 1',    icon: '🌧️', tempHigh: 20, tempLow: 12 },
    { day: 'Jun 2',    icon: '☁️',  tempHigh: 19, tempLow: 14 },
    { day: 'Jun 3',    icon: '☀️',  tempHigh: 21, tempLow: 13 },
  ],
  updatedAt: Timestamp.now(),
};

// ─── 5. Problems (infrastructure issues) ─────────────────────────────────────
const problems = [
  { id: 'weed-1',      type: 'weed',      label: 'Pigweed cluster',    severity: 'high',   position: [-1.2, 0.1, -0.8],  color: '#ff4444', detailCount: 3, badge: 'W' },
  { id: 'pest-1',      type: 'pest',      label: 'Aphid infestation',  severity: 'medium', position: [0.8,  0.1,  1.1],  color: '#ff8800', detailCount: 2, badge: 'P' },
  { id: 'issue-irr',   type: 'issue',     label: 'Irrigation deficit', severity: 'critical', description: 'Bottom-right zone: moisture 18–27% — below 35%' },
  { id: 'issue-npk',   type: 'issue',     label: 'NPK deficiency',     severity: 'warning',  description: 'Top-left zone: N/P/K critically low — fertilization needed' },
];

// ─── 6. Weed Database ─────────────────────────────────────────────────────────
const weeds = [
  {
    id: 'pigweed',
    name: 'Amaranthus retroflexus (Redroot Pigweed)',
    priority: 'High',
    sector: '4A',
    description: 'A summer annual broadleaf weed that grows rapidly and competes aggressively with crops for nutrients and water. Recognized by its distinctive red/purple root system and ability to produce thousands of seeds.',
    characteristics: ['Grows 3-6 feet tall', 'Deep red/purple root system', 'Small flowers in terminal spikes', 'Produces thousands of seeds', 'Highly variable leaf size'],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amaranthus_retroflexus_-_Redroot_Pigweed.jpg/600px-Amaranthus_retroflexus_-_Redroot_Pigweed.jpg',
    fallbackEmoji: '🌱',
    impact: 'Can reduce crop yields by 10-40% if left uncontrolled',
    season: 'Late Spring to Fall',
  },
  {
    id: 'crabgrass',
    name: 'Digitaria sanguinalis (Large Crabgrass)',
    priority: 'Medium',
    sector: '2B',
    description: 'A summer annual grass weed that germinates when soil temperatures reach 55-60°F. Spreads via stolons and root nodes, forming distinctive circular mats. Very competitive with young crops.',
    characteristics: ['Grows in circular mats', 'Star-like seed head with 3-6 spikes', 'Yellow-green foliage', 'Root nodes that initiate new plants', 'Faster growing than corn'],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Digitaria_sanguinalis_-_Crabgrass.jpg/600px-Digitaria_sanguinalis_-_Crabgrass.jpg',
    fallbackEmoji: '🌾',
    impact: 'Competes heavily during early crop growth stages',
    season: 'Spring to Summer',
  },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  const batch = db.batch();

  // Soil sensors — one doc per sensor, doc ID = sensor ID
  for (const sensor of soilSensors) {
    batch.set(db.collection('soilSensors').doc(sensor.id), sensor);
  }

  // Agent logs — one doc per entry, ordered by ts
  for (const log of agentLogs) {
    batch.set(db.collection('agentLogs').doc(), log);
  }

  // Ambient conditions — single doc
  batch.set(db.collection('config').doc('ambientConditions'), ambientConditions);

  // Forecast — single doc
  batch.set(db.collection('config').doc('forecast'), forecast);

  // Problems
  for (const problem of problems) {
    batch.set(db.collection('problems').doc(problem.id), problem);
  }

  // Weed database
  for (const weed of weeds) {
    batch.set(db.collection('weeds').doc(weed.id), weed);
  }

  await batch.commit();
  console.log('✅ Firestore seeded successfully');
  console.log('   Collections written: soilSensors, agentLogs, config, problems, weeds');
  console.log('   You can now delete the firebase-migration/ folder.');
}

seed().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
