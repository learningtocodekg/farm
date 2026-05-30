import { Link } from 'react-router-dom';
import { 
  ArrowLeft, FileText, Download, Calendar, Activity, 
  Droplets, Thermometer, AlertCircle, CheckCircle2, TrendingUp
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const temperatureData = [
  { time: '00:00', temp: 18.2 },
  { time: '04:00', temp: 17.5 },
  { time: '08:00', temp: 20.1 },
  { time: '12:00', temp: 24.5 },
  { time: '16:00', temp: 25.2 },
  { time: '20:00', temp: 21.0 },
  { time: '24:00', temp: 18.8 },
];

export default function Report() {
  return (
    <div className="absolute inset-0 bg-[#0a0b0d] overflow-y-auto pointer-events-auto z-50 text-white selection:bg-emerald-500/30">
      <div className="max-w-6xl mx-auto p-8 pt-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <Link to="/" className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium tracking-wide">Back to Dashboard</span>
            </Link>
            <h1 className="text-4xl font-semibold tracking-tight">Comprehensive Farm Report</h1>
            <p className="text-white/40 mt-2 font-mono text-sm">Generated: {new Date().toLocaleDateString()} • Sector: All Areas</p>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors">
              <Calendar className="w-4 h-4" />
              <span>Last 7 Days</span>
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-sm font-medium transition-colors shadow-lg shadow-emerald-500/10">
              <Download className="w-4 h-4" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="grid grid-cols-4 gap-6 mb-12">
          <SummaryCard title="Overall Health Score" value="94/100" icon={<Activity className="text-emerald-400" />} trend="+2.5%" positive />
          <SummaryCard title="Soil Moisture Avg" value="44%" icon={<Droplets className="text-blue-400" />} trend="-1.2%" positive={false} />
          <SummaryCard title="Temperature Avg" value="21.4°C" icon={<Thermometer className="text-orange-400" />} trend="+0.8°C" positive />
          <SummaryCard title="Active Threats" value="3" icon={<AlertCircle className="text-rose-400" />} trend="-2" positive />
        </div>

        {/* Charts & Details Section */}
        <div className="grid grid-cols-3 gap-6 mb-12">
          {/* Temperature Trend */}
          <div className="col-span-2 bg-white/5 rounded-3xl p-6 border border-white/10 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                24h Temperature Trend
              </h3>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={temperatureData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff50" tick={{ fill: '#ffffff50', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#ffffff50" tick={{ fill: '#ffffff50', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0a0b0d', borderColor: '#ffffff20', borderRadius: '12px' }}
                    itemStyle={{ color: '#f97316' }}
                  />
                  <Area type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={3} fillOpacity={1} fill="url(#colorTemp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weed Threats List */}
          <div className="col-span-1 bg-white/5 rounded-3xl p-6 border border-white/10 shadow-2xl flex flex-col">
            <h3 className="font-semibold text-lg flex items-center gap-2 mb-6">
              <AlertCircle className="w-5 h-5 text-rose-400" />
              Recent Threats Detected
            </h3>
            <div className="flex-1 overflow-y-auto pr-2 space-y-4">
              <ThreatItem name="Pigweed" sector="4A" time="2h ago" status="Critical" color="text-rose-400" bg="bg-rose-500/10" border="border-rose-500/20" />
              <ThreatItem name="Waterhemp" sector="2B" time="5h ago" status="Moderate" color="text-amber-400" bg="bg-amber-500/10" border="border-amber-500/20" />
              <ThreatItem name="Bindweed" sector="7C" time="1d ago" status="Resolved" color="text-emerald-400" bg="bg-emerald-500/10" border="border-emerald-500/20" icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />} />
            </div>
          </div>
        </div>

        {/* Detailed Logs Table */}
        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              Detailed Action Logs
            </h3>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-white/50 text-xs uppercase tracking-wider font-mono">
                <tr>
                  <th className="p-4 font-medium">Timestamp</th>
                  <th className="p-4 font-medium">Action type</th>
                  <th className="p-4 font-medium">Sector</th>
                  <th className="p-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr className="hover:bg-white/5 transition-colors">
                  <td className="p-4 text-white/80 font-mono">2026-05-30 09:14</td>
                  <td className="p-4 text-white">Automated Irrigation</td>
                  <td className="p-4 text-white/60">Sector 1-3</td>
                  <td className="p-4 text-emerald-400">Completed</td>
                </tr>
                <tr className="hover:bg-white/5 transition-colors">
                  <td className="p-4 text-white/80 font-mono">2026-05-30 08:30</td>
                  <td className="p-4 text-white">Drone Sweep (Multispectral)</td>
                  <td className="p-4 text-white/60">All Sectors</td>
                  <td className="p-4 text-emerald-400">Completed</td>
                </tr>
                <tr className="hover:bg-white/5 transition-colors">
                  <td className="p-4 text-white/80 font-mono">2026-05-29 16:45</td>
                  <td className="p-4 text-white">Fertilizer Application (N)</td>
                  <td className="p-4 text-white/60">Sector 4A</td>
                  <td className="p-4 text-amber-400">Pending Weather</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon, trend, positive }: any) {
  return (
    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-xl relative overflow-hidden group hover:border-white/20 transition-all">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="p-3 bg-white/5 rounded-2xl border border-white/10">{icon}</div>
        <span className={`text-xs font-medium px-2 py-1 rounded-lg border ${positive ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
          {trend}
        </span>
      </div>
      <div className="relative z-10">
        <p className="text-white/50 text-sm mb-1">{title}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
      </div>
      <div className="absolute -bottom-8 -right-8 opacity-5 group-hover:opacity-10 transition-opacity blur-2xl transform scale-150">
        {icon}
      </div>
    </div>
  );
}

function ThreatItem({ name, sector, time, status, color, bg, border, icon }: any) {
  return (
    <div className={`p-4 rounded-2xl border ${border} ${bg} flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        {icon || <AlertCircle className={`w-5 h-5 ${color}`} />}
        <div>
          <p className="font-medium text-sm text-white/90">{name}</p>
          <p className="text-xs text-white/50">Sector {sector}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-xs font-semibold ${color}`}>{status}</p>
        <p className="text-xs text-white/40 font-mono mt-0.5">{time}</p>
      </div>
    </div>
  );
}
