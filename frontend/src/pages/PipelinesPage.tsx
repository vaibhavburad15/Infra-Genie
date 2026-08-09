import { GitBranch, CheckCircle2, Clock, XCircle, Loader, ChevronRight } from 'lucide-react';

const pipelines: { name: string; project: string; status: string; lastRun: string; duration: string; stages: number; trigger: string }[] = [];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string; icon: typeof CheckCircle2 }> = {
  success: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Success', icon: CheckCircle2 },
  running: { dot: 'bg-[#c9692a] animate-pulse', text: 'text-[#c9692a]', bg: 'bg-[#fdf3eb]', label: 'Running', icon: Loader },
  failed: { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Failed', icon: XCircle },
};

export default function PipelinesPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Pipelines', value: '12', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Running', value: '1', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Success Rate', value: '96.2%', color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Avg Duration', value: '4m 18s', color: '#4a72c4', bg: 'bg-[#edf3fb]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg} mb-3`}><GitBranch size={16} style={{ color: s.color }} /></div>
            <p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-semibold text-sm">CI/CD Pipelines</h3></div>
        <div className="divide-y divide-gray-50">
          {pipelines.map((p) => {
            const sc = statusConfig[p.status];
            const Icon = sc.icon;
            return (
              <div key={p.name} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer">
                <div className="w-9 h-9 rounded-xl bg-[#edf3fb] flex items-center justify-center"><GitBranch size={15} className="text-[#1e3a7a]" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 text-sm font-medium">{p.name}</p>
                  <p className="text-gray-400 text-xs">{p.project} - {p.trigger}</p>
                </div>
                <div className="hidden md:flex items-center gap-1 text-gray-400 text-xs"><Clock size={11} />{p.duration}</div>
                <div className="hidden sm:flex items-center gap-1 text-gray-400 text-xs">{p.stages} stages</div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}><Icon size={12} className={p.status === 'running' ? 'animate-spin' : ''} />{sc.label}</span>
                <span className="text-gray-400 text-xs">{p.lastRun}</span>
                <ChevronRight size={14} className="text-gray-300" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
