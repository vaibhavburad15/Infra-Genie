import { Server, Cloud, Database, Cpu, HardDrive, Network, Boxes, Layers, Activity } from 'lucide-react';

const resources: { name: string; provider: string; count: number; region: string; status: string; icon: any; color: string }[] = [];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Healthy' },
  degraded: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Degraded' },
};

export default function InfrastructurePage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Resources', value: '248', icon: Server, color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Cloud Providers', value: '3', icon: Cloud, color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Regions', value: '7', icon: Activity, color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Avg Health', value: '98.7%', icon: Activity, color: '#4a72c4', bg: 'bg-[#edf3fb]' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}><Icon size={18} /></div>
              <div><p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p></div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-semibold text-sm">Infrastructure Resources</h3></div>
        <div className="divide-y divide-gray-50">
          {resources.map((res) => {
            const Icon = res.icon;
            const sc = statusConfig[res.status];
            return (
              <div key={res.name} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${res.color}15`, color: res.color }}><Icon size={16} /></div>
                <div className="flex-1 min-w-0"><p className="text-gray-800 text-sm font-medium">{res.name}</p><p className="text-gray-400 text-xs">{res.provider} - {res.region}</p></div>
                <span className="text-gray-800 text-sm font-bold">{res.count}</span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
