import { Link } from 'react-router-dom';
import { 
  ArrowLeft, Download, Activity, 
  Droplets, Thermometer, AlertCircle, Bot, Sparkles, CheckCircle2, Loader2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useState } from 'react';

export default function Report() {
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/report')
      .then(async res => {
        if (!res.ok) {
            let errorText = 'Failed to generate report';
            try {
                const errorData = await res.json();
                errorText = errorData.detail || errorText;
            } catch (e) {
                // ignore parsing error
            }
            throw new Error(errorText);
        }
        return res.json();
      })
      .then(data => {
        setReportData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const categoryConfig: Record<string, any> = {
    moisture: { icon: <Droplets className="text-blue-400" />, color: 'bg-blue-400' },
    nutrient: { icon: <CheckCircle2 className="text-emerald-400" />, color: 'bg-emerald-400' },
    temperature: { icon: <Thermometer className="text-orange-400" />, color: 'bg-orange-400' },
    weed: { icon: <AlertCircle className="text-rose-400" />, color: 'bg-rose-400' },
  };

  if (loading) {
    return (
      <div className="absolute inset-0 bg-[#0a0b0d] flex flex-col items-center justify-center text-emerald-400 z-50 pointer-events-auto">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <h2 className="text-xl font-medium tracking-wider">Generating AI Report...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 bg-[#0a0b0d] flex flex-col items-center justify-center text-rose-400 z-50 pointer-events-auto">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h2 className="text-xl font-medium tracking-wider max-w-xl text-center">Error: {error}</h2>
        <Link to="/" className="mt-6 px-4 py-2 bg-rose-500/20 rounded-lg border border-rose-500/50 hover:bg-rose-500/30 text-rose-300 transition-colors">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  if (!reportData) return null;

  const { analyst, markdownText, scores } = reportData;

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
            <p className="text-white/40 mt-2 font-mono text-sm">
              Generated: {new Date().toLocaleString()} • Analyst: {analyst}
            </p>
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
            
            <div className="prose prose-invert prose-emerald max-w-none prose-headings:font-semibold prose-h2:text-3xl prose-h2:text-white prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-4 prose-h2:mb-8 prose-h3:text-xl prose-h3:text-emerald-300 prose-h3:mt-8 prose-h3:mb-4 prose-p:text-white/70 prose-p:leading-relaxed prose-ul:text-white/70 prose-ol:text-white/70 prose-li:marker:text-emerald-500 prose-strong:text-white prose-strong:font-semibold prose-blockquote:border-l-4 prose-blockquote:border-rose-500/50 prose-blockquote:bg-rose-500/10 prose-blockquote:px-6 prose-blockquote:py-4 prose-blockquote:rounded-r-2xl prose-blockquote:text-rose-200 prose-blockquote:not-italic prose-blockquote:my-8">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdownText}
              </ReactMarkdown>
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
                <span className="text-7xl font-bold text-white tracking-tighter">{scores.overall.value}</span>
                <span className="text-2xl text-white/50">/{scores.overall.max}</span>
              </div>
              <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(scores.overall.value / scores.overall.max) * 100}%` }} />
              </div>
              <p className="text-emerald-200/80 text-sm">{scores.overall.description}</p>
            </div>

            {scores.categories.map((cat) => {
              const config = categoryConfig[cat.id] || { icon: <Activity className="text-white" />, color: 'bg-white' };
              return (
                <RatingCard 
                  key={cat.id}
                  title={cat.title} 
                  score={`${cat.score}/${cat.max}`} 
                  icon={config.icon} 
                  color={config.color} 
                  percentage={(cat.score / cat.max) * 100} 
                  status={cat.status} 
                />
              );
            })}

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

