import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, AlertCircle, ArrowLeft } from 'lucide-react';
import farmBackground from './assets/images/farmbackground.png';

export default function View3D() {
  const [selectedProblem, setSelectedProblem] = useState<string | null>(null);

  const problems = [
    {
      id: 'p1',
      name: 'Pigweed Infestation',
      sector: '4A',
      severity: 'High',
      color: 'rgb(244, 63, 94)',
      colorTw: 'rose',
      icon: '🌱',
      description: 'Dense pigweed growth detected. Estimated coverage: 35% of sector. Immediate treatment recommended.',
      position: '45%',
      top: '35%',
    },
    {
      id: 'p2',
      name: 'Soil Moisture Deficit',
      sector: '2B',
      severity: 'Medium',
      color: 'rgb(59, 130, 246)',
      colorTw: 'blue',
      icon: '💧',
      description: 'Soil moisture levels below optimal threshold. Recommend irrigation in next 48 hours.',
      position: '25%',
      top: '55%',
    },
    {
      id: 'p3',
      name: 'Nutrient Imbalance',
      sector: '7C',
      severity: 'Medium',
      color: 'rgb(251, 146, 60)',
      colorTw: 'orange',
      icon: '⚗️',
      description: 'Phosphorus levels declining. NPK ratio needs adjustment. Consider supplemental fertilizer.',
      position: '70%',
      top: '45%',
    },
    {
      id: 'p4',
      name: 'Disease Risk - Rust Fungus',
      sector: '5D',
      severity: 'High',
      color: 'rgb(168, 85, 247)',
      colorTw: 'purple',
      icon: '🔴',
      description: 'Elevated humidity and temperature creating favorable conditions for rust fungus. Monitor closely.',
      position: '60%',
      top: '25%',
    },
  ];

  return (
    <div className="fixed inset-0 pointer-events-auto z-50 flex items-center justify-between p-6 gap-6" style={{
      backgroundImage: `url(${farmBackground})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed'
    }}>
      {/* 3D View Area with Farm Background */}
      <div className="flex-1 relative h-full rounded-2xl overflow-hidden border border-white/20 bg-black/20 backdrop-blur-lg flex items-center justify-center" style={{
        backgroundImage: `url(${farmBackground})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}>
        {/* 3D Gaussian Splatter Canvas Area */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-black/10 to-black/20" />

        {/* Problem Markers as Colored Dots */}
        {problems.map((problem) => (
          <button
            key={problem.id}
            onClick={() => setSelectedProblem(selectedProblem === problem.id ? null : problem.id)}
            className="absolute w-8 h-8 rounded-full cursor-pointer transition-all duration-200 transform hover:scale-125 focus:outline-none"
            style={{
              left: problem.position,
              top: problem.top,
              backgroundColor: problem.color,
              boxShadow: selectedProblem === problem.id
                ? `0 0 25px ${problem.color}, 0 0 50px ${problem.color}, inset 0 0 10px rgba(255,255,255,0.3)`
                : `0 0 15px ${problem.color}, 0 0 25px ${problem.color}`,
              border: selectedProblem === problem.id ? `3px solid white` : `2px solid rgba(255,255,255,0.5)`,
              zIndex: selectedProblem === problem.id ? 50 : 10,
            }}
            title={problem.name}
          />
        ))}
      </div>

      {/* Back Button */}
      <Link
        to="/"
        className="absolute top-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-black/50 hover:bg-black/70 border border-white/20 text-white/70 hover:text-white transition-all text-xs font-semibold uppercase tracking-widest z-40"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* Problem Details Panel */}
      <div className="w-96 bg-black/50 backdrop-blur-xl border border-white/30 rounded-2xl pt-6 px-6 pb-6 flex flex-col overflow-hidden mt-16" style={{ height: 'calc(100% - 4rem)' }}>
        <h2 className="text-lg font-bold text-white/95 mb-6">Problem Detection Report</h2>

        {selectedProblem ? (
          <div className="flex-1 overflow-y-auto space-y-6">
            {problems.map((problem) => (
              selectedProblem === problem.id && (
                <div key={problem.id} className="space-y-4">
                  {/* Problem Header with Color */}
                  <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: `${problem.color}20`, borderColor: problem.color, borderWidth: '2px' }}>
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: problem.color }} />
                    <div className="flex-1">
                      <h3 className="font-bold text-white/95">{problem.name}</h3>
                      <p className="text-xs text-white/60">{problem.sector}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold ${
                      problem.severity === 'High' ? 'bg-rose-500/30 text-rose-400' : 'bg-amber-500/30 text-amber-400'
                    }`}>
                      {problem.severity}
                    </span>
                  </div>

                  {/* Icon */}
                  <div className="text-5xl text-center opacity-70">{problem.icon}</div>

                  {/* Description */}
                  <div className="p-4 rounded-xl bg-white/10 border border-white/20">
                    <p className="text-sm text-white/90 leading-relaxed">{problem.description}</p>
                  </div>

                  {/* Action Button */}
                  <button className="w-full px-4 py-3 rounded-xl bg-blue-500/30 hover:bg-blue-500/40 border border-blue-400/50 text-blue-300 font-semibold transition-all text-sm uppercase tracking-wide">
                    View Details
                  </button>
                </div>
              )
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-white/50 space-y-3">
            <AlertCircle className="w-10 h-10 opacity-30" />
            <div>
              <p className="text-sm font-semibold mb-1">Click a colored dot on the map</p>
              <p className="text-xs">to view problem details</p>
            </div>
          </div>
        )}

        {/* Problem List */}
        <div className="mt-6 pt-6 border-t border-white/10 space-y-2">
          <p className="text-xs text-white/60 font-bold uppercase tracking-wider mb-3">All Problems ({problems.length})</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {problems.map((problem) => (
              <button
                key={problem.id}
                onClick={() => setSelectedProblem(selectedProblem === problem.id ? null : problem.id)}
                className="w-full text-left p-3 rounded-lg transition-all hover:bg-white/10"
                style={{
                  backgroundColor: selectedProblem === problem.id ? `${problem.color}30` : 'transparent',
                  borderLeft: `3px solid ${problem.color}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: problem.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white/90 truncate">{problem.name}</p>
                    <p className="text-xs text-white/50">{problem.sector}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
