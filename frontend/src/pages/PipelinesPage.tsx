import { useEffect, useState } from 'react';
import { Shield, DollarSign, Zap, Server, GitBranch, Lightbulb,
         Loader, AlertTriangle, RefreshCw } from 'lucide-react';
import { getMetricsOverview, listProjects,
         type MetricsOverview, type Project } from '@/api';

const ICONS: Record<string, any> = { Shield, DollarSign, Zap,
                                     Server, GitBranch, Lightbulb };
const TITLES: Record<string, string> = {
  SecurityPage: 'Security',
  CostPage: 'Cost Intelligence',
  AutomationPage: 'Automation',
  InfrastructurePage: 'Infrastructure',
  PipelinesPage: 'Pipelines',
  InsightsPage: 'AI Insights',
};
const SUBS: Record<string, string> = {
  SecurityPage: 'Real security signal across your deployments.',
  CostPage: 'Live cost roll-up from your projects and deployments.',
  AutomationPage: 'Real automation cadence from your projects.',
  InfrastructurePage: 'Live inventory of the code in your account.',
  PipelinesPage: 'Your projects, reimagined as deployable pipelines.',
  InsightsPage: 'Auto-generated insights from your project inventory.',
};
const PAGE = (import.meta as any).url.split('/').pop().split('?')[0].replace('.tsx','');
const Icon = ICONS[({SecurityPage:'Shield',CostPage:'DollarSign',AutomationPage:'Zap',InfrastructurePage:'Server',PipelinesPage:'GitBranch',InsightsPage:'Lightbulb'} as any)[PAGE]];
const accent = PAGE === 'SecurityPage' ? '#ef4444'
  : PAGE === 'CostPage' ? '#059669'
  : PAGE === 'AutomationPage' ? '#c9692a'
  : PAGE === 'PipelinesPage' ? '#4a72c4' : '#1e3a7a';

export default function Page() {
  const [m, setM] = useState<MetricsOverview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setLoading(true); setErr('');
      setM(await getMetricsOverview());
      setProjects(await listProjects());
    } catch (e: any) { setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-800 font-bold text-lg flex items-center gap-2">
            <Icon size={18} style={{ color: accent }} /> {TITLES[PAGE]}
          </h2>
          <p className="text-gray-400 text-xs">{SUBS[PAGE]}</p>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer">
          <RefreshCw size={14} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader size={20} className="animate-spin text-[#c9692a] mr-2" /><span className="text-gray-400 text-sm">Loading…</span></div>
      ) : err ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200"><AlertTriangle size={16} className="text-red-500" /><p className="text-red-600 text-sm">{err}</p></div>
      ) : m ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Projects', value: m.projects.total },
              { label: 'Deployed', value: m.projects.deployed },
              { label: 'Failed', value: m.projects.failed },
              { label: 'Dockerfiles', value: m.with_docker },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: '#edf3fb' }}>
                  <Icon size={16} style={{ color: accent }} />
                </div>
                <p className="text-gray-800 text-2xl font-bold">{s.value}</p>
                <p className="text-gray-400 text-xs">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-gray-800 font-bold text-sm">Inventory across projects</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {projects.length === 0 ? (
                <p className="px-5 py-10 text-center text-gray-400 text-sm">No projects yet — create one and run analysis.</p>
              ) : projects.slice(0, 12).map((p) => {
                const det = p.detailed_analysis?.summary;
                const ci = p.detailed_analysis?.ci_cd;
                const container = p.detailed_analysis?.containerization;
                return (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
                      <Icon size={14} style={{ color: accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium truncate">{p.name}</p>
                      <p className="text-gray-400 text-xs truncate">
                        {det?.primary_language ?? '—'} / {det?.primary_framework ?? '—'}
                        {container?.has_dockerfile && ' · 🐳 Docker'}
                        {ci?.present && ' · ⚙️ CI'}
                        {p.detailed_analysis?.has_database_hint && ' · 💾 DB'}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{p.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}