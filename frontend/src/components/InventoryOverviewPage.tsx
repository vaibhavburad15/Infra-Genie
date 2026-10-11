/**
 * Shared body for the Security / Cost / Pipelines / AI Insights pages, which all
 * render the same live inventory roll-up with a page-specific heading.
 */
import { useEffect, useState } from 'react';
import {
  Shield, DollarSign, GitBranch, Lightbulb, RefreshCw,
  FolderGit2, Rocket, XCircle, Container, type LucideIcon,
} from 'lucide-react';
import { getMetricsOverview, listProjects, type MetricsOverview, type Project } from '@/api';
import { PageHeader, StatCard, EmptyState, LoadingState, ErrorBanner } from '@/components/ui';

export type InventoryVariant = 'security' | 'cost' | 'pipelines' | 'insights';

const VARIANTS: Record<InventoryVariant, { title: string; description: string; icon: LucideIcon }> = {
  security:  { title: 'Security',          description: 'Real security signal across your deployments.',          icon: Shield },
  cost:      { title: 'Cost Intelligence', description: 'Live cost roll-up from your projects and deployments.',  icon: DollarSign },
  pipelines: { title: 'Pipelines',         description: 'Your projects, reimagined as deployable pipelines.',     icon: GitBranch },
  insights:  { title: 'AI Insights',       description: 'Auto-generated insights from your project inventory.',  icon: Lightbulb },
};

const STATUS_BADGE: Record<string, string> = {
  ready: 'badge-success',
  deployed: 'badge-success',
  analyzing: 'badge-info',
  deploying: 'badge-info',
  failed: 'badge-danger',
};

export default function InventoryOverviewPage({ variant }: { variant: InventoryVariant }) {
  const { title, description, icon } = VARIANTS[variant];
  const [m, setM] = useState<MetricsOverview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true); setErr('');
      setM(await getMetricsOverview());
      setProjects(await listProjects());
    } catch (e: any) { setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        actions={
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {loading && !m ? (
        <div className="card"><LoadingState /></div>
      ) : err ? (
        <ErrorBanner message={err} />
      ) : m ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <StatCard label="Projects"    value={m.projects.total}    icon={FolderGit2} tone="primary" />
            <StatCard label="Deployed"    value={m.projects.deployed} icon={Rocket}     tone="success" />
            <StatCard label="Failed"      value={m.projects.failed}   icon={XCircle}    tone="danger" />
            <StatCard label="Dockerfiles" value={m.with_docker}       icon={Container}  tone="accent" />
          </div>

          <section className="card overflow-hidden">
            <div className="card-header">
              <h2 className="section-title">Inventory across projects</h2>
              <span className="text-xs text-gray-500">{projects.length} total</span>
            </div>
            {projects.length === 0 ? (
              <EmptyState
                icon={FolderGit2}
                title="No projects yet"
                description="Create a project and run analysis to populate this view."
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {projects.slice(0, 12).map((p) => {
                  const det = p.deployment_plan?.analysis?.static;
                  const tags = [
                    det?.containerization?.has_dockerfile && 'Docker',
                    det?.ci_cd?.present && 'CI',
                    det?.has_database_hint && 'Database',
                  ].filter(Boolean) as string[];
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary">
                        <FolderGit2 size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800">{p.name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {det?.summary?.primary_language ?? '—'} / {det?.summary?.primary_framework ?? '—'}
                        </p>
                      </div>
                      <div className="hidden gap-1.5 sm:flex">
                        {tags.map((t) => <span key={t} className="badge badge-neutral">{t}</span>)}
                      </div>
                      <span className={`badge capitalize ${STATUS_BADGE[p.status] ?? 'badge-neutral'}`}>{p.status}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
