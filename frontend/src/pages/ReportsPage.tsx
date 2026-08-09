import { FileText, Download, Calendar, TrendingDown, TrendingUp } from 'lucide-react';

const reports: { title: string; type: string; date: string; size: string; status: string }[] = [];

export default function ReportsPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><FileText size={18} className="text-[#1e3a7a]" /></div>
            <div><h3 className="text-gray-800 font-bold text-sm">Generate Report</h3><p className="text-gray-400 text-xs">Create a custom infrastructure report</p></div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 focus:outline-none focus:border-[#1e3a7a] cursor-pointer">
            <option>Monthly Summary</option><option>Security Audit</option><option>Cost Analysis</option><option>Compliance Report</option>
          </select>
          <select className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 focus:outline-none focus:border-[#1e3a7a] cursor-pointer">
            <option>Last 30 days</option><option>Last 7 days</option><option>Last 90 days</option>
          </select>
          <button className="px-4 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">Generate</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-semibold text-sm">Recent Reports</h3></div>
        <div className="divide-y divide-gray-50">
          {reports.map((r, idx) => (
            <div key={idx} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-[#fdf3eb] flex items-center justify-center"><FileText size={16} className="text-[#c9692a]" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-800 text-sm font-medium">{r.title}</p>
                <p className="text-gray-400 text-xs">{r.type} - {r.size}</p>
              </div>
              <span className="text-gray-400 text-xs flex items-center gap-1"><Calendar size={11} />{r.date}</span>
              {r.status === 'ready' ? (
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#edf3fb] text-[#1e3a7a] text-xs font-semibold hover:bg-[#1e3a7a] hover:text-white transition-colors cursor-pointer"><Download size={12} />Download</button>
              ) : (
                <span className="text-[#c9692a] text-xs font-medium animate-pulse">Generating...</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
