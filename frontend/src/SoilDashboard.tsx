import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Maximize2, Sun, Cloud, CloudRain, Calendar, Activity, LayoutDashboard } from 'lucide-react';
import SoilSensorOverlay from './components/SoilSensorOverlay';
import { HeatmapLayer } from './components/SoilHeatmap';
import soilData from './data/soilSensors.json';

// ── Design tokens (FarmOS palette) ───────────────────────────────────────────

const C = {
  primary:                '#000000',
  secondary:              '#536600',
  secondaryContainer:     '#c7ef00',
  onSecondaryContainer:   '#576a00',
  surface:                '#f9f9f9',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerHigh:   '#e8e8e8',
  onSurface:              '#1a1c1c',
  onSurfaceVariant:       '#4c4546',
  outline:                '#7e7576',
  outlineVariant:         '#cfc4c5',
};

const FONT = '"Hanken Grotesk", system-ui, sans-serif';

// ── Layer metadata ────────────────────────────────────────────────────────────

interface LayerMeta {
  label:    string;
  abbrev:   string;
  unit:     string;
  min:      number;
  max:      number;
}

const LAYER_META: Record<HeatmapLayer, LayerMeta> = {
  moisture:   { label: 'Moisture Index', abbrev: 'H₂O', unit: '%',  min: 0,   max: 100 },
  nitrogen:   { label: 'Nitrogen',       abbrev: 'N',   unit: 'ppm', min: 0,   max: 60  },
  phosphorus: { label: 'Phosphorus',     abbrev: 'P',   unit: 'ppm', min: 0,   max: 50  },
  potassium:  { label: 'Potassium',      abbrev: 'K',   unit: 'ppm', min: 100, max: 250 },
  ph:         { label: 'pH Level',       abbrev: 'pH',  unit: '',    min: 5.5, max: 8.0 },
};

const LAYERS: HeatmapLayer[] = ['moisture', 'nitrogen', 'phosphorus', 'potassium', 'ph'];

// ── Helpers ───────────────────────────────────────────────────────────────────

type SensorKey = 'moisture' | 'nitrogen' | 'phosphorus' | 'potassium' | 'ph';

function avgField(key: SensorKey): number {
  return soilData.sensors.reduce((s, x) => s + x[key], 0) / soilData.sensors.length;
}

function fmtVal(v: number, layer: HeatmapLayer): string {
  if (layer === 'ph') return v.toFixed(1);
  return Math.round(v).toString();
}

function progressPct(v: number, layer: HeatmapLayer): number {
  const { min, max } = LAYER_META[layer];
  return Math.max(2, Math.min(100, ((v - min) / (max - min)) * 100));
}

function layerDescription(layer: HeatmapLayer): string {
  const dryCount = soilData.sensors.filter(s => s.moisture < 30).length;
  const nLowCount = soilData.sensors.filter(s => s.nitrogen < 20).length;
  switch (layer) {
    case 'moisture':
      return dryCount > 3
        ? `${dryCount} sensors below 30% — irrigation recommended in SE quadrant.`
        : 'Moisture within optimal range. Irrigation paused.';
    case 'nitrogen':
      return nLowCount > 1
        ? `${nLowCount} sensors deficient (<20 ppm). Fertilization queued for NW zone.`
        : 'Nitrogen levels adequate across field.';
    case 'phosphorus':
      return 'Minor P deficiency in top-left zone. Monitor and apply if persistent.';
    case 'potassium':
      return 'Potassium uniform across field. Slight dip in NW corner.';
    case 'ph':
      return 'pH within acceptable range. SE corner trending alkaline — monitor.';
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Divider({ vertical = false }: { vertical?: boolean }) {
  return (
    <div style={{
      [vertical ? 'width' : 'height']: 1,
      [vertical ? 'height' : 'width']: '100%',
      background: C.outlineVariant,
      flexShrink: 0,
    }} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SoilDashboard() {
  const [layer, setLayer] = useState<HeatmapLayer>('moisture');

  const avgs: Record<HeatmapLayer, number> = {
    moisture:   avgField('moisture'),
    nitrogen:   avgField('nitrogen'),
    phosphorus: avgField('phosphorus'),
    potassium:  avgField('potassium'),
    ph:         avgField('ph'),
  };

  const activeMeta  = LAYER_META[layer];
  const activeAvg   = avgs[layer];
  const activeFmt   = fmtVal(activeAvg, layer);
  const activePct   = progressPct(activeAvg, layer);
  const activeDesc  = layerDescription(layer);

  return (
    <div
      data-ui="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: C.surface,
        overflowY: 'auto',
        zIndex: 50,
        fontFamily: FONT,
        color: C.primary,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ padding: '72px 64px 40px' }}>
        {/* Breadcrumb */}
        <nav style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: C.onSurfaceVariant,
              textDecoration: 'none',
            }}
          >
            <LayoutDashboard size={13} />
            OPERATIONS
          </Link>
          <span style={{ color: C.onSurfaceVariant, fontSize: 12 }}>/</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            SOIL ANALYSIS
          </span>
        </nav>

        {/* Title */}
        <h1 style={{
          fontSize: 80,
          lineHeight: '84px',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          textTransform: 'uppercase',
          margin: 0,
        }}>
          SOIL DASHBOARD
        </h1>
      </header>

      {/* ── 3-column grid ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '0 64px 64px',
        display: 'grid',
        gridTemplateColumns: '3fr 6fr 3fr',
        gap: 24,
        alignItems: 'stretch',
        minHeight: 0,
      }}>

        {/* ── LEFT: Soil Quality ─────────────────────────────────────────── */}
        <section
          style={{
            borderTop:    `1px solid ${C.primary}`,
            borderBottom: `1px solid ${C.outline}`,
            borderRight:  `1px solid ${C.outlineVariant}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
            paddingTop: 32,
            paddingRight: 24,
            paddingBottom: 32,
            position: 'relative',
          }}
        >
          {/* Section title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 32, fontWeight: 600, lineHeight: '36px', margin: 0, textTransform: 'uppercase' }}>
              Soil Quality
            </h3>
            <Activity size={18} style={{ color: C.secondary }} />
          </div>

          {/* Primary metric */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <span style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', color: C.onSurfaceVariant,
              }}>
                {activeMeta.label}
              </span>
              <span style={{ fontSize: 32, fontWeight: 600, lineHeight: 1 }}>
                {activeFmt}
                {activeMeta.unit && (
                  <span style={{ fontSize: 16, color: C.onSurfaceVariant }}>{activeMeta.unit}</span>
                )}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{
              width: '100%', height: 8,
              background: C.surfaceContainerHigh,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0,
                height: '100%',
                width: `${activePct}%`,
                background: C.secondaryContainer,
                borderRight: `1px solid ${C.primary}`,
                transition: 'width 0.3s ease',
              }} />
            </div>

            <p style={{ fontSize: 16, lineHeight: '24px', color: C.onSurfaceVariant, margin: 0, marginTop: 8 }}>
              {activeDesc}
            </p>
          </div>

          {/* Metric list — click to switch heatmap channel */}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
            {LAYERS.map((l, i) => {
              const meta    = LAYER_META[l];
              const avg     = avgs[l];
              const fmt     = fmtVal(avg, l);
              const isActive = l === layer;
              return (
                <button
                  key={l}
                  onClick={() => setLayer(l)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 0',
                    borderTop: `1px solid ${C.outlineVariant}`,
                    borderBottom: i === LAYERS.length - 1 ? `1px solid ${C.outlineVariant}` : 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    background: isActive ? 'rgba(199,239,0,0.08)' : 'transparent',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: isActive ? C.primary : C.onSurfaceVariant,
                  }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: isActive ? 600 : 400, color: C.primary }}>
                    {fmt}{' '}
                    <span style={{ fontSize: 14, color: C.onSurfaceVariant, fontWeight: 400 }}>
                      {meta.unit}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── CENTER: Field Map ───────────────────────────────────────────── */}
        <section style={{
          border: `1px solid ${C.outline}`,
          display: 'flex',
          flexDirection: 'column',
          background: C.surfaceContainerLowest,
          position: 'relative',
          minHeight: 560,
        }}>
          {/* Map header bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: `1px solid ${C.outline}`,
            background: C.surface,
            flexShrink: 0,
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              <span style={{
                width: 8, height: 8,
                background: C.secondaryContainer,
                borderRadius: '50%',
                display: 'inline-block',
                boxShadow: `0 0 0 2px ${C.secondary}`,
              }} />
              LIVE FEED: FIELD VNY-0031
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: C.onSurfaceVariant,
            }}>
              {LAYER_META[layer].label.toUpperCase()}
            </span>
            <button style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.onSurfaceVariant, display: 'flex', alignItems: 'center',
              padding: 4,
            }}>
              <Maximize2 size={16} />
            </button>
          </div>

          {/* Heatmap container — fills remaining height */}
          <div style={{ flex: 1, position: 'relative', padding: 8, background: C.surface, minHeight: 0 }}>
            <div style={{ position: 'absolute', inset: 8 }}>
              <SoilSensorOverlay layer={layer} onLayerChange={setLayer} />
            </div>

            {/* Bottom-left overlay: coordinates / sensor info */}
            <div style={{
              position: 'absolute',
              bottom: 24,
              left: 24,
              background: 'rgba(249,249,249,0.92)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${C.outline}`,
              padding: '10px 14px',
              pointerEvents: 'none',
              zIndex: 25,
            }}>
              <span style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', display: 'block', marginBottom: 2,
              }}>
                Sensor Grid
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: C.onSurfaceVariant }}>
                20 sensors · 36.7888°N, 119.4157°W
              </span>
            </div>
          </div>
        </section>

        {/* ── RIGHT: Ambient + Forecast ───────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Ambient Conditions */}
          <div style={{
            border: `1px solid ${C.outline}`,
            padding: 24,
            background: C.surfaceContainerLowest,
            position: 'relative',
          }}>
            {/* top accent line */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: C.primary }} />

            <h3 style={{
              fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase', color: C.onSurfaceVariant,
              margin: '0 0 24px 0',
            }}>
              Ambient Conditions
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 32 }}>
              {[
                { value: '24', unit: '°',    label: 'Temperature' },
                { value: '55', unit: '%',    label: 'Humidity' },
                { value: '7.2', unit: '',   label: 'UV Index' },
                { value: '850', unit: 'W/m²', label: 'Solar Rad' },
              ].map(({ value, unit, label }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em' }}>
                    {value}<span style={{ fontSize: 16 }}>{unit}</span>
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase', color: C.onSurfaceVariant, marginTop: 6,
                  }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 7-Day Forecast */}
          <div style={{
            border: `1px solid ${C.outline}`,
            background: C.surfaceContainerLowest,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            position: 'relative',
          }}>
            {/* left accent line */}
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 1, background: C.primary }} />

            {/* Forecast header */}
            <div style={{
              padding: '14px 24px',
              borderBottom: `1px solid ${C.outline}`,
              background: C.surface,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <h3 style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', margin: 0,
              }}>
                7-Day Forecast
              </h3>
              <Calendar size={16} style={{ color: C.onSurfaceVariant }} />
            </div>

            {/* Forecast rows */}
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 24px', overflowY: 'auto' }}>
              {[
                { day: 'TODAY', icon: <Sun size={18} style={{ color: C.secondary }} />,        high: 24, low: 16, today: true  },
                { day: 'THU',   icon: <Sun size={18} style={{ color: C.onSurfaceVariant }} />, high: 22, low: 15, today: false },
                { day: 'FRI',   icon: <Cloud size={18} style={{ color: C.onSurfaceVariant }} />, high: 19, low: 14, today: false },
                { day: 'SAT',   icon: <CloudRain size={18} style={{ color: C.primary }} />,    high: 18, low: 12, today: true  },
                { day: 'SUN',   icon: <Sun size={18} style={{ color: C.onSurfaceVariant }} />, high: 21, low: 13, today: false },
              ].map(({ day, icon, high, low, today }, i, arr) => (
                <div
                  key={day}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 0',
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.outlineVariant}` : 'none',
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase', width: 48,
                    color: today ? C.primary : C.onSurfaceVariant,
                  }}>
                    {day}
                  </span>
                  {icon}
                  <span style={{
                    fontSize: 16, textAlign: 'right', width: 64,
                    fontWeight: today ? 600 : 400,
                    color: today ? C.primary : C.onSurfaceVariant,
                  }}>
                    {high}° / {low}°
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
