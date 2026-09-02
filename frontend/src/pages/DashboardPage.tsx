import { useEffect, useState } from 'react';
import { Server, GitBranch, Rocket, Activity, Loader,
         FolderGit2, AlertTriangle, RefreshCw } from 'lucide-react';
import { listProjects, getMetricsOverview,
         type Project, type MetricsOverview } from '@/api';

const sc: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  pending:   { dot: 'bg-gray-400', text: 'text-gray-500', bg: 'bg-gray-100', label: 'Pending' },
  analyzing: { dot: 'bg-[#c9692a] animate-pulse', text: 'text-[#c9692a]', bg: 'bg-[#fdf3eb]', label: 'Analyzing' },
  ready:     { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Ready' },
  deploying: { dot: 'bg-[#1e3a7a] animate-pulse', text: 'text-[#1e3a7a]', bg: 'bg-[#edf3fb]', label: 'Deploying' },
  deployed:  { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Deployed' },
  failed:    { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
};

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [m, setM] = useState<MetricsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const load = async () => {
    try { setLoading(true); setErr('');
      setProjects(await listProjects()); setM(await getMetricsOverview());
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const recent = [...projects].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-800 font-bold text-lg">Overview</h2>
          <p className="text-gray-400 text-xs">Live workspace stats across all projects, deployments, and audits.</p>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer transition-colors"><RefreshCw size={14} /></button>
      </div>
      {err && <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200"><AlertTriangle size={16} className="text-red-500" /><p className="text-red-600 text-sm">{err}</p></div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', value: m?.projects.total ?? '—', icon: Server, color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Deployed', value: m?.projects.deployed ?? '—', icon: Rocket, color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Failed', value: m?.projects.failed ?? '—', icon: Activity, color: '#ef4444', bg: 'bg-red-50' },
          { label: 'Deployments (success)', value: m?.deployments.success ?? '—', icon: GitBranch, color: '#c9692a', bg: 'bg-[#fdf3eb]' },
        ].map((s) => {
          const I = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: s.bg.replace('bg-', '') === 'edf3fb' ? '#edf3fb' : s.bg === 'bg-emerald-50' ? '#ecfdf5' : s.bg === 'bg-red-50' ? '#fef2f2' : '#fdf3eb' }}><I size={20} style={{ color: s.color }} /></div>
              <p className="text-gray-800 text-2xl font-bold">{s.value}</p>
              <p className="text-gray-400 text-xs mt-1">{s.label}</p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-bold text-sm">Recent projects</h3><span className="text-gray-400 text-xs">{projects.length} total</span></div>
          {loading ? <div className="flex items-center justify-center py-16"><Loader size={20} className="animate-spin text-[#c9692a] mr-2" /><span className="text-gray-400 text-sm">Loading…</span></div>
          : recent.length === 0 ? <div className="flex flex-col items-center justify-center py-16 text-center px-6"><div className="w-12 h-12 rounded-xl bg-[#edf3fb] flex items-center justify-center mb-3"><FolderGit2 size={22} className="text-[#1e3a7a]" /></div><p className="text-gray-800 text-sm font-semibold">No projects yet</p><p className="text-gray-400 text-xs mt-1">Go to <b>Projects</b> and create your first one.</p></div>
          : <div className="divide-y divide-gray-50">
              {recent.map((p) => {
                const cfg = sc[p.status] || sc.pending;
                const det = p.detailed_analysis?.summary;
                return (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center flex-shrink-0"><GitBranch size={14} className="text-[#1e3a7a]" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium truncate">{p.name}</p>
                      <p className="text-gray-400 text-xs truncate">{det?.primary_language || 'pending'} / {det?.primary_framework || '—'} · {p.source_type}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                    </span>
                    <span className="text-gray-400 text-xs">{timeAgo(p.created_at)}</span>
                  </div>
                );
              })}
            </div>}
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-gray-800 font-bold text-sm mb-4">Languages across projects</h3>
          {m && m.languages.length > 0 ? (
            <div className="space-y-2">
              {m.languages.map((l) => (
                <div key={l.name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate">{l.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-[#c9692a]" style={{ width: `${(l.count / Math.max(m.projects.total, 1)) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-6 text-right">{l.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-gray-400 text-sm">Analyze a project to see language breakdown.</p>}
        </div>
      </div>
    </div>
  );
}