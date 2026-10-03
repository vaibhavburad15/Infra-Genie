import { useEffect, useState } from 'react';
import {
  Rocket, CheckCircle2, XCircle, Clock, Loader, ChevronRight,
  AlertTriangle, RefreshCw, Users, Hourglass, ShieldCheck, Eye,
} from 'lucide-react';
import {
  listProjects, listDeployments, listAWSConnections, createDeployment,
  timeAgo, parseDate, ForbiddenError,
  type Project, type CloudAccountOut, type Deployment,
} from '@/api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DeploymentsPageProps {
  /** Called when the user clicks "Review plan" on a deployment card.
   *  The parent (Dashboard in App.tsx) switches to DeploymentReviewPage. */
  onReviewDeployment?: (deploymentId: string, projectName?: string) => void;
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const statusBadge: Record<string, string> = {
  planning:          'bg-amber-50 text-amber-700 border-amber-200',
  plan_ready:        'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  awaiting_approval: 'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  approved:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  applying:          'bg-amber-50 text-amber-700 border-amber-200',
  deployed:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:          'bg-gray-100 text-gray-600 border-gray-200',
  failed:            'bg-red-50 text-red-600 border-red-200',
  pending:           'bg-gray-100 text-gray-500 border-gray-200',
  running:           'bg-gray-100 text-gray-500 border-gray-200',
  success:           'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const statusLabel: Record<string, string> = {
  planning:          'preparing Terraform plan',
  plan_ready:        'plan ready · awaiting review',
  awaiting_approval: 'awaiting approval',
  approved:          'approved · ready to apply',
  applying:          'applying Terraform',
  deployed:          'deployed',
  rejected:          'rejected',
  failed:            'failed',
  pending:           'pending',
  running:           'legacy: running',
  success:           'legacy: success',
};

const envColors: Record<string, string> = {
  production:  'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  staging:     'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  development: 'bg-gray-100 text-gray-500 border-gray-200',
};

function actionColor(action: string) {
  if (action === 'destroy' || action === 'replace') return 'text-red-700 bg-red-100';
  if (action === 'modify') return 'text-amber-700 bg-amber-100';
  return 'text-emerald-700 bg-emerald-100';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DeploymentsPage({ onReviewDeployment }: DeploymentsPageProps) {
  const [projects, setProjects]       = useState<Project[]>([]);
  const [accounts, setAccounts]       = useState<CloudAccountOut[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [projectMap, setProjectMap]   = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showCreate, setShowCreate]   = useState(false);
  const [projectId, setProjectId]     = useState('');
  const [accountId, setAccountId]     = useState('');
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const [ps, awsAccounts] = await Promise.all([listProjects(), listAWSConnections()]);
      setProjects(ps);
      setAccounts(awsAccounts);
      const map: Record<string, string> = {};
      ps.forEach((p) => { map[p.id] = p.name; });
      setProjectMap(map);

      const all: Deployment[] = [];
      await Promise.all(ps.map(async (p) => {
        try {
          all.push(...(await listDeployments(p.id) as Deployment[]));
        } catch {
          // A project may not have deployment records yet.
        }
      }));
      all.sort((a, b) => parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime());
      setDeployments(all);
    } catch (e: any) {
      if (e instanceof ForbiddenError) setError('__no_org__');
      else setError(e.message || 'Failed to load deployments');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Auto-refresh while planning is in progress
  const needsRefresh = deployments.some((d) =>
    ['planning', 'approved', 'applying'].includes(d.status));
  useEffect(() => {
    if (!needsRefresh) return;
    const timer = setInterval(() => { void load(true); }, 5000);
    return () => clearInterval(timer);
  }, [needsRefresh]);

  // ── Create plan ─────────────────────────────────────────────────────────────

  const availableProjects = projects.filter((p) =>
    ['ready', 'deployed'].includes(p.status) && Boolean(p.deployment_plan?.terraform));
  const usableAccounts = accounts.filter((a) =>
    a.status === 'CONNECTED' && Boolean(a.discovery_ran_at));

  const openCreate = () => {
    setProjectId(availableProjects[0]?.id || '');
    setAccountId(usableAccounts[0]?.id || '');
    setCreateError('');
    setShowCreate(true);
  };

  const startPlanning = async () => {
    if (!projectId || !accountId) return;
    try {
      setCreating(true);
      setCreateError('');
      await createDeployment({ project_id: projectId, cloud_account_id: accountId });
      setShowCreate(false);
      await load(true);
    } catch (e: any) {
      setCreateError(e.message || 'Could not start deployment planning.');
    } finally {
      setCreating(false);
    }
  };

  // ── Open the dedicated review page ──────────────────────────────────────────

  const handleReview = (dep: Deployment) => {
    const name = projectMap[dep.project_id] || undefined;
    if (onReviewDeployment) {
      onReviewDeployment(dep.id, name);
    }
  };

  // ── Derived counts ──────────────────────────────────────────────────────────

  const pendingApprovalCount = deployments.filter((d) =>
    ['plan_ready', 'awaiting_approval'].includes(d.status)).length;
  const applyingCount   = deployments.filter((d) => ['approved', 'applying'].includes(d.status)).length;
  const deployedCount   = deployments.filter((d) => ['deployed', 'success'].includes(d.status)).length;
  const failedCount     = deployments.filter((d) => d.status === 'failed').length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full bg-[#f4f6fa]">

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total plans',    value: deployments.length,                       icon: Rocket,       color: '#1e3a7a', bg: '#edf3fb' },
          { label: 'Awaiting review', value: pendingApprovalCount,                    icon: Clock,        color: '#1e3a7a', bg: '#edf3fb' },
          { label: 'Applying',       value: applyingCount,                            icon: Hourglass,    color: '#c9692a', bg: '#fdf3eb' },
          { label: 'Deployed / failed', value: `${deployedCount} / ${failedCount}`,  icon: CheckCircle2, color: '#15803d', bg: '#ecfdf5' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: s.bg }}>
                <Icon size={18} style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-gray-800 text-xl font-bold">{s.value}</p>
                <p className="text-gray-400 text-xs">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-gray-800 font-semibold text-sm">Deployment plans</h3>
          <p className="text-gray-400 text-xs mt-1">
            Terraform changes are reviewed before an approved plan can be applied.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-[#1e3a7a] cursor-pointer"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1e3a7a] text-white text-xs font-semibold hover:bg-[#162d5f] cursor-pointer"
          >
            <Rocket size={14} /> Create plan
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader size={20} className="text-[#c9692a] animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading deployments…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        error === '__no_org__' ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl">
            <Users size={28} className="text-[#1e3a7a] mb-4" />
            <p className="text-gray-800 font-semibold text-sm">No organization yet</p>
            <p className="text-gray-500 text-xs mt-2 max-w-xs">
              Join an organization or create one in Settings before planning deployments.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={() => void load()} className="ml-auto text-xs text-red-500 hover:underline cursor-pointer">Retry</button>
          </div>
        )
      )}

      {/* Empty */}
      {!loading && !error && deployments.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Rocket size={24} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">No deployment plans yet</p>
          <p className="text-gray-400 text-xs mt-1 max-w-md">
            Analyze a project, connect an AWS account, and run discovery before creating the first plan.
          </p>
        </div>
      )}

      {/* Deployment cards */}
      {!loading && !error && deployments.map((dep) => {
        const summary = dep.plan_summary;
        const busy    = ['planning', 'approved', 'applying'].includes(dep.status);
        const canReview = ['plan_ready', 'awaiting_approval'].includes(dep.status) && Boolean(summary);

        return (
          <div key={dep.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#edf3fb] flex items-center justify-center">
                  <Rocket size={16} className="text-[#1e3a7a]" />
                </div>
                <div>
                  <h3 className="text-gray-800 text-sm font-bold">
                    {projectMap[dep.project_id] || dep.project_id}
                  </h3>
                  <p className="text-gray-400 text-xs font-mono">{dep.id.slice(0, 8)}…</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[dep.environment] ?? envColors.development}`}>
                  {dep.environment}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge[dep.status] ?? statusBadge.pending}`}>
                  {statusLabel[dep.status] ?? dep.status.replace(/_/g, ' ')}
                </span>
                <span className="text-gray-400 text-xs flex items-center gap-1">
                  <Clock size={11} />{timeAgo(dep.created_at)}
                </span>
              </div>
            </div>

            {/* Card body */}
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">AWS region</p>
                  <p className="text-gray-600">{dep.region || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Started</p>
                  <p className="text-gray-600">{timeAgo(dep.started_at)}</p>
                </div>
                <div>
                  <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Plan created</p>
                  <p className="text-gray-600">{timeAgo(dep.plan_created_at ?? dep.completed_at)}</p>
                </div>
                <div>
                  <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Approved</p>
                  <p className="text-gray-600">{timeAgo(dep.approved_at)}</p>
                </div>
              </div>

              {/* Plan summary badges */}
              {summary && (
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">
                    Create {summary.create}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">
                    Modify {summary.modify}
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg ${summary.destroy || summary.replace ? 'bg-red-100 text-red-800 font-semibold' : 'bg-gray-100 text-gray-600'}`}>
                    Destroy {summary.destroy}
                  </span>
                  {summary.replace > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-800 font-semibold">
                      Replace {summary.replace}
                    </span>
                  )}
                </div>
              )}

              {/* In-progress banner */}
              {busy && (
                <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <Loader size={13} className="animate-spin" />
                  {dep.status === 'planning'
                    ? 'Generating workspace and running terraform init, validate, and plan…'
                    : 'Approved — waiting for the apply phase to be triggered.'}
                </div>
              )}

              {/* APPROVED state — nothing is applying, show clear message */}
              {dep.status === 'approved' && !busy && (
                <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                  <CheckCircle2 size={13} />
                  Deployment approved. No AWS infrastructure has been created yet.
                </div>
              )}

              {/* Review CTA — navigates to the dedicated review page */}
              {canReview && (
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px] px-3 py-2 rounded-xl bg-[#edf3fb] border border-[#a8c1ea] flex items-center gap-2">
                    <Clock size={13} className="text-[#1e3a7a]" />
                    <p className="text-[#1e3a7a] text-xs font-medium">
                      Review the Terraform changes before approving.
                    </p>
                  </div>
                  <button
                    onClick={() => handleReview(dep)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1e3a7a] text-white text-xs font-semibold hover:bg-[#162d5f] cursor-pointer"
                    aria-label={`Review plan for ${projectMap[dep.project_id] || 'deployment'}`}
                  >
                    <Eye size={13} /> Review plan
                  </button>
                </div>
              )}

              {/* Legacy: plan ready but no summary */}
              {['plan_ready', 'awaiting_approval'].includes(dep.status) && !summary && (
                <div className="mt-4 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-gray-600 text-xs">
                  Legacy deployment record without a Terraform plan. Create a new plan to review current infrastructure changes.
                </div>
              )}

              {/* Terraform outputs (post-deploy) */}
              {dep.status === 'deployed' && dep.deployment_outputs && (
                <details className="mt-4">
                  <summary className="text-xs text-emerald-700 cursor-pointer font-semibold">
                    View Terraform outputs
                  </summary>
                  <pre className="mt-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-48">
                    {JSON.stringify(dep.deployment_outputs, null, 2)}
                  </pre>
                </details>
              )}

              {/* Error message */}
              {(dep.status === 'failed' || dep.error_message) && (
                <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
                  <XCircle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-red-700 text-xs whitespace-pre-wrap">
                    {dep.error_message || 'Deployment failed. Review worker logs for details.'}
                  </p>
                </div>
              )}

              {/* Collapsible plan text (for non-pending non-awaiting states) */}
              {dep.terraform_plan && !['awaiting_approval', 'plan_ready'].includes(dep.status) && (
                <details className="mt-4">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
                    <ChevronRight size={12} /> View Terraform plan output
                  </summary>
                  <pre className="mt-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-64">
                    {dep.terraform_plan}
                  </pre>
                </details>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Create plan modal ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-gray-900 font-bold text-lg">Create deployment plan</h2>
              <p className="text-gray-500 text-xs mt-1">
                Select an analyzed project and a discovered AWS account. This runs Terraform plan only — nothing is deployed.
              </p>
            </div>

            <label className="block text-xs font-semibold text-gray-700">
              Project
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1.5 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                disabled={!availableProjects.length}
              >
                {!availableProjects.length && (
                  <option value="">No analyzed project with Terraform artifacts</option>
                )}
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-gray-700">
              AWS account
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1.5 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                disabled={!usableAccounts.length}
              >
                {!usableAccounts.length && (
                  <option value="">No connected account with discovery results</option>
                )}
                {usableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_id} · {a.region}</option>
                ))}
              </select>
            </label>

            <div className="px-3 py-2.5 rounded-xl border border-blue-100 bg-blue-50 text-blue-800 text-xs flex gap-2">
              <ShieldCheck size={15} className="shrink-0" />
              No resources are changed while the plan is being generated. Apply requires a separate approval.
            </div>

            {createError && <p className="text-red-600 text-xs">{createError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                disabled={creating}
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={creating || !projectId || !accountId}
                onClick={() => void startPlanning()}
                className="px-4 py-2 rounded-lg bg-[#1e3a7a] text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {creating && <Loader size={13} className="animate-spin" />}
                {creating ? 'Starting…' : 'Generate plan'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
