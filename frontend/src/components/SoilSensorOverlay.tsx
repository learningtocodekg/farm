import { useState, useRef, useEffect } from 'react';
import { HeatmapLayer } from './SoilHeatmap';
import { fetchSoilSensors, SoilSensor } from '../lib/db';
import aerialImage from '../assets/images/nitrogen-heatmapp.jpeg';

type RGB = [number, number, number];

interface ChannelConfig {
  label: string;
  unit: string;
  min: number;
  max: number;
}

const CHANNEL_CONFIG: Record<HeatmapLayer, ChannelConfig> = {
  moisture:   { label: 'Moisture',   unit: '%',  min: 0,   max: 100 },
  nitrogen:   { label: 'Nitrogen',   unit: 'ppm', min: 0,   max: 60  },
  phosphorus: { label: 'Phosphorus', unit: 'ppm', min: 0,   max: 50  },
  potassium:  { label: 'Potassium',  unit: 'ppm', min: 100, max: 250 },
  ph:         { label: 'pH',         unit: '',    min: 5.5, max: 8.0 },
};

const LAYERS: HeatmapLayer[] = ['moisture', 'nitrogen', 'phosphorus', 'potassium', 'ph'];

// Warm palette: dark purple → crimson → orange → light cream
const WARM_STOPS: Array<{ stop: number; rgb: RGB }> = [
  { stop: 0.00, rgb: [10,  3,  28] },
  { stop: 0.18, rgb: [90, 15,  90] },
  { stop: 0.38, rgb: [190, 30,  30] },
  { stop: 0.58, rgb: [235, 85,  15] },
  { stop: 0.78, rgb: [255, 165,  60] },
  { stop: 1.00, rgb: [255, 235, 190] },
];

const CANVAS_W = 128;
const CANVAS_H = 192;

// ── color helpers ─────────────────────────────────────────────────────────────

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function warmColor(value: number, layer: HeatmapLayer): RGB {
  const { min, max } = CHANNEL_CONFIG[layer];
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (t <= WARM_STOPS[0].stop) return WARM_STOPS[0].rgb;
  const last = WARM_STOPS[WARM_STOPS.length - 1];
  if (t >= last.stop) return last.rgb;
  for (let i = 0; i < WARM_STOPS.length - 1; i++) {
    if (t >= WARM_STOPS[i].stop && t <= WARM_STOPS[i + 1].stop) {
      const dt = (t - WARM_STOPS[i].stop) / (WARM_STOPS[i + 1].stop - WARM_STOPS[i].stop);
      return lerpRGB(WARM_STOPS[i].rgb, WARM_STOPS[i + 1].rgb, dt);
    }
  }
  return last.rgb;
}

function getSensorValue(s: SoilSensor, layer: HeatmapLayer): number {
  switch (layer) {
    case 'moisture':   return s.moisture;
    case 'nitrogen':   return s.nitrogen;
    case 'phosphorus': return s.phosphorus;
    case 'potassium':  return s.potassium;
    case 'ph':         return s.ph;
  }
}

// ── IDW heatmap renderer ──────────────────────────────────────────────────────

function drawHeatmap(canvas: HTMLCanvasElement, layer: HeatmapLayer, sensors: SoilSensor[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx || sensors.length === 0) return;
  const W = CANVAS_W, H = CANVAS_H;
  const imageData = ctx.createImageData(W, H);
  const d = imageData.data;

  for (let py = 0; py < H; py++) {
    const ny = py / H;
    for (let px = 0; px < W; px++) {
      const nx = px / W;
      let wSum = 0, vSum = 0;
      for (const s of sensors) {
        const dx = nx - s.x;
        const dy = ny - s.y;
        const w = 1 / (dx * dx + dy * dy + 1e-6);
        wSum += w;
        vSum += w * getSensorValue(s, layer);
      }
      const [r, g, b] = warmColor(vSum / wSum, layer);
      const i = (py * W + px) * 4;
      d[i]     = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 205;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── value formatter ───────────────────────────────────────────────────────────

function fmtValue(value: number, layer: HeatmapLayer): string {
  if (layer === 'ph')       return `pH ${value.toFixed(1)}`;
  if (layer === 'moisture') return `${value}%`;
  return `${value} ppm`;
}

// ── sensor popup ──────────────────────────────────────────────────────────────

function SensorPopup({
  sensor, layer, onClose,
}: {
  sensor: SoilSensor; layer: HeatmapLayer; onClose: () => void;
}) {
  const above = sensor.y > 0.70;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${sensor.x * 100}%`,
        top:  `${sensor.y * 100}%`,
        transform: above
          ? 'translate(-50%, calc(-100% - 12px))'
          : 'translate(-50%, 12px)',
        zIndex: 30,
        pointerEvents: 'auto',
        minWidth: 200,
      }}
    >
      <div style={{
        background: 'rgba(6, 6, 10, 0.96)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
        fontSize: 12,
      }}>
        {/* header */}
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.06em', fontSize: 13 }}>{sensor.id}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {sensor.lat.toFixed(4)}°N · {Math.abs(sensor.lng).toFixed(4)}°W
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 16, lineHeight: 1, padding: '2px 4px', marginTop: -2 }}
          >
            ×
          </button>
        </div>

        {/* active channel highlight */}
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {CHANNEL_CONFIG[layer].label}
            </span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#fff' }}>
              {fmtValue(getSensorValue(sensor, layer), layer)}
            </span>
          </div>
        </div>

        {/* all readings */}
        <div style={{ padding: '4px 12px 10px' }}>
          {LAYERS.map(l => (
            <div key={l} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '3px 6px',
              borderRadius: 5,
              background: l === layer ? 'rgba(255,255,255,0.06)' : 'transparent',
              marginBottom: 1,
            }}>
              <span style={{ fontSize: 11, color: l === layer ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.42)' }}>
                {CHANNEL_CONFIG[l].label}
              </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11, color: l === layer ? '#fff' : 'rgba(255,255,255,0.58)' }}>
                {fmtValue(getSensorValue(sensor, l), l)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── color legend ──────────────────────────────────────────────────────────────

function ColorLegend({ layer }: { layer: HeatmapLayer }) {
  const cfg = CHANNEL_CONFIG[layer];
  const gradientCss = WARM_STOPS.map(s =>
    `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]}) ${Math.round(s.stop * 100)}%`
  ).join(', ');

  const mid = (cfg.min + cfg.max) / 2;
  const fmtL = (v: number) => {
    if (layer === 'ph')       return `pH ${v.toFixed(1)}`;
    if (layer === 'moisture') return `${v}%`;
    return `${Math.round(v)} ppm`;
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: 12,
      right: 12,
      zIndex: 20,
      background: 'rgba(0,0,0,0.62)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8,
      padding: '7px 14px',
      minWidth: 180,
      pointerEvents: 'none',
    }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, textAlign: 'center' }}>
        {cfg.label}{cfg.unit ? ` (${cfg.unit})` : ''}
      </div>
      <div style={{ height: 8, borderRadius: 4, background: `linear-gradient(to right, ${gradientCss})` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)' }}>
        <span>{fmtL(cfg.min)}</span>
        <span>{fmtL(mid)}</span>
        <span>{fmtL(cfg.max)}</span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  layer: HeatmapLayer;
  onLayerChange: (l: HeatmapLayer) => void;
}

export default function SoilSensorOverlay({ layer, onLayerChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sensors, setSensors] = useState<SoilSensor[]>([]);
  const active = sensors.find(s => s.id === activeId) ?? null;

  useEffect(() => {
    fetchSoilSensors().then(setSensors);
  }, []);

  useEffect(() => {
    if (canvasRef.current) drawHeatmap(canvasRef.current, layer, sensors);
  }, [layer, sensors]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 10, isolation: 'isolate' }}>

      {/* Aerial image background */}
      <img
        src={aerialImage}
        alt=""
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', userSelect: 'none' }}
      />

      {/* IDW heatmap overlay */}
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0.68,
          imageRendering: 'auto',
          pointerEvents: 'none',
        }}
      />

      {/* Channel toggle bar */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 3,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: 4,
        zIndex: 20,
        pointerEvents: 'auto',
      }}>
        {LAYERS.map(l => (
          <button
            key={l}
            onClick={() => onLayerChange(l)}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              background: l === layer ? 'rgba(255,255,255,0.16)' : 'transparent',
              color: l === layer ? '#fff' : 'rgba(255,255,255,0.42)',
              transition: 'all 0.12s',
            }}
          >
            {CHANNEL_CONFIG[l].label}
          </button>
        ))}
      </div>

      {/* Sensor dots */}
      {sensors.map(s => (
        <button
          key={s.id}
          onClick={() => setActiveId(activeId === s.id ? null : s.id)}
          title={s.id}
          style={{
            position: 'absolute',
            left: `${s.x * 100}%`,
            top:  `${s.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            border: '1.5px solid rgba(255,255,255,0.85)',
            cursor: 'pointer',
            padding: 0,
            zIndex: 15,
            boxShadow: '0 1px 4px rgba(0,0,0,0.55)',
            pointerEvents: 'auto',
          }}
        />
      ))}

      {/* Sensor popup */}
      {active && (
        <SensorPopup
          sensor={active}
          layer={layer}
          onClose={() => setActiveId(null)}
        />
      )}

      {/* Color scale legend */}
      <ColorLegend layer={layer} />
    </div>
  );
}
