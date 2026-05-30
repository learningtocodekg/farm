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

  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">
      {/* Top HUD */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-lg shadow-black/20">
          <div className={`w-2 h-2 rounded-full animate-pulse ${status === 'loaded' ? 'bg-emerald-400' : status === 'loading' ? 'bg-amber-400' : 'bg-rose-400'}`}></div>
          <span className={`text-sm font-medium tracking-wide ${statusColor}`}>{statusLabel}</span>
          {status === 'loaded' && (
            <>
              <div className="w-px h-4 bg-white/20 mx-1" />
              <span className="text-white/60 text-xs font-mono uppercase tracking-wider">{cameraMode}</span>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Link 
            to="/report"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/30 hover:border-emerald-500/50 transition-all shadow-lg select-none uppercase tracking-widest"
          >
            <FileText className="w-4 h-4" />
            Full Report
          </Link>
          <button
            onClick={toggleCamera}
            className="px-4 py-2.5 rounded-xl bg-black/40 backdrop-blur-md border border-white/10 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 hover:border-white/30 transition-all shadow-lg select-none uppercase tracking-widest"
          >
            {cameraMode === 'perspective' ? 'Top-Down View' : 'Perspective View'}
          </button>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="flex-1 flex justify-between items-center mt-6 w-full max-w-[1600px] mx-auto pointer-events-none">
        
        {/* Left Panel: Soil Health & Weed ID */}
        <div className="w-[340px] flex flex-col gap-5 pointer-events-auto">
          
          <DashboardCard title="Soil Health Analytics" icon={<Beaker className="w-5 h-5 text-emerald-400" />}>
            <div className="space-y-4">
              <MetricRow label="pH Level" value="6.5" unit="Optimal" icon={<Gauge className="w-4 h-4 text-emerald-400/70" />} progress={65} color="bg-emerald-500" />
              
              <div className="pt-2 border-t border-white/5">
                <span className="text-xs text-white/40 uppercase tracking-wider mb-2 block">NPK Composition</span>
                <div className="flex gap-2">
                  <NPKBar label="N" value={72} color="bg-blue-400" />
                  <NPKBar label="P" value={45} color="bg-purple-400" />
                  <NPKBar label="K" value={60} color="bg-orange-400" />
                </div>
              </div>

              <div className="pt-2 border-t border-white/5 space-y-3">
                <MetricRow label="Soil Moisture" value="42" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400/70" />} progress={42} color="bg-blue-400" />
                <MetricRow label="Soil Temp" value="18.5" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400/70" />} progress={60} color="bg-orange-400" />
              </div>
            </div>
          </DashboardCard>

          <DashboardCard title="Weed Identification" icon={<Scan className="w-5 h-5 text-rose-400" />}>
            <div className="flex items-center justify-between p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-8 h-8 text-rose-400" />
                <div>
                  <h4 className="text-sm font-semibold text-white/90">Pigweed Detected</h4>
                  <p className="text-xs text-rose-300/80">Sector 4A • High Priority</p>
                </div>
              </div>
              <button className="px-3 py-1.5 rounded-md bg-rose-500/20 text-rose-300 text-xs font-medium hover:bg-rose-500/30 transition-colors">
                Action
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-white/40">Total Threats</span>
              <span className="text-white/80 font-mono">3 Active</span>
            </div>
          </DashboardCard>

        </div>

        {/* Right Panel: Environmental Sensors */}
        <div className="w-[340px] flex flex-col gap-5 pointer-events-auto">
          
          <DashboardCard title="Ambient Conditions" icon={<Sun className="w-5 h-5 text-amber-400" />}>
            <div className="grid grid-cols-2 gap-3">
              <SensorBlock label="Temperature" value="24.2" unit="°C" icon={<Thermometer className="w-4 h-4 text-orange-400" />} />
              <SensorBlock label="Humidity" value="55" unit="%" icon={<Droplets className="w-4 h-4 text-blue-400" />} />
              <SensorBlock label="UV Index" value="7.2" unit="High" icon={<Sun className="w-4 h-4 text-amber-400" />} />
              <SensorBlock label="Solar Rad." value="850" unit="W/m²" icon={<Sprout className="w-4 h-4 text-yellow-400" />} />
            </div>
          </DashboardCard>

          <DashboardCard title="Meteorological" icon={<Wind className="w-5 h-5 text-cyan-400" />}>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/40 border border-white/5">
                <div className="flex items-center gap-3">
                  <Compass className="w-6 h-6 text-cyan-400" />
                  <div>
                    <h4 className="text-xs text-white/40 uppercase tracking-wider">Wind</h4>
                    <p className="text-sm font-semibold text-white/90">12 km/h <span className="text-cyan-400 text-xs ml-1">NW</span></p>
                  </div>
                </div>
                <div className="text-right">
                  <h4 className="text-xs text-white/40 uppercase tracking-wider">Drone Flight</h4>
                  <p className="text-xs font-semibold text-emerald-400">Safe</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SensorBlock label="Barometric" value="1012" unit="hPa" icon={<Gauge className="w-4 h-4 text-indigo-400" />} />
                <SensorBlock label="Precipitation" value="0.0" unit="mm" icon={<CloudRain className="w-4 h-4 text-blue-300" />} />
              </div>
            </div>
          </DashboardCard>

        </div>
      </div>
      
      {/* Bottom bar if needed, otherwise just space */}
      <div className="h-12" />
    </div>
  );
}

// --- Subcomponents ---

function DashboardCard({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 p-5 shadow-2xl shadow-black/40 transition-all hover:bg-black/50 hover:border-white/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-white/5 border border-white/5 shadow-inner">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-white/90 tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MetricRow({ label, value, unit, icon, progress, color }: any) {
  return (
    <div>
      <div className="flex justify-between items-end mb-1.5">
        <div className="flex items-center gap-2 text-xs text-white/60">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-sm font-medium text-white/90">
          {value} <span className="text-xs text-white/40">{unit}</span>
        </div>
      </div>
      <div className="h-1.5 w-full bg-black/60 rounded-full overflow-hidden shadow-inner">
        <div className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function NPKBar({ label, value, color }: any) {
  return (
    <div className="flex-1 bg-black/40 rounded-lg p-2 border border-white/5 flex flex-col items-center gap-1.5 hover:bg-white/5 transition-colors">
      <span className="text-[10px] font-bold text-white/40">{label}</span>
      <div className="h-12 w-1.5 bg-black/60 rounded-full overflow-hidden shadow-inner flex flex-col justify-end">
        <div className={`w-full ${color} rounded-full transition-all duration-1000`} style={{ height: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-white/80">{value}%</span>
    </div>
  );
}

function SensorBlock({ label, value, unit, icon }: any) {
  return (
    <div className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-colors group">
      <div className="flex items-center gap-2 mb-2">
        <div className="opacity-70 group-hover:opacity-100 transition-opacity">
          {icon}
        </div>
        <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-semibold text-white/90">{value}</span>
        <span className="text-xs text-white/40">{unit}</span>
      </div>
    </div>
  );
}
