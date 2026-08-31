import { Shield, Construction } from 'lucide-react';

export default function SecurityPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Security Score', value: '—', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Open Issues', value: '—', color: '#ef4444', bg: 'bg-red-50' },
          { label: 'Resolved', value: '—', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Scans Today', value: '—', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}>
              <Shield size={18} />
            </div>
            <div><p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-gray-800 font-semibold text-sm flex items-center gap-2">
            <Shield size={16} className="text-[#c9692a]" />Vulnerability Report
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#fdf3eb] flex items-center justify-center mb-4">
            <Construction size={24} className="text-[#c9692a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">Security scanning coming soon</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs">
            Vulnerability scanning via the Security AI Agent will be available in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}
