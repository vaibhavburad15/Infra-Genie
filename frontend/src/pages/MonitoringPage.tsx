import { useEffect, useState } from 'react';
import { Activity, Loader, AlertTriangle, RefreshCw, Clock, Server } from 'lucide-react';
import { getMetricsOverview, listProjects, type Project, type MetricsOverview } from '@/api';

export default function MonitoringPage() {
  const [m, setM] = useState<MetricsOverview | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);

  const load = async () => {
    try { setLoading(true); setErr(''); setM(await getMetricsOverview()); setProjects(await listProjects()); }
    catch (e: any) { setErr(e.message || 'Failed to load metrics'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-800 font-bold text-lg">Monitoring</h2>
          <p className="text-gray-400 text-xs">Live service health backed by your real deployment data.</p>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader size={20} className="animate-spin text-[#c9692a] mr-2" /><span className="text-gray-400 text-sm">Loading metrics…</span></div>
      ) : err ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <AlertTriangle size={16} className="text-red-500" /><p className="text-red-600 text-sm">{err}</p>
        </div>
      ) : m ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Total Projects', value: m.projects.total, color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
              { label: 'Successfully Deployed', value: m.projects.deployed, color: '#059669', bg: 'bg-emerald-50' },
              { label: 'Running Deploys', value: m.deployments.running, color: '#c9692a', bg: 'bg-[#fdf3eb]' },
              { label: 'Avg Deploy Time', value: `${m.deployments.avg_duration_seconds || 0}s`, color: '#4a72c4', bg: 'bg-[#edf3fb]' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg} mb-3`} style={{ color: s.color }}><Activity size={16} /></div>
                <p className="text-gray-800 text-2xl font-bold">{s.value}</p><p className="text-gray-400 text-xs">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-bold text-sm">Recent projects</h3></div>
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {projects.slice(0, 8).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center"><Server size={14} className="text-[#1e3a7a]" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium truncate">{p.name}</p>
                      <p className="text-gray-400 text-xs">{p.detailed_analysis?.summary?.primary_language || 'pending'} / {p.detailed_analysis?.summary?.primary_framework || '—'}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{p.status}</span>
                  </div>
                ))}
                {projects.length === 0 && <p className="px-5 py-6 text-gray-400 text-sm text-center">No projects yet</p>}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-gray-800 font-bold text-sm">Language distribution</h3></div>
              <div className="p-5 space-y-2">
                {m.languages.length === 0 && <p className="text-sm text-gray-400">No analyzed projects yet.</p>}
                {m.languages.map((l) => (
                  <div key={l.name} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 w-32 truncate font-medium">{l.name}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-[#1e3a7a]" style={{ width: `${(l.count / Math.max(m.projects.total, 1)) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-6 text-right">{l.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}