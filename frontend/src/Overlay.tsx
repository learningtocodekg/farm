import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Droplets, Thermometer, Wind, Sun, 
  Beaker, CloudRain, ShieldAlert,
  Compass, Gauge, Scan, Sprout, FileText
} from 'lucide-react';

type SplatStatus = 'loading' | 'loaded' | 'error';
type CameraMode = 'perspective' | 'topdown';

export default function Overlay() {
  const [status, setStatus] = useState<SplatStatus>('loading');
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective');
  const [showActionModal, setShowActionModal] = useState(false);
  const [selectedTreatment, setSelectedTreatment] = useState<string | null>(null);

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

  const toggleCamera = () => {
    const viewer = (window as any).gsplatViewer;
    if (!viewer?.controls) return;
    const next: CameraMode = cameraMode === 'perspective' ? 'topdown' : 'perspective';
    if (next === 'topdown') {
      viewer.controls.target.set(0, 0, 0);
      viewer.camera.position.set(0, -10, 0);
      viewer.camera.up.set(0, 0, 1);
    } else {
      viewer.camera.position.set(0, -1, 5);
      viewer.camera.up.set(0, -1, 0);
      viewer.controls.target.set(0, 0, 0);
    }
    viewer.controls.update();
    setCameraMode(next);
  };

  const statusLabel = {
    loading: 'Loading 3D Farm Data…',
    loaded: 'Farm Visualization Active',
    error: 'Sensors Offline',
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

  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">
      {/* Top HUD */}
      <div className="flex justify-between items-start pointer-events-auto gap-6">
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/15 shadow-xl shadow-black/30 hover:border-white/25 transition-all duration-200 cursor-default">
          <div className={`w-2.5 h-2.5 rounded-full flex items-center justify-center text-xs font-bold ${status === 'loaded' ? 'bg-emerald-400 text-black animate-none' : status === 'loading' ? 'bg-amber-400 text-black animate-pulse' : 'bg-rose-400 text-white animate-pulse'}`}>{statusIcon}</div>
          <span className={`text-xs font-semibold tracking-wider ${statusColor}`}>{statusLabel}</span>
          {status === 'loaded' && (
            <>
              <div className="w-px h-5 bg-white/20 mx-2" />
              <span className="text-white/65 text-xs font-mono uppercase tracking-widest font-medium">{cameraMode}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/report"
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/25 border border-emerald-400/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/35 hover:border-emerald-300/60 hover:shadow-lg hover:shadow-emerald-500/20 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          >
            <FileText className="w-4 h-4" />
            Full Report
          </Link>
          <button
            onClick={toggleCamera}
            className="px-5 py-3 rounded-xl bg-black/50 backdrop-blur-xl border border-white/15 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/15 hover:border-white/35 hover:shadow-lg hover:shadow-white/10 hover:scale-105 transition-all duration-200 shadow-md select-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-white/40 focus:outline-none"
          >
            {cameraMode === 'perspective' ? 'Top-Down View' : 'Perspective View'}
          </button>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="flex-1 flex justify-between items-start mt-6 w-full pointer-events-none px-6">

        {/* Left Panel: Soil Health & Weed ID */}
        <div className="w-[420px] flex flex-col gap-6 pointer-events-auto">
          
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
              <MetricRow label="Soil Temp" value="18.5" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400/70" />} progress={60} color="bg-orange-400" />
            </div>
          </DashboardCard>

          <DashboardCard title="Weed Identification" icon={<Scan className="w-5 h-5 text-rose-400" />}>
            <div className="flex items-center justify-between p-4 rounded-xl bg-rose-500/15 border border-rose-400/35 shadow-sm hover:bg-rose-500/20 hover:border-rose-400/50 hover:scale-102 transition-all duration-200 group cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-500/25 rounded-lg group-hover:bg-rose-500/35 transition-colors">
                  <ShieldAlert className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white/95">Pigweed Detected</h4>
                  <p className="text-xs text-rose-300/80 font-medium">Sector 4A • High Priority</p>
                </div>
              </div>
              <button onClick={() => setShowActionModal(true)} className="px-3 py-2 rounded-lg bg-rose-500/30 text-rose-300 text-xs font-bold hover:bg-rose-500/45 hover:shadow-md hover:shadow-rose-500/20 hover:scale-105 transition-all duration-200 uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-rose-400 focus:outline-none">
                Action
              </button>
            </div>
            <div className="flex items-center justify-between text-xs pt-3 border-t border-white/8">
              <span className="text-white/70 font-medium">Total Threats</span>
              <span className="text-white/90 font-bold tabular-nums">3 Active</span>
            </div>
          </DashboardCard>

        </div>

        {/* Right Panel: Environmental Sensors */}
        <div className="w-[420px] flex flex-col gap-6 pointer-events-auto">
          
          <DashboardCard title="Ambient Conditions" icon={<Sun className="w-5 h-5 text-amber-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <SensorBlock label="Temperature" value="24.2" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400" />} />
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
      
      {/* Bottom bar if needed, otherwise just space */}
      <div className="h-12" />

      {/* Action Modal */}
      {showActionModal && (
        <WeedActionModal
          onClose={() => {
            setShowActionModal(false);
            setSelectedTreatment(null);
          }}
          onSelectTreatment={setSelectedTreatment}
          selectedTreatment={selectedTreatment}
        />
      )}
    </div>
  );
}

// --- Subcomponents ---

function DashboardCard({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/15 p-6 shadow-2xl shadow-black/50 transition-all duration-300 hover:bg-black/50 hover:border-white/25 hover:shadow-2xl hover:shadow-emerald-500/10 hover:scale-101 focus-within:ring-2 focus-within:ring-emerald-500/50">
      <div className="flex items-center gap-3 mb-5 pb-3 border-b border-white/8">
        <div className="p-2.5 rounded-lg bg-white/8 border border-white/10 shadow-sm">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-white/95 tracking-wide uppercase">{title}</h3>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value, unit, icon, progress, color }: any) {
  return (
    <div className="pb-3 last:pb-0">
      <div className="flex justify-between items-end mb-2.5 gap-2">
        <div className="flex items-center gap-2 text-xs text-white/75 font-medium">
          <span className="opacity-85">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold text-white/95">{value}</span>
          <span className="text-xs text-white/65 font-medium">{unit}</span>
        </div>
      </div>
      <div className="h-2.5 w-full bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/5">
        <div className={`h-full ${color} rounded-full transition-all duration-300 ease-out shadow-lg`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function NPKBar({ label, value, color }: any) {
  return (
    <div className="flex-1 bg-black/50 rounded-xl p-3 border border-white/15 flex flex-col items-center gap-2 hover:bg-black/60 hover:border-white/25 hover:scale-105 transition-all duration-200 shadow-sm cursor-pointer">
      <span className="text-xs font-bold text-white/70 uppercase tracking-wide">{label}</span>
      <div className="h-16 w-2 bg-black/60 rounded-full overflow-hidden shadow-inner border border-white/10 flex flex-col justify-end">
        <div className={`w-full ${color} rounded-full transition-all duration-300 shadow-md`} style={{ height: `${value}%` }} />
      </div>
      <span className="text-sm font-bold text-white/95 tabular-nums">{value}%</span>
    </div>
  );
}

function SensorBlock({ label, value, unit, icon }: any) {
  return (
    <div className="bg-black/40 p-4 rounded-xl border border-white/15 hover:border-white/30 hover:bg-black/50 hover:scale-105 transition-all duration-200 shadow-sm hover:shadow-md group cursor-pointer focus-within:ring-2 focus-within:ring-white/40">
      <div className="flex items-start gap-2.5 mb-2.5">
        <div className="opacity-80 group-hover:opacity-100 transition-opacity mt-0.5">
          {icon}
        </div>
        <span className="text-xs text-white/70 uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 pl-0.5">
        <span className="text-xl font-bold text-white/95">{value}</span>
        <span className="text-xs text-white/65 font-medium">{unit}</span>
      </div>
    </div>
  );
}

function WeatherForecast({ type }: { type: 'temperature' | 'precipitation' }) {
  // Historical data (last 4 days)
  const pastData = [
    { day: 'May 26', temp: 22, precip: 0, icon: '☀️' },
    { day: 'May 27', temp: 19, precip: 5, icon: '🌤️' },
    { day: 'May 28', temp: 18, precip: 12, icon: '🌧️' },
    { day: 'May 29', temp: 21, precip: 2, icon: '☁️' },
  ];

  // Future forecast (next 3 days)
  const futureData = [
    { day: 'Today', temp: 24, precip: 0, icon: '☀️' },
    { day: 'Tomorrow', temp: 23, precip: 3, icon: '🌤️' },
    { day: 'Jun 1', temp: 20, precip: 8, icon: '🌧️' },
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
                <div className="text-sm font-bold text-emerald-400">{d.temp}°</div>
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
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/10 relative" style={{ minHeight: '3rem' }}>
                <div
                  className="bg-blue-400/70 w-3/4 rounded-t transition-all duration-300"
                  style={{ height: `${Math.max(d.precip * 2, 2)}px` }}
                ></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip}mm</div>
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
              <div className="h-12 bg-black/40 rounded-lg mt-1 flex items-end justify-center border border-white/10 relative" style={{ minHeight: '3rem' }}>
                <div
                  className="bg-emerald-400/70 w-3/4 rounded-t transition-all duration-300"
                  style={{ height: `${Math.max(d.precip * 2, 2)}px` }}
                ></div>
                <div className="absolute bottom-1 text-xs text-white/70 font-mono">{d.precip}</div>
              </div>
              <div className="text-xs text-white/90 text-center font-bold mt-1">{d.precip}mm</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TreatmentOption({ id, title, description, icon, onSelect, isSelected }: any) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer hover:scale-102 ${
        isSelected
          ? 'border-emerald-400 bg-emerald-500/20 shadow-lg shadow-emerald-500/20'
          : 'border-white/15 bg-black/40 hover:border-white/30 hover:bg-black/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`text-2xl mt-0.5 ${isSelected ? 'scale-110' : ''} transition-transform`}>
          {icon}
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-white/95">{title}</h4>
          <p className="text-xs text-white/70 mt-1 leading-relaxed">{description}</p>
        </div>
        {isSelected && <div className="text-emerald-400 text-lg">✓</div>}
      </div>
    </button>
  );
}

function WeedActionModal({ onClose, onSelectTreatment, selectedTreatment }: any) {
  const handleExecute = () => {
    if (selectedTreatment) {
      onClose();
      alert(`🤖 Robot assigned to execute: ${selectedTreatment}\n\nThe autonomous agricultural robot is en route to Sector 4A and will begin treatment shortly.`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-50">
      <div className="bg-black/80 border border-white/20 rounded-3xl p-8 max-w-2xl w-full mx-4 shadow-2xl shadow-black/80">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white/95">Pigweed Treatment Options</h2>
            <p className="text-sm text-white/60 mt-2">Sector 4A • Select treatment method for deployment</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white/80 text-2xl cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Treatment Options */}
        <div className="space-y-4 mb-8">
          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-4">Early Stage (Under 3 inches)</h3>
          <TreatmentOption
            id="pull"
            title="Manual Pulling"
            description="Physically remove weeds by hand or with a pulling tool. Most effective when soil is moist. Cost-effective for small infestations."
            icon="🤲"
            onSelect={onSelectTreatment}
            isSelected={selectedTreatment === 'pull'}
          />
          <TreatmentOption
            id="hoe"
            title="Hoeing"
            description="Use a hoe to cut weeds below the soil surface. Fast and effective for larger early-stage areas. Requires follow-up for root fragments."
            icon="⛏️"
            onSelect={onSelectTreatment}
            isSelected={selectedTreatment === 'hoe'}
          />
          <TreatmentOption
            id="mulch"
            title="Heavy Mulching"
            description="Apply 3-4 inches of mulch to block sunlight and prevent seed germination. Long-lasting solution, improves soil health."
            icon="🌾"
            onSelect={onSelectTreatment}
            isSelected={selectedTreatment === 'mulch'}
          />

          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-4 pt-4">Established Infestations</h3>
          <TreatmentOption
            id="herbicide"
            title="Chemical Herbicides"
            description="Apply selective or non-selective herbicides based on crop. Highly effective for large infestations. Follow safety guidelines and re-entry periods."
            icon="🧪"
            onSelect={onSelectTreatment}
            isSelected={selectedTreatment === 'herbicide'}
          />
          <TreatmentOption
            id="solarize"
            title="Soil Solarization"
            description="Cover soil with clear plastic for 4-6 weeks in hot weather. Heat kills weed seeds and pathogens. Ecological and chemical-free approach."
            icon="☀️"
            onSelect={onSelectTreatment}
            isSelected={selectedTreatment === 'solarize'}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-white/80 font-semibold hover:bg-white/5 hover:border-white/30 transition-all duration-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={!selectedTreatment}
            className={`flex-1 px-4 py-3 rounded-xl font-bold uppercase tracking-widest transition-all duration-200 cursor-pointer ${
              selectedTreatment
                ? 'bg-emerald-500/40 border border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/20'
                : 'bg-black/40 border border-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            🤖 Deploy Robot
          </button>
        </div>
      </div>
    </div>
  );
}
