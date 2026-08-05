import { Zap, Bot, CheckCircle2, Clock, Settings } from 'lucide-react';

const automations = [
  { name: 'Auto-Scale on High Load', trigger: 'CPU > 80% for 5 min', action: 'Scale out +2 pods', status: 'active', runs: 47, lastRun: '32m ago' },
  { name: 'Auto-Heal Failed Pods', trigger: 'Pod crash detected', action: 'Restart pod + alert', status: 'active', runs: 12, lastRun: '1h ago' },
  { name: 'Cost Alert', trigger: 'Daily spend > budget', action: 'Notify + suggest optimizations', status: 'active', runs: 5, lastRun: '6h ago' },
  { name: 'Security Patch', trigger: 'New CVE detected', action: 'Auto-patch + rebuild', status: 'paused', runs: 23, lastRun: '2d ago' },
  { name: 'Backup Rotation', trigger: 'Every 24 hours', action: 'Snapshot all databases', status: 'active', runs: 156, lastRun: '12h ago' },
  { name: 'Log Cleanup', trigger: 'Storage > 80%', action: 'Archive logs older than 30 days', status: 'active', runs: 8, lastRun: '3h ago' },
];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  active: { dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Active' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Paused' },
};

export default function AutomationPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Rules', value: '5', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Total Runs', value: '251', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Success Rate', value: '99.2%', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Time Saved', value: '42h', color: '#4a72c4', bg: 'bg-[#edf3fb]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}><Zap size={18} /></div>
            <div><p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {automations.map((auto) => {
          const sc = statusConfig[auto.status];
          return (
            <div key={auto.name} className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><Zap size={18} className="text-[#1e3a7a]" /></div>
                  <div><h3 className="text-gray-800 text-sm font-bold">{auto.name}</h3><span className={`inline-flex items-center gap-1.5 text-xs ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}</span></div>
                </div>
                <button className="text-gray-300 hover:text-[#c9692a] cursor-pointer"><Settings size={15} /></button>
              </div>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-16">Trigger:</span><span className="text-gray-700 font-medium">{auto.trigger}</span></div>
                <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-16">Action:</span><span className="text-gray-700 font-medium">{auto.action}</span></div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><CheckCircle2 size={11} />{auto.runs} runs</span>
                  <span className="flex items-center gap-1"><Clock size={11} />{auto.lastRun}</span>
                </div>
                <button className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${auto.status === 'active' ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#c9692a] text-white hover:bg-[#b85820]'}`}>
                  {auto.status === 'active' ? 'Pause' : 'Resume'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
