import {
  Rocket, CheckCircle2, XCircle, Clock, Loader, GitBranch,
  Server, Cloud, Database, Boxes, ChevronRight, RotateCw,
} from 'lucide-react';

interface Stage { name: string; status: 'success' | 'running' | 'pending' | 'failed'; duration?: string; agent?: string; }
interface Deployment {
  id: string; project: string; version: string; environment: string;
  status: 'success' | 'running' | 'failed'; time: string; triggeredBy: string;
  stages: Stage[]; type: string; icon: React.ElementType;
}

const deployments: Deployment[] = [
  {
    id: 'dep-001', project: 'payment-gateway', version: 'v2.4.1', environment: 'Production',
    status: 'success', time: '2m ago', triggeredBy: 'CI/CD AI Agent', type: 'API Service', icon: Server,
    stages: [
      { name: 'Source', status: 'success', duration: '12s', agent: 'CI/CD AI' },
      { name: 'Build', status: 'success', duration: '2m 14s', agent: 'Docker AI' },
      { name: 'Scan', status: 'success', duration: '45s', agent: 'Security AI' },
      { name: 'Provision', status: 'success', duration: '1m 30s', agent: 'Terraform AI' },
      { name: 'Deploy', status: 'success', duration: '58s', agent: 'K8s AI' },
      { name: 'Health', status: 'success', duration: '30s', agent: 'Monitor AI' },
    ],
  },
  {
    id: 'dep-002', project: 'analytics-dashboard', version: 'v3.1.2', environment: 'Staging',
    status: 'running', time: '12m ago', triggeredBy: 'Kubernetes AI Agent', type: 'Full-Stack', icon: Database,
    stages: [
      { name: 'Source', status: 'success', duration: '8s', agent: 'CI/CD AI' },
      { name: 'Build', status: 'success', duration: '3m 22s', agent: 'Docker AI' },
      { name: 'Scan', status: 'success', duration: '52s', agent: 'Security AI' },
      { name: 'Provision', status: 'running', agent: 'Terraform AI' },
      { name: 'Deploy', status: 'pending' },
      { name: 'Health', status: 'pending' },
    ],
  },
  {
    id: 'dep-003', project: 'notification-engine', version: 'v0.8.5', environment: 'Development',
    status: 'failed', time: '32m ago', triggeredBy: 'admin@infragenie.io', type: 'Worker', icon: Boxes,
    stages: [
      { name: 'Source', status: 'success', duration: '10s', agent: 'CI/CD AI' },
      { name: 'Build', status: 'success', duration: '1m 45s', agent: 'Docker AI' },
      { name: 'Scan', status: 'failed', duration: '23s', agent: 'Security AI' },
      { name: 'Provision', status: 'pending' },
      { name: 'Deploy', status: 'pending' },
      { name: 'Health', status: 'pending' },
    ],
  },
  {
    id: 'dep-004', project: 'data-pipeline-etl', version: 'v4.0.0', environment: 'Production',
    status: 'success', time: '1h ago', triggeredBy: 'Docker AI Agent', type: 'Pipeline', icon: Cloud,
    stages: [
      { name: 'Source', status: 'success', duration: '15s', agent: 'CI/CD AI' },
      { name: 'Build', status: 'success', duration: '4m 02s', agent: 'Docker AI' },
      { name: 'Scan', status: 'success', duration: '1m 10s', agent: 'Security AI' },
      { name: 'Provision', status: 'success', duration: '2m 15s', agent: 'Terraform AI' },
      { name: 'Deploy', status: 'success', duration: '1m 20s', agent: 'K8s AI' },
      { name: 'Health', status: 'success', duration: '45s', agent: 'Monitor AI' },
    ],
  },
];

const stageIcon: Record<string, React.ElementType> = { success: CheckCircle2, running: Loader, pending: Clock, failed: XCircle };
const stageColor: Record<string, string> = { success: 'text-emerald-500', running: 'text-[#c9692a]', pending: 'text-gray-300', failed: 'text-red-500' };
const statusBadge: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  running: 'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  failed: 'bg-red-50 text-red-600 border-red-200',
};
const envColors: Record<string, string> = {
  Production: 'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  Staging: 'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  Development: 'bg-gray-100 text-gray-500 border-gray-200',
};

export default function DeploymentsPage() {
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Today', value: '24', icon: Rocket, color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Successful', value: '21', icon: CheckCircle2, color: '#059669', bg: 'bg-emerald-50' },
          { label: 'In Progress', value: '2', icon: Loader, color: '#c9692a', bg: 'bg-[#fdf3eb]' },
          { label: 'Failed', value: '1', icon: XCircle, color: '#ef4444', bg: 'bg-red-50' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}>
                <Icon size={18} className={s.label === 'In Progress' ? 'animate-spin' : ''} />
              </div>
              <div><p className="text-gray-800 text-xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p></div>
            </div>
          );
        })}
      </div>

      {deployments.map((dep) => {
        const Icon = dep.icon;
        const completed = dep.stages.filter((s) => s.status === 'success').length;
        const total = dep.stages.length;
        const progress = (completed / total) * 100;
        return (
          <div key={dep.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#edf3fb] flex items-center justify-center"><Icon size={16} className="text-[#1e3a7a]" /></div>
                <div>
                  <div className="flex items-center gap-2"><h3 className="text-gray-800 text-sm font-bold">{dep.project}</h3><span className="text-gray-400 text-xs font-mono">{dep.version}</span></div>
                  <p className="text-gray-400 text-xs">{dep.type} - Triggered by {dep.triggeredBy}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[dep.environment]}`}>{dep.environment}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge[dep.status]}`}>{dep.status.charAt(0).toUpperCase() + dep.status.slice(1)}</span>
                <span className="text-gray-400 text-xs flex items-center gap-1"><Clock size={11} />{dep.time}</span>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 hover:text-[#c9692a] cursor-pointer transition-colors"><RotateCw size={12} /></button>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${dep.status === 'failed' ? 'bg-red-500' : dep.status === 'running' ? 'bg-[#c9692a]' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
                </div>
                <span className="text-gray-400 text-xs font-medium">{completed}/{total}</span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {dep.stages.map((stage, idx) => {
                  const StageIcon = stageIcon[stage.status];
                  return (
                    <div key={stage.name} className="flex items-center gap-1 flex-shrink-0">
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                        stage.status === 'running' ? 'border-[#c9692a]/30 bg-[#fdf3eb]' :
                        stage.status === 'success' ? 'border-emerald-200 bg-emerald-50' :
                        stage.status === 'failed' ? 'border-red-200 bg-red-50' :
                        'border-gray-100 bg-gray-50'
                      }`}>
                        <StageIcon size={14} className={`${stageColor[stage.status]} ${stage.status === 'running' ? 'animate-spin' : ''}`} />
                        <div className="min-w-0">
                          <p className="text-gray-800 text-xs font-medium whitespace-nowrap">{stage.name}</p>
                          <p className="text-gray-400 text-[10px] whitespace-nowrap">{stage.duration || (stage.status === 'running' ? 'In progress...' : 'Queued')}</p>
                        </div>
                      </div>
                      {idx < dep.stages.length - 1 && <ChevronRight size={14} className="text-gray-200 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
              {dep.status === 'running' && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#fdf3eb] border border-[#f0bc98]">
                  <Loader size={12} className="text-[#c9692a] animate-spin" />
                  <p className="text-[#c9692a] text-xs">Terraform AI Agent is provisioning infrastructure resources...</p>
                </div>
              )}
              {dep.status === 'failed' && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
                  <XCircle size={12} className="text-red-500" />
                  <p className="text-red-600 text-xs">Security AI Agent detected a vulnerability. Deployment halted. View logs for details.</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
