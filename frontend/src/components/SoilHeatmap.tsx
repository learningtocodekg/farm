import { useEffect, useRef, useState } from 'react';

export type HeatmapLayer = 'moisture' | 'nitrogen' | 'phosphorus' | 'potassium' | 'ph';

export interface SoilSensor {
  id: string;
  row: number;   // 0-7 (top to bottom)
  col: number;   // 0-4 (left to right)
  lat: number;
  lng: number;
  moisture: number;    // % (0-100)
  nitrogen: number;    // normalized 0-100
  phosphorus: number;  // normalized 0-100
  potassium: number;   // normalized 0-100
  ph: number;          // actual pH
}

// 40 sensors on an 8×5 grid spanning a ~800m × 1000m precision farm
// Top-left needs fertilizer (low N, P, K, slightly acidic)
// Bottom-right needs irrigation (critically low moisture)
// Center is optimal
export const SOIL_SENSORS: SoilSensor[] = [
  // Row 0 (top – fertilizer deficient on left)
  { id: 'S01', row: 0, col: 0, lat: 36.7904, lng: -119.4180, moisture: 57, nitrogen: 19, phosphorus: 14, potassium: 21, ph: 5.4 },
  { id: 'S02', row: 0, col: 1, lat: 36.7904, lng: -119.4155, moisture: 61, nitrogen: 22, phosphorus: 17, potassium: 25, ph: 5.6 },
  { id: 'S03', row: 0, col: 2, lat: 36.7904, lng: -119.4130, moisture: 65, nitrogen: 48, phosphorus: 38, potassium: 52, ph: 6.1 },
  { id: 'S04', row: 0, col: 3, lat: 36.7904, lng: -119.4105, moisture: 68, nitrogen: 72, phosphorus: 63, potassium: 70, ph: 6.4 },
  { id: 'S05', row: 0, col: 4, lat: 36.7904, lng: -119.4080, moisture: 64, nitrogen: 70, phosphorus: 61, potassium: 67, ph: 6.5 },
  // Row 1
  { id: 'S06', row: 1, col: 0, lat: 36.7892, lng: -119.4180, moisture: 59, nitrogen: 21, phosphorus: 16, potassium: 23, ph: 5.5 },
  { id: 'S07', row: 1, col: 1, lat: 36.7892, lng: -119.4155, moisture: 63, nitrogen: 28, phosphorus: 23, potassium: 30, ph: 5.8 },
  { id: 'S08', row: 1, col: 2, lat: 36.7892, lng: -119.4130, moisture: 67, nitrogen: 55, phosphorus: 45, potassium: 58, ph: 6.2 },
  { id: 'S09', row: 1, col: 3, lat: 36.7892, lng: -119.4105, moisture: 70, nitrogen: 75, phosphorus: 65, potassium: 73, ph: 6.5 },
  { id: 'S10', row: 1, col: 4, lat: 36.7892, lng: -119.4080, moisture: 66, nitrogen: 73, phosphorus: 63, potassium: 69, ph: 6.6 },
  // Row 2
  { id: 'S11', row: 2, col: 0, lat: 36.7880, lng: -119.4180, moisture: 62, nitrogen: 25, phosphorus: 20, potassium: 28, ph: 5.7 },
  { id: 'S12', row: 2, col: 1, lat: 36.7880, lng: -119.4155, moisture: 66, nitrogen: 40, phosphorus: 35, potassium: 45, ph: 6.0 },
  { id: 'S13', row: 2, col: 2, lat: 36.7880, lng: -119.4130, moisture: 71, nitrogen: 70, phosphorus: 62, potassium: 68, ph: 6.4 },
  { id: 'S14', row: 2, col: 3, lat: 36.7880, lng: -119.4105, moisture: 73, nitrogen: 80, phosphorus: 70, potassium: 76, ph: 6.4 },
  { id: 'S15', row: 2, col: 4, lat: 36.7880, lng: -119.4080, moisture: 65, nitrogen: 75, phosphorus: 65, potassium: 70, ph: 6.6 },
  // Row 3 (center – peak values)
  { id: 'S16', row: 3, col: 0, lat: 36.7868, lng: -119.4180, moisture: 64, nitrogen: 35, phosphorus: 30, potassium: 40, ph: 5.9 },
  { id: 'S17', row: 3, col: 1, lat: 36.7868, lng: -119.4155, moisture: 69, nitrogen: 62, phosphorus: 55, potassium: 65, ph: 6.2 },
  { id: 'S18', row: 3, col: 2, lat: 36.7868, lng: -119.4130, moisture: 75, nitrogen: 85, phosphorus: 74, potassium: 80, ph: 6.5 },
  { id: 'S19', row: 3, col: 3, lat: 36.7868, lng: -119.4105, moisture: 73, nitrogen: 82, phosphorus: 72, potassium: 78, ph: 6.5 },
  { id: 'S20', row: 3, col: 4, lat: 36.7868, lng: -119.4080, moisture: 60, nitrogen: 76, phosphorus: 66, potassium: 71, ph: 6.7 },
  // Row 4
  { id: 'S21', row: 4, col: 0, lat: 36.7856, lng: -119.4180, moisture: 68, nitrogen: 55, phosphorus: 48, potassium: 60, ph: 6.1 },
  { id: 'S22', row: 4, col: 1, lat: 36.7856, lng: -119.4155, moisture: 71, nitrogen: 72, phosphorus: 63, potassium: 70, ph: 6.3 },
  { id: 'S23', row: 4, col: 2, lat: 36.7856, lng: -119.4130, moisture: 72, nitrogen: 80, phosphorus: 70, potassium: 76, ph: 6.4 },
  { id: 'S24', row: 4, col: 3, lat: 36.7856, lng: -119.4105, moisture: 52, nitrogen: 72, phosphorus: 62, potassium: 60, ph: 6.8 },
  { id: 'S25', row: 4, col: 4, lat: 36.7856, lng: -119.4080, moisture: 38, nitrogen: 63, phosphorus: 55, potassium: 45, ph: 6.9 },
  // Row 5 (bottom-right going dry)
  { id: 'S26', row: 5, col: 0, lat: 36.7844, lng: -119.4180, moisture: 69, nitrogen: 62, phosphorus: 55, potassium: 64, ph: 6.2 },
  { id: 'S27', row: 5, col: 1, lat: 36.7844, lng: -119.4155, moisture: 70, nitrogen: 74, phosphorus: 64, potassium: 70, ph: 6.3 },
  { id: 'S28', row: 5, col: 2, lat: 36.7844, lng: -119.4130, moisture: 66, nitrogen: 76, phosphorus: 67, potassium: 72, ph: 6.5 },
  { id: 'S29', row: 5, col: 3, lat: 36.7844, lng: -119.4105, moisture: 34, nitrogen: 63, phosphorus: 56, potassium: 50, ph: 7.0 },
  { id: 'S30', row: 5, col: 4, lat: 36.7844, lng: -119.4080, moisture: 25, nitrogen: 57, phosphorus: 50, potassium: 40, ph: 7.1 },
  // Row 6
  { id: 'S31', row: 6, col: 0, lat: 36.7832, lng: -119.4180, moisture: 65, nitrogen: 60, phosphorus: 53, potassium: 62, ph: 6.3 },
  { id: 'S32', row: 6, col: 1, lat: 36.7832, lng: -119.4155, moisture: 67, nitrogen: 68, phosphorus: 59, potassium: 66, ph: 6.4 },
  { id: 'S33', row: 6, col: 2, lat: 36.7832, lng: -119.4130, moisture: 56, nitrogen: 71, phosphorus: 62, potassium: 68, ph: 6.6 },
  { id: 'S34', row: 6, col: 3, lat: 36.7832, lng: -119.4105, moisture: 27, nitrogen: 58, phosphorus: 51, potassium: 44, ph: 7.0 },
  { id: 'S35', row: 6, col: 4, lat: 36.7832, lng: -119.4080, moisture: 21, nitrogen: 53, phosphorus: 46, potassium: 36, ph: 7.2 },
  // Row 7 (bottom – critical drought zone on right)
  { id: 'S36', row: 7, col: 0, lat: 36.7820, lng: -119.4180, moisture: 63, nitrogen: 58, phosphorus: 51, potassium: 60, ph: 6.3 },
  { id: 'S37', row: 7, col: 1, lat: 36.7820, lng: -119.4155, moisture: 64, nitrogen: 65, phosphorus: 57, potassium: 63, ph: 6.4 },
  { id: 'S38', row: 7, col: 2, lat: 36.7820, lng: -119.4130, moisture: 46, nitrogen: 66, phosphorus: 58, potassium: 64, ph: 6.7 },
  { id: 'S39', row: 7, col: 3, lat: 36.7820, lng: -119.4105, moisture: 23, nitrogen: 55, phosphorus: 48, potassium: 38, ph: 7.1 },
  { id: 'S40', row: 7, col: 4, lat: 36.7820, lng: -119.4080, moisture: 18, nitrogen: 50, phosphorus: 43, potassium: 30, ph: 7.3 },
];

// ── Color mapping ─────────────────────────────────────────────────────────────

type RGB = [number, number, number];
type ColorStop = { stop: number; rgb: RGB };

export const COLOR_SCALES: Record<HeatmapLayer, ColorStop[]> = {
  moisture: [
    { stop: 0,   rgb: [180, 14, 14] },
    { stop: 25,  rgb: [220, 50, 20] },
    { stop: 40,  rgb: [249, 115, 22] },
    { stop: 55,  rgb: [234, 179, 8] },
    { stop: 65,  rgb: [34, 197, 94] },
    { stop: 80,  rgb: [16, 185, 129] },
    { stop: 100, rgb: [59, 130, 246] },
  ],
  nitrogen: [
    { stop: 0,   rgb: [180, 14, 14] },
    { stop: 25,  rgb: [249, 115, 22] },
    { stop: 45,  rgb: [234, 179, 8] },
    { stop: 65,  rgb: [34, 197, 94] },
    { stop: 80,  rgb: [16, 185, 129] },
    { stop: 100, rgb: [6, 148, 162] },
  ],
  phosphorus: [
    { stop: 0,   rgb: [180, 14, 14] },
    { stop: 20,  rgb: [249, 115, 22] },
    { stop: 40,  rgb: [234, 179, 8] },
    { stop: 60,  rgb: [34, 197, 94] },
    { stop: 80,  rgb: [16, 185, 129] },
    { stop: 100, rgb: [99, 102, 241] },
  ],
  potassium: [
    { stop: 0,   rgb: [180, 14, 14] },
    { stop: 25,  rgb: [249, 115, 22] },
    { stop: 45,  rgb: [234, 179, 8] },
    { stop: 65,  rgb: [34, 197, 94] },
    { stop: 80,  rgb: [16, 185, 129] },
    { stop: 100, rgb: [6, 148, 162] },
  ],
  ph: [
    { stop: 4.5, rgb: [180, 14, 14] },
    { stop: 5.5, rgb: [249, 115, 22] },
    { stop: 6.0, rgb: [234, 179, 8] },
    { stop: 6.5, rgb: [34, 197, 94] },
    { stop: 7.0, rgb: [234, 179, 8] },
    { stop: 7.5, rgb: [249, 115, 22] },
    { stop: 8.5, rgb: [147, 51, 234] },
  ],
};

export const LAYER_GRADIENTS: Record<HeatmapLayer, string> = {
  moisture:   'linear-gradient(to right, #b40e0e, #f97316, #eab308, #22c55e, #10b981, #3b82f6)',
  nitrogen:   'linear-gradient(to right, #b40e0e, #f97316, #eab308, #22c55e, #10b981, #0694a2)',
  phosphorus: 'linear-gradient(to right, #b40e0e, #f97316, #eab308, #22c55e, #10b981, #6366f1)',
  potassium:  'linear-gradient(to right, #b40e0e, #f97316, #eab308, #22c55e, #10b981, #0694a2)',
  ph:         'linear-gradient(to right, #b40e0e, #f97316, #eab308, #22c55e, #eab308, #f97316, #9333ea)',
};

export const LAYER_RANGES: Record<HeatmapLayer, { min: string; max: string; unit: string }> = {
  moisture:   { min: 'Dry',     max: 'Saturated', unit: '%' },
  nitrogen:   { min: 'Deficient', max: 'Excess',  unit: '/100' },
  phosphorus: { min: 'Deficient', max: 'Excess',  unit: '/100' },
  potassium:  { min: 'Deficient', max: 'Excess',  unit: '/100' },
  ph:         { min: 'Acidic',  max: 'Alkaline',  unit: '' },
};

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function mapColor(value: number, stops: ColorStop[]): RGB {
  if (value <= stops[0].stop) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (value >= last.stop) return last.rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].stop && value <= stops[i + 1].stop) {
      const t = (value - stops[i].stop) / (stops[i + 1].stop - stops[i].stop);
      return lerpRGB(stops[i].rgb, stops[i + 1].rgb, t);
    }
  }
  return last.rgb;
}

export function getSensorValue(sensor: SoilSensor, layer: HeatmapLayer): number {
  switch (layer) {
    case 'moisture':   return sensor.moisture;
    case 'nitrogen':   return sensor.nitrogen;
    case 'phosphorus': return sensor.phosphorus;
    case 'potassium':  return sensor.potassium;
    case 'ph':         return sensor.ph;
  }
}

// IDW (Inverse Distance Weighting) heatmap render into canvas pixels
function renderHeatmap(canvas: HTMLCanvasElement, layer: HeatmapLayer) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;
  const scale = COLOR_SCALES[layer];
  const power = 2; // IDW power

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / (W - 1);
      const ny = py / (H - 1);
      let wSum = 0;
      let vSum = 0;
      for (const s of SOIL_SENSORS) {
        const sx = s.col / 4;
        const sy = s.row / 7;
        const dx = nx - sx;
        const dy = ny - sy;
        const dist2 = dx * dx + dy * dy;
        const w = 1 / Math.pow(dist2 + 1e-8, power / 2);
        wSum += w;
        vSum += w * getSensorValue(s, layer);
      }
      const [r, g, b] = mapColor(vSum / wSum, scale);
      const i = (py * W + px) * 4;
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 215;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── Sensor dot with hover tooltip ─────────────────────────────────────────────

interface SensorDotProps {
  sensor: SoilSensor;
  layer: HeatmapLayer;
}

function SensorDot({ sensor, layer }: SensorDotProps) {
  const [hovered, setHovered] = useState(false);
  const value = getSensorValue(sensor, layer);
  const [r, g, b] = mapColor(value, COLOR_SCALES[layer]);
  const color = `rgb(${r},${g},${b})`;
  const left = `${(sensor.col / 4) * 100}%`;
  const top  = `${(sensor.row / 7) * 100}%`;

  const formatVal = () => {
    if (layer === 'ph') return `pH ${value.toFixed(1)}`;
    if (layer === 'moisture') return `${value}% H₂O`;
    const label = layer.charAt(0).toUpperCase() + layer.slice(1);
    return `${label}: ${value}/100`;
  };

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
      style={{ left, top, zIndex: 3 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="rounded-full border-2 border-white/60 shadow-md transition-all duration-150 cursor-pointer"
        style={{
          width:           hovered ? 14 : 9,
          height:          hovered ? 14 : 9,
          backgroundColor: color,
          boxShadow:       `0 0 ${hovered ? 10 : 5}px ${color}`,
        }}
      />
      {hovered && (
        <div
          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-50"
          style={{ whiteSpace: 'nowrap' }}
        >
          <div className="px-3 py-2 rounded-xl bg-black/90 border border-white/20 shadow-xl text-xs">
            <div className="text-white/50 font-mono text-[10px] mb-1">
              {sensor.id} · {sensor.lat.toFixed(4)}°N {Math.abs(sensor.lng).toFixed(4)}°W
            </div>
            <div className="font-bold mb-1" style={{ color }}>{formatVal()}</div>
            <div className="text-white/55 text-[10px] space-y-0.5">
              <div>N: {sensor.nitrogen} · P: {sensor.phosphorus} · K: {sensor.potassium}</div>
              <div>Moisture: {sensor.moisture}% · pH: {sensor.ph}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  layer: HeatmapLayer;
}

export default function SoilHeatmap({ layer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderHeatmap(canvas, layer);
  }, [layer]);

  return (
    <div className="absolute inset-0" style={{ zIndex: 0 }}>
      <div className="absolute inset-0 bg-black" />
      <canvas
        ref={canvasRef}
        width={240}
        height={135}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <div className="absolute inset-0 bg-black/15 pointer-events-none" />
      {SOIL_SENSORS.map(sensor => (
        <SensorDot key={sensor.id} sensor={sensor} layer={layer} />
      ))}
    </div>
  );
}
