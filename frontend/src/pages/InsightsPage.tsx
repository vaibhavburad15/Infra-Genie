import {
  Lightbulb, Shield, Zap, DollarSign, CheckCircle2, ArrowRight,
  Brain, Sparkles, Wrench, Clock, Code,
} from 'lucide-react';

const insightCategories: { id: string; label: string; icon: any; color: string; count: number; savings: string }[] = [];

const insights: { category: string; priority: string; title: string; description: string; impact: string; effort: string; agent: string; confidence: number }[] = [];

const priorityConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: 'Critical' },
  high: { bg: 'bg-[#fdf3eb]', text: 'text-[#c9692a]', border: 'border-[#f0bc98]', label: 'High' },
  medium: { bg: 'bg-[#edf3fb]', text: 'text-[#1e3a7a]', border: 'border-[#a8c1ea]', label: 'Medium' },
  low: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200', label: 'Low' },
};

const categoryIcons: Record<string, typeof DollarSign> = { cost: DollarSign, security: Shield, performance: Zap, reliability: CheckCircle2 };

export default function InsightsPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* AI Banner */}
      <div className="bg-gradient-to-r from-[#1e3a7a] to-[#24478f] rounded-2xl p-5 flex items-center justify-between overflow-hidden relative">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #c9692a 0%, transparent 60%)' }} />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#c9692a]/20 border border-[#c9692a]/30 flex items-center justify-center"><Brain size={24} className="text-[#c9692a]" /></div>
          <div>
            <h2 className="text-white text-lg font-bold flex items-center gap-2">AI-Generated Insights <Sparkles size={15} className="text-[#c9692a]" /></h2>
            <p className="text-blue-200 text-sm">10 recommendations found - potential savings of <span className="text-[#c9692a] font-bold">$842/month</span></p>
          </div>
        </div>
        <button className="relative z-10 px-4 py-2 rounded-lg bg-[#c9692a] text-white text-sm font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">Apply All Safe Fixes</button>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {insightCategories.map((cat) => {
          const Icon = cat.icon;
          return (
            <div key={cat.id} className="bg-white rounded-2xl p-4 border border-gray-100 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${cat.color}15`, color: cat.color }}><Icon size={18} /></div>
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{cat.count}</span>
              </div>
              <p className="text-gray-800 text-sm font-semibold">{cat.label}</p>
              <p className="text-xs mt-1 font-medium" style={{ color: cat.color }}>{cat.savings}</p>
            </div>
          );
        })}
      </div>

      {/* Insights list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-gray-800 text-sm font-bold flex items-center gap-2"><Lightbulb size={16} className="text-[#c9692a]" />All Recommendations</h3>
          <div className="flex items-center gap-2 text-xs">
            <button className="px-3 py-1.5 rounded-lg bg-[#1e3a7a] text-white font-medium cursor-pointer">All</button>
            <button className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-gray-300 cursor-pointer transition-colors">Applied</button>
            <button className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-gray-300 cursor-pointer transition-colors">Dismissed</button>
          </div>
        </div>

        {insights.map((insight, idx) => {
          const CatIcon = categoryIcons[insight.category] || Lightbulb;
          const pc = priorityConfig[insight.priority];
          return (
            <div key={idx} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow group">
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${pc.bg}`}><CatIcon size={18} className={pc.text} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <h4 className="text-gray-800 text-sm font-bold">{insight.title}</h4>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${pc.bg} ${pc.text} ${pc.border}`}>{pc.label}</span>
                  </div>
                  <p className="text-gray-500 text-xs leading-relaxed mb-3">{insight.description}</p>
                  <div className="flex items-center gap-4 flex-wrap text-xs">
                    <span className="flex items-center gap-1 text-gray-400"><Brain size={11} className="text-[#c9692a]" />{insight.agent}</span>
                    <span className="flex items-center gap-1 text-gray-400">Impact: <span className="text-gray-700 font-medium">{insight.impact}</span></span>
                    <span className="flex items-center gap-1 text-gray-400"><Wrench size={11} />Effort: <span className="text-gray-700 font-medium">{insight.effort}</span></span>
                    <span className="flex items-center gap-1 text-gray-400"><Sparkles size={11} className="text-[#c9692a]" />Confidence: <span className="text-gray-700 font-medium">{insight.confidence}%</span></span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button className="px-3 py-1.5 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap">Apply Fix <ArrowRight size={11} /></button>
                  <button className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">Dismiss</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Analysis summary */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-2 mb-4"><Code size={16} className="text-[#c9692a]" /><h3 className="text-gray-800 text-sm font-semibold">AI Analysis Summary</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Insights Generated', value: '10', icon: Lightbulb, color: '#c9692a' },
            { label: 'Avg Confidence', value: '94%', icon: Brain, color: '#1e3a7a' },
            { label: 'Est. Monthly Savings', value: '$842', icon: DollarSign, color: '#059669' },
            { label: 'Avg Resolution Time', value: '8m', icon: Clock, color: '#4a72c4' },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="p-3 rounded-xl bg-gray-50">
                <Icon size={16} className="mb-2" style={{ color: s.color }} />
                <p className="text-gray-800 text-lg font-bold">{s.value}</p>
                <p className="text-gray-400 text-xs">{s.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
