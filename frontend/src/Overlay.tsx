import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Droplets, Thermometer, Wind, Sun,
  Beaker, CloudRain, ShieldAlert,
  Compass, Gauge, Scan, Sprout, FileText,
  Sparkles, Send, ChevronDown, ChevronUp
} from 'lucide-react';
import nitrogenHeatmap from './assets/images/nitrogen-heatmapp.jpeg';

type SplatStatus = 'loading' | 'loaded' | 'error';

export default function Overlay() {
  const [status, setStatus] = useState<SplatStatus>('loading');
  const [showWeedModal, setShowWeedModal] = useState(false);
  const [selectedWeed, setSelectedWeed] = useState<string | null>(null);

  useEffect(() => {
    const onLoaded = () => setStatus('loaded');
    const onError = () => setStatus('error');
    window.addEventListener('splat:loaded', onLoaded);
    window.addEventListener('splat:error', onError);
    return () => {
      window.removeEventListener('splat:loaded', onLoaded);
      window.removeEventListener('splat:error', onError);
    };
  }, []);


  const statusLabel = {
    loading: 'HarvestEye',
    loaded: 'HarvestEye',
    error: 'HarvestEye',
  }[status];

  const statusColor = {
    loading: 'text-amber-400',
    loaded: 'text-emerald-400',
    error: 'text-rose-400',
  }[status];

  const statusIcon = {
    loading: '⟳',
    loaded: '●',
    error: '⚠',
  }[status];

  // Weed problem points plotted on the heatmap (matches Weed Identification data)
  const weedPoints = [
    { id: 'pigweed', name: 'Pigweed', sector: '4A', priority: 'High', color: 'rgb(244, 63, 94)', left: '15%', top: '15%' },
    { id: 'crabgrass', name: 'Crabgrass', sector: '2B', priority: 'Medium', color: 'rgb(251, 191, 36)', left: '20%', top: '60%' },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden bg-black">
      {/* Nitrogen Heatmap Background Layer */}
      <div className="absolute inset-0 pointer-events-none" style={{
        zIndex: 0,
        backgroundImage: `url(${nitrogenHeatmap})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        filter: 'contrast(1.25) brightness(0.8)',
      }} />
      {/* Heatmap Intensity Zones (problem hot-spots) */}
      <div className="absolute inset-0 pointer-events-none" style={{
        zIndex: 0,
        background: `
          radial-gradient(circle at 42% 38%, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.25) 8%, rgba(251,146,60,0.15) 16%, transparent 26%),
          radial-gradient(circle at 63% 64%, rgba(251,191,36,0.5) 0%, rgba(251,191,36,0.22) 8%, rgba(234,179,8,0.12) 16%, transparent 26%)
        `,
        mixBlendMode: 'screen',
      }} />

      {/* Top Right Button */}
      <div className="relative z-10 flex justify-end items-start pointer-events-auto gap-6">
        <Link
          to="/3d-view"
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-500/25 border border-cyan-400/40 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/35 hover:border-cyan-300/60 hover:shadow-lg hover:shadow-cyan-500/20 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-cyan-400 focus:outline-none"
        >
          <Sun className="w-4 h-4" />
          3D View
        </Link>
      </div>

      {/* Main Dashboard Layout */}
      <div className="relative z-10 flex-1 flex justify-between items-start mt-6 w-full pointer-events-none px-6 overflow-hidden gap-6 pb-6">

        {/* Left Panel: Farm UI */}
        <div className="flex flex-col gap-4 w-[420px] pointer-events-auto h-full shrink-0">
          {/* Status Bar */}
          <div className="flex items-center gap-5 px-12 py-8 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/30 shadow-lg hover:border-white/40 transition-all duration-200 cursor-default w-[420px]">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-lg font-bold ${status === 'loaded' ? 'bg-emerald-400 text-black animate-none' : status === 'loading' ? 'bg-amber-400 text-black animate-pulse' : 'bg-rose-400 text-white animate-pulse'}`}>{statusIcon}</div>
            <span className={`text-4xl font-bold tracking-wide ${statusColor}`}>{statusLabel}</span>
          </div>

          {/* Cards Container */}
          <div className="flex flex-col gap-6 overflow-y-auto pr-2 pb-4 scroll-smooth flex-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {/* Comprehensive Report - FIRST CARD */}
          <DashboardCard title="Farm Report Summary" icon={<FileText className="w-5 h-5 text-blue-400" />}>
            <div className="space-y-3">
              {/* Health Score */}
              <div className="p-5 rounded-xl bg-blue-500/15 border border-blue-400/35">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-white/70 uppercase tracking-wider font-bold">Overall Health Score</span>
                  <span className="text-2xl font-bold text-blue-400">94/100</span>
                </div>
                <div className="h-3 w-full bg-black/60 rounded-full overflow-hidden border border-white/20">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '94%' }} />
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-400/35">
                  <p className="text-sm text-white/70 uppercase tracking-wider font-bold mb-2">Soil Health</p>
                  <p className="text-lg font-bold text-emerald-400">Excellent</p>
                </div>
                <div className="p-4 rounded-xl bg-orange-500/15 border border-orange-400/35">
                  <p className="text-sm text-white/70 uppercase tracking-wider font-bold mb-2">Growth Stage</p>
                  <p className="text-lg font-bold text-orange-400">Flowering</p>
                </div>
              </div>

              {/* Status Indicators */}
              <div className="space-y-3 pt-3 border-t border-white/8">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Active Threats</span>
                  <span className="font-bold text-rose-400">2</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Soil Moisture Avg</span>
                  <span className="font-bold text-blue-400">42%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Avg Temperature</span>
                  <span className="font-bold text-orange-400">75.6°F</span>
                </div>
              </div>

              {/* Last Updated */}
              <div className="text-xs text-white/50 text-center pt-2 border-t border-white/8">
                Last updated: {new Date().toLocaleString()}
              </div>
            </div>
          </DashboardCard>

          <DashboardCard title="Soil Health Analytics" icon={<Beaker className="w-5 h-5 text-emerald-400" />}>
            <MetricRow label="pH Level" value="6.5" unit="Optimal" icon={<Gauge className="w-4 h-4 text-emerald-400/70" />} progress={65} color="bg-emerald-500" />

            <div className="pt-4 border-t border-white/8">
              <span className="text-xs text-white/60 uppercase tracking-wider font-bold mb-3 block">NPK Composition</span>
              <div className="flex gap-3">
                <NPKBar label="N" value={72} color="bg-blue-400" />
                <NPKBar label="P" value={45} color="bg-purple-400" />
                <NPKBar label="K" value={60} color="bg-orange-400" />
              </div>
            </div>

            <div className="pt-4 border-t border-white/8 space-y-3">
              <MetricRow label="Soil Moisture" value="42" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400/70" />} progress={42} color="bg-blue-400" />
              <MetricRow label="Soil Temp" value="65.3" unit="°F" icon={<Thermometer className="w-4 h-4 text-orange-400/70" />} progress={60} color="bg-orange-400" />
            </div>
          </DashboardCard>

          <DashboardCard title="Weed Identification" icon={<Scan className="w-5 h-5 text-rose-400" />}>
            <div className="space-y-3">
              {/* Pigweed */}
              <div className="flex items-center justify-between p-5 rounded-xl bg-rose-500/15 border border-rose-400/35 shadow-sm hover:bg-rose-500/20 hover:border-rose-400/50 hover:scale-102 transition-all duration-200 group cursor-pointer" onClick={() => { setSelectedWeed('pigweed'); setShowWeedModal(true); }}>
                <div className="flex items-center gap-3 flex-1">
                  <div className="p-2.5 bg-rose-500/25 rounded-lg group-hover:bg-rose-500/35 transition-colors">
                    <ShieldAlert className="w-6 h-6 text-rose-400" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-white/95">Pigweed</h4>
                    <p className="text-sm text-rose-300/80 font-medium">Sector 4A • High Priority</p>
                  </div>
                </div>
              </div>

              {/* Crabgrass */}
              <div className="flex items-center justify-between p-5 rounded-xl bg-amber-500/15 border border-amber-400/35 shadow-sm hover:bg-amber-500/20 hover:border-amber-400/50 hover:scale-102 transition-all duration-200 group cursor-pointer" onClick={() => { setSelectedWeed('crabgrass'); setShowWeedModal(true); }}>
                <div className="flex items-center gap-3 flex-1">
                  <div className="p-2.5 bg-amber-500/25 rounded-lg group-hover:bg-amber-500/35 transition-colors">
                    <ShieldAlert className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-white/95">Crabgrass</h4>
                    <p className="text-sm text-amber-300/80 font-medium">Sector 2B • Medium Priority</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs pt-3 border-t border-white/8">
              <span className="text-white/70 font-medium">Total Threats</span>
              <span className="text-white/90 font-bold tabular-nums">2 Active</span>
            </div>
          </DashboardCard>

          {/* Environmental Sensors */}

          <DashboardCard title="Conditions" icon={<Sun className="w-5 h-5 text-amber-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <SensorBlock label="Temperature" value="75.6" unit="°F" icon={<Thermometer className="w-4 h-4 text-orange-400" />} />
              <SensorBlock label="Humidity" value="55" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400" />} />
              <SensorBlock label="UV Index" value="7.2" unit="High" icon={<Sun className="w-4 h-4 text-amber-400" />} />
              <SensorBlock label="Solar Rad." value="850" unit="W/m²" icon={<Sprout className="w-4 h-4 text-yellow-400" />} />
            </div>
            <WeatherForecast type="temperature" />
          </DashboardCard>

          <DashboardCard title="Meteorological" icon={<Wind className="w-5 h-5 text-cyan-400" />}>
            <div className="flex items-center justify-between p-4 rounded-xl bg-black/40 border border-white/15 hover:border-white/25 hover:scale-102 transition-all duration-200 shadow-sm cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/20 rounded-lg">
                  <Compass className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-xs text-white/70 uppercase tracking-wider font-bold">Wind</h4>
                  <p className="text-base font-bold text-white/95">12 km/h <span className="text-cyan-400 text-xs ml-2 font-semibold">NW</span></p>
                </div>
              </div>
              <div className="text-right">
                <h4 className="text-xs text-white/70 uppercase tracking-wider font-bold">Drone Flight</h4>
                <p className="text-xs font-bold text-emerald-400 uppercase">●</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4 mb-6">
              <SensorBlock label="Barometric" value="1012" unit="hPa" icon={<Gauge className="w-4 h-4 text-indigo-400" />} />
              <SensorBlock label="Precipitation" value="0.0" unit="mm" icon={<CloudRain className="w-4 h-4 text-blue-300" />} />
            </div>
            <WeatherForecast type="precipitation" />
          </DashboardCard>

          </div>
        </div>

        {/* Center: Heatmap Problem Markers */}
        <div className="flex-1 relative h-full pointer-events-none">
          {weedPoints.map((point) => (
            <button
              key={point.id}
              onClick={() => { setSelectedWeed(point.id); setShowWeedModal(true); }}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto group focus:outline-none"
              style={{ left: point.left, top: point.top }}
              title={`${point.name} • Sector ${point.sector}`}
            >
              {/* Pulsing ring */}
              <span
                className="absolute inset-0 m-auto w-10 h-10 rounded-full animate-ping opacity-60"
                style={{ backgroundColor: point.color }}
              />
              {/* Core dot */}
              <span
                className="relative block w-5 h-5 rounded-full border-2 border-white shadow-lg transition-transform duration-200 group-hover:scale-125"
                style={{
                  backgroundColor: point.color,
                  boxShadow: `0 0 12px ${point.color}, 0 0 24px ${point.color}`,
                }}
              />
              {/* Label */}
              <span className="absolute left-1/2 -translate-x-1/2 top-7 whitespace-nowrap px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/20 text-xs font-bold text-white/95 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {point.name}
                <span className="ml-1.5 text-white/60 font-medium">Sector {point.sector}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Right Panel: Gemini Chatbot */}
        <div className="w-[420px] h-full pointer-events-auto shrink-0 flex flex-col">
          <GeminiChatbot />
        </div>
      </div>

      {/* Weed Info Modal */}
      {showWeedModal && (
        <WeedInfoModal
          weedType={selectedWeed}
          onClose={() => {
            setShowWeedModal(false);
            setSelectedWeed(null);
          }}
        />
      )}
    </div>
  );
}

// --- Subcomponents ---

function DashboardCard({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="rounded-2xl bg-black/50 backdrop-blur-xl border border-white/30 p-8 shadow-lg transition-all duration-300 hover:bg-black/60 hover:border-white/40 hover:shadow-xl hover:shadow-emerald-500/10 hover:scale-101 focus-within:ring-2 focus-within:ring-emerald-500/30">
      <div
        className={`flex items-center justify-between gap-3 ${isExpanded ? 'mb-6 pb-4 border-b border-white/8' : ''} cursor-pointer select-none`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-white/8 border border-white/10 shadow-sm">
            {icon}
          </div>
          <h3 className="text-base font-bold text-white/95 tracking-wide uppercase">{title}</h3>
        </div>
        <button className="text-white/50 hover:text-white/90 transition-colors p-1 rounded-md hover:bg-white/10">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>
      {isExpanded && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value, unit, icon, progress, color }: any) {
  return (
    <div className="pb-4 last:pb-0">
      <div className="flex justify-between items-end mb-3 gap-2">
        <div className="flex items-center gap-2 text-sm text-white/75 font-medium">
          <span className="opacity-85">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold text-white/95">{value}</span>
          <span className="text-sm text-white/65 font-medium">{unit}</span>
        </div>
      </div>
      <div className="h-3 w-full bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/20">
        <div className={`h-full ${color} rounded-full transition-all duration-300 ease-out shadow-lg`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function NPKBar({ label, value, color }: any) {
  return (
    <div className="flex-1 bg-black/40 rounded-xl p-4 border border-white/30 flex flex-col items-center gap-3 hover:bg-black/50 hover:border-white/40 hover:scale-105 transition-all duration-200 shadow-sm cursor-pointer">
      <span className="text-sm font-bold text-white/90 uppercase tracking-wide">{label}</span>
      <div className="h-20 w-3 bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/20 flex flex-col justify-end">
        <div className={`w-full ${color} rounded-full transition-all duration-300 shadow-md`} style={{ height: `${value}%` }} />
      </div>
      <span className="text-base font-bold text-white/95 tabular-nums">{value}%</span>
    </div>
  );
}

function SensorBlock({ label, value, unit, icon }: any) {
  return (
    <div className="bg-black/40 p-5 rounded-xl border border-white/30 hover:border-white/40 hover:bg-black/50 hover:scale-105 transition-all duration-200 shadow-sm hover:shadow-md group cursor-pointer focus-within:ring-2 focus-within:ring-white/40">
      <div className="flex items-start gap-3 mb-3">
        <div className="opacity-80 group-hover:opacity-100 transition-opacity mt-0.5">
          {icon}
        </div>
        <span className="text-sm text-white/70 uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 pl-0.5">
        <span className="text-2xl font-bold text-white/95">{value}</span>
        <span className="text-sm text-white/65 font-medium">{unit}</span>
      </div>
    </div>
  );
}

function WeatherForecast({ type }: { type: 'temperature' | 'precipitation' }) {
  // Historical data (last 4 days) - Celsius to Fahrenheit, mm to inches
  const pastData = [
    { day: 'May 26', temp: 72, precip: 0.0, icon: '☀️' },
    { day: 'May 27', temp: 66, precip: 0.20, icon: '🌤️' },
    { day: 'May 28', temp: 64, precip: 0.47, icon: '🌧️' },
    { day: 'May 29', temp: 70, precip: 0.08, icon: '☁️' },
  ];

  // Future forecast (next 3 days) - Celsius to Fahrenheit, mm to inches
  const futureData = [
    { day: 'Today', temp: 75, precip: 0.0, icon: '☀️' },
    { day: 'Tomorrow', temp: 73, precip: 0.12, icon: '🌤️' },
    { day: 'Jun 1', temp: 68, precip: 0.31, icon: '🌧️' },
  ];

  if (type === 'temperature') {
    return (
      <div className="border-t border-white/8 pt-4">
        <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">7-Day Temperature Forecast</h4>
        <div className="space-y-2">
          <div className="text-xs text-white/60 font-semibold mb-2">← Past 4 Days</div>
          <div className="flex gap-2 mb-3">
            {pastData.map((d, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="text-lg mb-1">{d.icon}</div>
                <div className="text-xs text-white/70 font-medium">{d.day}</div>
                <div className="text-sm font-bold text-white/95">{d.temp}°</div>
              </div>
            ))}
          </div>
          <div className="h-px bg-white/10 my-2"></div>
          <div className="text-xs text-white/60 font-semibold mb-2">Next 3 Days →</div>
          <div className="flex gap-2">
            {futureData.map((d, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="text-lg mb-1">{d.icon}</div>
                <div className="text-xs text-white/70 font-medium">{d.day}</div>
                <div className="text-sm font-bold text-blue-400">{d.temp}°F</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-white/8 pt-4">
      <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">7-Day Precipitation Forecast</h4>
      <div className="space-y-2">
        <div className="text-xs text-white/60 font-semibold mb-2">← Past 4 Days</div>
        <div className="flex gap-2 mb-3">
          {pastData.map((d, i) => (
            <div key={i} className="flex-1">
              <div className="text-lg text-center mb-1">{d.icon}</div>
              <div className="text-xs text-white/70 text-center font-medium">{d.day}</div>
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/25 relative" style={{ minHeight: '3rem' }}>
                <div
                  className="bg-blue-400/70 w-3/4 rounded-t transition-all duration-300"
                  style={{ height: `${Math.max(d.precip * 30, 2)}px` }}
                ></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip.toFixed(2)}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip.toFixed(2)}"</div>
            </div>
          ))}
        </div>
        <div className="h-px bg-white/10 my-2"></div>
        <div className="text-xs text-white/60 font-semibold mb-2">Next 3 Days →</div>
        <div className="flex gap-2">
          {futureData.map((d, i) => (
            <div key={i} className="flex-1">
              <div className="text-lg text-center mb-1">{d.icon}</div>
              <div className="text-xs text-white/70 text-center font-medium">{d.day}</div>
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/25 relative" style={{ minHeight: '3rem' }}>
                <div
                  className="bg-blue-400/70 w-3/4 rounded-t transition-all duration-300"
                  style={{ height: `${Math.max(d.precip * 30, 2)}px` }}
                ></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip.toFixed(2)}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip.toFixed(2)}"</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeedInfoModal({ weedType, onClose }: { weedType: string | null; onClose: () => void }) {
  const weedDatabase: Record<string, any> = {
    pigweed: {
      name: 'Amaranthus retroflexus (Redroot Pigweed)',
      priority: 'High',
      sector: '4A',
      description: 'A summer annual broadleaf weed that grows rapidly and competes aggressively with crops for nutrients and water. Recognized by its distinctive red/purple root system and ability to produce thousands of seeds.',
      characteristics: [
        'Grows 3-6 feet tall',
        'Deep red/purple root system',
        'Small flowers in terminal spikes',
        'Produces thousands of seeds',
        'Highly variable leaf size',
      ],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amaranthus_retroflexus_-_Redroot_Pigweed.jpg/600px-Amaranthus_retroflexus_-_Redroot_Pigweed.jpg',
      fallbackEmoji: '🌱',
      impact: 'Can reduce crop yields by 10-40% if left uncontrolled',
      season: 'Late Spring to Fall',
    },
    crabgrass: {
      name: 'Digitaria sanguinalis (Large Crabgrass)',
      priority: 'Medium',
      sector: '2B',
      description: 'A summer annual grass weed that germinates when soil temperatures reach 55-60°F. Spreads via stolons and root nodes, forming distinctive circular mats. Very competitive with young crops.',
      characteristics: [
        'Grows in circular mats',
        'Star-like seed head with 3-6 spikes',
        'Yellow-green foliage',
        'Root nodes that initiate new plants',
        'Faster growing than corn',
      ],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Digitaria_sanguinalis_-_Crabgrass.jpg/600px-Digitaria_sanguinalis_-_Crabgrass.jpg',
      fallbackEmoji: '🌾',
      impact: 'Competes heavily during early crop growth stages',
      season: 'Spring to Summer',
    },
  };

  const weed = weedDatabase[weedType || 'pigweed'];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-50">
      <div className="bg-white/25 backdrop-blur-xl border border-white/40 rounded-3xl p-8 max-w-3xl w-full mx-4 shadow-2xl shadow-black/30">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-white/50 hover:text-white/80 text-2xl cursor-pointer transition-colors"
        >
          ✕
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-4xl">{weed.fallbackEmoji}</span>
            <div>
              <h2 className="text-2xl font-bold text-white/95">{weed.name}</h2>
              <p className="text-sm text-white/60">Sector {weed.sector} • {weed.priority} Priority</p>
            </div>
          </div>
        </div>

        {/* Image Section */}
        <div className="mb-6 rounded-2xl overflow-hidden border border-white/10 bg-black/40 h-64">
          <img
            src={weed.imageUrl}
            alt={weed.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        {/* Description */}
        <div className="mb-6 p-4 rounded-xl bg-white/15 border border-white/25">
          <p className="text-white/90 text-sm leading-relaxed">{weed.description}</p>
        </div>

        {/* Characteristics Grid */}
        <div className="mb-6">
          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">Key Characteristics</h3>
          <div className="grid grid-cols-2 gap-2">
            {weed.characteristics.map((char: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-white/15 border border-white/25">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span className="text-xs text-white/80">{char}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 rounded-xl bg-white/15 border border-white/25">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Impact</p>
            <p className="text-xs text-white/85">{weed.impact}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/15 border border-white/25">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Season</p>
            <p className="text-xs text-white/85">{weed.season}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/15 border border-white/25">
            <p className="text-xs text-white/60 uppercase tracking-wider font-bold mb-1">Status</p>
            <p className="text-xs text-rose-400 font-bold">Active Threat</p>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full px-4 py-3 rounded-xl bg-emerald-500/40 border border-emerald-400/50 text-emerald-300 font-bold hover:bg-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/20 transition-all duration-200 uppercase tracking-widest cursor-pointer"
        >
          Close & Review Treatments
        </button>
      </div>
    </div>
  );
}

function GeminiChatbot() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I am Gemini, your Farm AI Assistant. How can I help you manage your crops today?' }
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text: input }]);
    setInput('');
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', text: 'I am analyzing your request and cross-referencing with our agricultural database...' }]);
    }, 1000);
  };

  return (
    <div className="flex flex-col h-full rounded-2xl bg-black/40 backdrop-blur-xl border border-white/15 shadow-2xl shadow-black/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 border-b border-white/15 bg-black/40">
        <div className="p-3 rounded-lg bg-blue-500/20 border border-blue-400/30 shadow-inner">
          <Sparkles className="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white/95 tracking-wide uppercase flex items-center gap-2">
            Gemini AI <span className="px-2 py-1 rounded-md bg-blue-500/20 text-blue-300 text-xs font-bold">PRO</span>
          </h3>
          <p className="text-sm text-white/60">Farm Operations Assistant</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scroll-smooth" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-4 text-base leading-relaxed shadow-sm ${
              msg.role === 'user'
                ? 'bg-blue-500/20 border border-blue-400/30 text-white/95 rounded-tr-sm'
                : 'bg-white/10 border border-white/15 text-white/90 rounded-tl-sm'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-5 border-t border-white/15 bg-black/40">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask Gemini about your farm..."
            className="flex-1 bg-black/50 border border-white/15 rounded-xl px-5 py-4 text-base text-white/90 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/50 placeholder:text-white/40 transition-all shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={`p-4 rounded-xl border transition-all duration-200 focus:outline-none flex items-center justify-center shadow-md ${
              input.trim()
                ? 'bg-blue-500/25 border-blue-400/40 text-blue-400 hover:bg-blue-500/40 hover:border-blue-400/60 hover:scale-105 cursor-pointer hover:shadow-blue-500/20'
                : 'bg-black/40 border-white/10 text-white/20 cursor-not-allowed'
            }`}
          >
            <Send className="w-6 h-6 ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
