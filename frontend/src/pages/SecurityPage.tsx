import { Shield, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

const vulnerabilities: { severity: string; title: string; desc: string; resource: string; status: string; time: string }[] = [];

const severityConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: 'Critical' },
  high: { bg: 'bg-[#fdf3eb]', text: 'text-[#c9692a]', border: 'border-[#f0bc98]', label: 'High' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', label: 'Medium' },
  low: { bg: 'bg-[#edf3fb]', text: 'text-[#1e3a7a]', border: 'border-[#a8c1ea]', label: 'Low' },
};

export default function SecurityPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Security Score', value: 'B+', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Open Issues', value: '3', color: '#ef4444', bg: 'bg-red-50' },
          { label: 'Resolved', value: '47', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Scans Today', value: '18', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}><Shield size={18} /></div>
            <div><p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-semibold text-sm flex items-center gap-2"><Shield size={16} className="text-[#c9692a]" />Vulnerability Report</h3></div>
        <div className="divide-y divide-gray-50">
          {vulnerabilities.map((v, idx) => {
            const sc = severityConfig[v.severity];
            return (
              <div key={idx} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${sc.bg}`}><AlertTriangle size={16} className={sc.text} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border}`}>{sc.label}</span>
                    <p className="text-gray-800 text-sm font-medium">{v.title}</p>
                  </div>
                  <p className="text-gray-500 text-xs">{v.desc}</p>
                  <p className="text-gray-400 text-[10px] mt-1 flex items-center gap-1"><Clock size={9} />{v.time} - {v.resource}</p>
                </div>
                {v.status === 'open' ? <XCircle size={16} className="text-red-400 flex-shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
