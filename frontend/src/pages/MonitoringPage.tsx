import { Activity, Construction } from 'lucide-react';

export default function MonitoringPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total Requests', value: '—', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Avg Latency', value: '—', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Uptime', value: '—', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Active Alerts', value: '—', color: '#ef4444', bg: 'bg-red-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.bg} mb-3`} style={{ color: m.color }}>
              <Activity size={16} />
            </div>
            <p className="text-gray-800 text-2xl font-bold">{m.value}</p>
            <p className="text-gray-400 text-xs mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Construction size={24} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">Monitoring coming soon</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs">
            Real-time metrics, service health, and alerting will be available once the monitoring backend is connected.
          </p>
        </div>
      </div>
    </div>
  );
}
