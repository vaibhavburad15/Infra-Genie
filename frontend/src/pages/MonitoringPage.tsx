import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Server, FolderGit2, Rocket, Loader, Timer } from 'lucide-react';
import { getMetricsOverview, listProjects, type Project, type MetricsOverview } from '@/api';
import { PageHeader, StatCard, EmptyState, LoadingState, ErrorBanner } from '@/components/ui';

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
    <div className="page">
      <PageHeader
        title="Monitoring"
        description="Live service health backed by your real deployment data."
        icon={Activity}
        actions={
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {loading && !m ? (
        <div className="card"><LoadingState label="Loading metrics…" /></div>
      ) : err ? (
        <ErrorBanner message={err} />
      ) : m ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <StatCard label="Total projects"        value={m.projects.total}                             icon={FolderGit2} tone="primary" />
            <StatCard label="Successfully deployed" value={m.projects.deployed}                          icon={Rocket}     tone="success" />
            <StatCard label="Running deploys"       value={m.deployments.running}                        icon={Loader}     tone="accent" />
            <StatCard label="Avg deploy time"       value={`${m.deployments.avg_duration_seconds || 0}s`} icon={Timer}      tone="info" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="card overflow-hidden">
              <div className="card-header"><h2 className="section-title">Recent projects</h2></div>
              {projects.length === 0 ? (
                <EmptyState icon={Server} title="No projects yet" description="Projects you create will appear here." />
              ) : (
                <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
                  {projects.slice(0, 8).map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50"><Server size={14} className="text-primary" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800">{p.name}</p>
                        <p className="truncate text-xs text-gray-500">{p.deployment_plan?.analysis?.static?.summary?.primary_language || 'pending'} / {p.deployment_plan?.analysis?.static?.summary?.primary_framework || '—'}</p>
                      </div>
                      <span className="badge badge-neutral capitalize">{p.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card overflow-hidden">
              <div className="card-header"><h2 className="section-title">Language distribution</h2></div>
              <div className="space-y-2.5 p-5">
                {m.languages.length === 0 && <p className="text-sm text-gray-500">No analyzed projects yet.</p>}
                {m.languages.map((l) => (
                  <div key={l.name} className="flex items-center gap-3">
                    <span className="w-32 truncate text-[13px] font-medium text-gray-700">{l.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(l.count / Math.max(m.projects.total, 1)) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right text-xs tabular-nums text-gray-500">{l.count}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
