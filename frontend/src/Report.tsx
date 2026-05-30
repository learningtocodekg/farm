import { Link } from 'react-router-dom';
import { 
  ArrowLeft, Download, Activity, 
  Droplets, Thermometer, AlertCircle, Bot, Sparkles, CheckCircle2
} from 'lucide-react';

export default function Report() {
  return (
    <div className="absolute inset-0 bg-[#0a0b0d] overflow-y-auto pointer-events-auto z-50 text-white selection:bg-emerald-500/30">
      <div className="max-w-7xl mx-auto p-8 pt-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
          <div>
            <Link to="/" className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium tracking-wide">Back to Dashboard</span>
            </Link>
            <h1 className="text-4xl font-semibold tracking-tight flex items-center gap-3">
              <Bot className="w-8 h-8 text-emerald-400" />
              AI Farm Analysis Report
            </h1>
            <p className="text-white/40 mt-2 font-mono text-sm">Generated: {new Date().toLocaleString()} • Analyst: AgrAI-7</p>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-sm font-medium transition-colors shadow-lg shadow-emerald-500/10">
              <Download className="w-4 h-4" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        <div className="flex gap-8 items-start">
          
          {/* Left Column: AI Text Document / Markdown */}
          <div className="flex-1 bg-white/5 rounded-3xl p-10 border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
              <Sparkles className="w-32 h-32 text-emerald-400" />
            </div>
            
            <div className="prose prose-invert prose-emerald max-w-none">
              <h2 className="text-2xl font-semibold text-emerald-400 mb-6 flex items-center gap-2 border-b border-white/10 pb-4">
                <Sparkles className="w-5 h-5" />
                Executive Summary
              </h2>
              
              <div className="space-y-6 text-white/80 leading-relaxed font-serif text-lg">
                <p>
                  Based on the latest multispectral drone sweeps and ground sensor data collected over the last 24 hours, the overall farm ecosystem is performing optimally. The crop stress levels remain remarkably low across all active quadrants, and the nutrient absorption rate is currently peaking.
                </p>
                
                <h3 className="text-xl font-semibold text-white mt-8 mb-4">Soil Health & Moisture Profile</h3>
                <p>
                  We have observed a slight localized dip in soil moisture across <strong>Sector 4A</strong> and <strong>Sector 4B</strong>. This is likely correlated with the minor elevation change and recent intense solar radiation (peaking at 850 W/m² yesterday afternoon). 
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-4 mb-6 text-white/70">
                  <li><strong>pH Levels:</strong> Stable at 6.5 (Optimal range).</li>
                  <li><strong>Nitrogen (N):</strong> 72% - Well within target parameters.</li>
                  <li><strong>Potassium (K):</strong> 60% - Sufficient for current growth stage.</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mt-8 mb-4">Weed & Pest Analysis</h3>
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-5 my-6 text-rose-200">
                  <p className="font-medium flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-rose-400" />
                    Action Required: Pigweed Outbreak
                  </p>
                  <p className="text-sm opacity-90">
                    Image recognition has positively identified small clusters of Pigweed emerging in Sector 4A. Given its aggressive growth rate, an automated targeted herbicide micro-spray is recommended within the next 48 hours to prevent seed dispersal.
                  </p>
                </div>

                <h3 className="text-xl font-semibold text-white mt-8 mb-4">Recommendations</h3>
                <ol className="list-decimal pl-6 space-y-3 text-white/70">
                  <li>Increase automated drip irrigation frequency by 15% in Sector 4 to stabilize the moisture deficit.</li>
                  <li>Dispatch targeted spray drones to Sector 4A to neutralize the detected Pigweed clusters.</li>
                  <li>Maintain current NPK fertilization schedules; no immediate intervention required.</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Right Column: Scores & Ratings */}
          <div className="w-96 flex flex-col gap-6 shrink-0">
            
            <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 rounded-3xl p-8 border border-emerald-500/30 shadow-2xl relative overflow-hidden group">
              <div className="absolute -bottom-8 -right-8 opacity-10 group-hover:opacity-20 transition-opacity blur-2xl transform scale-150">
                <Activity className="w-64 h-64 text-emerald-400" />
              </div>
              <h3 className="text-emerald-400 font-medium mb-2 uppercase tracking-widest text-xs">Overall Rating</h3>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-7xl font-bold text-white tracking-tighter">94</span>
                <span className="text-2xl text-white/50">/100</span>
              </div>
              <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: '94%' }} />
              </div>
              <p className="text-emerald-200/80 text-sm">Farm health is in the top 5% of historical baselines for this season.</p>
            </div>

            <RatingCard title="Moisture Index" score="82/100" icon={<Droplets className="text-blue-400" />} color="bg-blue-400" percentage={82} status="Good" />
            
            <RatingCard title="Nutrient Balance" score="96/100" icon={<CheckCircle2 className="text-emerald-400" />} color="bg-emerald-400" percentage={96} status="Excellent" />
            
            <RatingCard title="Temperature Stability" score="88/100" icon={<Thermometer className="text-orange-400" />} color="bg-orange-400" percentage={88} status="Optimal" />
            
            <RatingCard title="Weed Control" score="75/100" icon={<AlertCircle className="text-rose-400" />} color="bg-rose-400" percentage={75} status="Needs Attention" />

          </div>
        </div>
      </div>
    </div>
  );
}

function RatingCard({ title, score, icon, color, percentage, status }: any) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/10 shadow-xl hover:bg-white/10 transition-colors">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-black/40 rounded-xl border border-white/5 shadow-inner">
            {icon}
          </div>
          <div>
            <h4 className="text-sm font-medium text-white/90">{title}</h4>
            <p className="text-xs text-white/50">{status}</p>
          </div>
        </div>
        <span className="text-xl font-bold">{score}</span>
      </div>
      <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

