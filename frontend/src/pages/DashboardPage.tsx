import { useEffect, useState } from 'react';
import { Server, GitBranch, Rocket, XCircle, LayoutDashboard,
         FolderGit2, RefreshCw } from 'lucide-react';
import { listProjects, getMetricsOverview, timeAgo, parseDate,
         type Project, type MetricsOverview } from '@/api';
import { PageHeader, StatCard, EmptyState, LoadingState, ErrorBanner } from '@/components/ui';

const sc: Record<string, { dot: string; badge: string; label: string }> = {
  pending:   { dot: 'bg-gray-400',                badge: 'badge-neutral', label: 'Pending' },
  analyzing: { dot: 'bg-accent animate-pulse',    badge: 'badge-warning', label: 'Analyzing' },
  ready:     { dot: 'bg-emerald-500',             badge: 'badge-success', label: 'Ready' },
  deploying: { dot: 'bg-primary animate-pulse',   badge: 'badge-info',    label: 'Deploying' },
  deployed:  { dot: 'bg-gray-400',                badge: 'badge-neutral', label: 'Approved' },
  failed:    { dot: 'bg-red-500',                 badge: 'badge-danger',  label: 'Failed' },
};

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
    parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime()).slice(0, 6);

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Live workspace stats across all projects, deployments, and audits."
        icon={LayoutDashboard}
        actions={
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />
      {err && <ErrorBanner message={err} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Total projects" value={m?.projects.total ?? '—'}    icon={Server}    tone="primary" />
        <StatCard label="Plan approved"  value={m?.projects.deployed ?? '—'} icon={Rocket}    tone="success" />
        <StatCard label="Failed"         value={m?.projects.failed ?? '—'}   icon={XCircle}   tone="danger" />
        <StatCard label="Deployments"    value={m?.deployments.total ?? '—'} icon={GitBranch} tone="accent" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="card-header"><h2 className="section-title">Recent projects</h2><span className="text-xs text-gray-500">{projects.length} total</span></div>
          {loading && projects.length === 0 ? <LoadingState />
          : recent.length === 0 ? <EmptyState icon={FolderGit2} title="No projects yet" description={<>Go to <b className="font-medium text-gray-700">Projects</b> and create your first one.</>} />
          : <ul className="divide-y divide-gray-100">
              {recent.map((p) => {
                const cfg = sc[p.status] || sc.pending;
                const det = p.deployment_plan?.analysis?.static?.summary;
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50 sm:gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50"><GitBranch size={14} className="text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">{p.name}</p>
                      <p className="truncate text-xs text-gray-500">{det?.primary_language || 'pending'} / {det?.primary_framework || '—'} · {p.source_type}</p>
                    </div>
                    <span className={`badge ${cfg.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                    </span>
                    <span className="hidden w-16 text-right text-xs text-gray-500 sm:block">{timeAgo(p.created_at)}</span>
                  </li>
                );
              })}
            </ul>}
        </section>
        <section className="card overflow-hidden">
          <div className="card-header"><h2 className="section-title">Languages across projects</h2></div>
          <div className="p-5">
            {m && m.languages.length > 0 ? (
              <div className="space-y-2.5">
                {m.languages.map((l) => (
                  <div key={l.name} className="flex items-center gap-3">
                    <span className="w-28 truncate text-[13px] text-gray-700">{l.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(l.count / Math.max(m.projects.total, 1)) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right text-xs tabular-nums text-gray-500">{l.count}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-500">Analyze a project to see language breakdown.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
