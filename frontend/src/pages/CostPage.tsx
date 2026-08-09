import { DollarSign, TrendingDown, TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';

const costByService: { service: string; cost: number; budget: number; color: string }[] = [];

const monthlyData: { month: string; cost: number }[] = [];

export default function CostPage() {
  const maxCost = monthlyData.length ? Math.max(...monthlyData.map((d) => d.cost)) : 1;
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'This Month', value: '$12.4K', change: '-8%', trend: 'down', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Projected', value: '$12.1K', change: '-3%', trend: 'down', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Budget', value: '$15.0K', change: '82% used', trend: 'neutral', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'AI Savings', value: '$1.2K', change: '+$340', trend: 'up', color: '#4a72c4', bg: 'bg-[#edf3fb]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg} mb-3`} style={{ color: s.color }}><DollarSign size={16} /></div>
            <p className="text-gray-800 text-xl font-bold">{s.value}</p>
            <div className="flex items-center justify-between mt-1"><p className="text-gray-400 text-xs">{s.label}</p></div>
            <span className={`text-xs font-semibold flex items-center gap-0.5 mt-1 ${s.trend === 'down' ? 'text-emerald-600' : s.trend === 'up' ? 'text-emerald-600' : 'text-gray-400'}`}>
              {s.trend === 'down' ? <TrendingDown size={11} /> : s.trend === 'up' ? <TrendingUp size={11} /> : null}{s.change}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly trend */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-gray-800 font-semibold text-sm mb-4">Monthly Cost Trend</h3>
          <div className="flex items-end gap-3 h-40">
            {monthlyData.map((d) => (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-2 group">
                <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity font-semibold">${(d.cost / 1000).toFixed(1)}K</span>
                <div className="w-full rounded-t-lg bg-gradient-to-t from-[#1e3a7a] to-[#4a72c4] group-hover:from-[#c9692a] group-hover:to-[#d97f45] transition-all" style={{ height: `${(d.cost / maxCost) * 120}px` }} />
                <span className="text-gray-400 text-xs">{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cost by service */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-gray-800 font-semibold text-sm mb-4">Cost by Service</h3>
          <div className="space-y-3">
            {costByService.map((s) => (
              <div key={s.service}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-gray-700 text-xs font-medium">{s.service}</span>
                  <span className="text-gray-800 text-xs font-bold">${s.cost.toLocaleString()} <span className="text-gray-400 font-normal">/ ${s.budget.toLocaleString()}</span></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(s.cost / s.budget) * 100}%`, background: s.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
