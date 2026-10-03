/**
 * DeploymentReviewPage.tsx
 *
 * Dedicated full-page review UI for a single deployment plan.
 *
 * Flow this page supports:
 *   PLANNING        — show spinner, auto-refresh until plan is ready
 *   PLAN_READY /
 *   AWAITING_APPROVAL — show full plan, checkbox + Approve / Reject buttons
 *   APPROVED        — show success confirmation, no "deployed" claim
 *   REJECTED        — show rejection state with back link
 *   FAILED          — show error detail
 *
 * Security:
 *   • Never displays AWS credentials, session tokens, or the role ARN.
 *   • Approval requires explicit checkbox acknowledgement.
 *   • The Approve button remains disabled until checkbox is checked.
 *   • Clicking Approve sends POST /api/deployments/{id}/approve {approved: true}.
 *     Nothing else happens — terraform apply is NOT triggered.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Loader,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Clock,
  RefreshCw,
  Hourglass,
  Info,
  Server,
} from 'lucide-react';
import {
  getDeployment,
  getDeploymentPlan,
  approveDeployment,
  type Deployment,
  type DeploymentPlanReview,
} from '@/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeploymentReviewPageProps {
  deploymentId: string;
  projectName?: string;         // passed from DeploymentsPage for display
  onBack: () => void;           // navigate back to deployments list
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const POLLING_STATUSES = new Set(['planning', 'draft']);
const READY_STATUSES   = new Set(['plan_ready', 'awaiting_approval']);

function actionColor(action: string): string {
  if (action === 'destroy' || action === 'replace') return 'text-red-700 bg-red-100 border-red-200';
  if (action === 'modify')  return 'text-amber-700 bg-amber-100 border-amber-200';
  return 'text-emerald-700 bg-emerald-100 border-emerald-200';
}

function actionSymbol(action: string): string {
  if (action === 'destroy')  return '−';
  if (action === 'replace')  return '±';
  if (action === 'modify')   return '~';
  return '+';
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    planning:          'bg-amber-50  text-amber-700  border-amber-200',
    draft:             'bg-gray-100  text-gray-600   border-gray-200',
    plan_ready:        'bg-[#edf3fb] text-[#1e3a7a]  border-[#a8c1ea]',
    awaiting_approval: 'bg-[#edf3fb] text-[#1e3a7a]  border-[#a8c1ea]',
    approved:          'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected:          'bg-gray-100  text-gray-600   border-gray-200',
    failed:            'bg-red-50    text-red-600    border-red-200',
    applying:          'bg-amber-50  text-amber-700  border-amber-200',
    deployed:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return map[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
}

function humanStatus(status: string): string {
  const map: Record<string, string> = {
    planning:          'Preparing Terraform plan…',
    draft:             'Draft',
    plan_ready:        'Plan ready · awaiting review',
    awaiting_approval: 'Awaiting approval',
    approved:          'Approved',
    rejected:          'Rejected',
    failed:            'Failed',
    applying:          'Applying…',
    deployed:          'Deployed',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeploymentReviewPage({
  deploymentId,
  projectName,
  onBack,
}: DeploymentReviewPageProps) {
  const [deployment, setDeployment]     = useState<Deployment | null>(null);
  const [plan, setPlan]                 = useState<DeploymentPlanReview | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [understood, setUnderstood]     = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [planOpen, setPlanOpen]         = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const [dep, planData] = await Promise.all([
        getDeployment(deploymentId),
        getDeploymentPlan(deploymentId),
      ]);
      setDeployment(dep);
      setPlan(planData);
    } catch (e: any) {
      setError(e.message || 'Could not load deployment details.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh while the worker is still planning
  useEffect(() => {
    if (!deployment) return;
    if (POLLING_STATUSES.has(deployment.status)) {
      pollRef.current = setTimeout(() => void fetchData(true), 4000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [deployment, fetchData]);

  // ── Approval / rejection ──────────────────────────────────────────────────

  const handleDecision = async (approve: boolean) => {
    if (!deployment) return;
    if (approve && !understood) return;   // guard — button should already be disabled
    try {
      setApprovalBusy(true);
      setApprovalError('');
      const updated = await approveDeployment(deployment.id, approve);
      setDeployment(updated);
      setUnderstood(false);
      // Refresh plan data to get latest status
      const planData = await getDeploymentPlan(deployment.id);
      setPlan(planData);
    } catch (e: any) {
      setApprovalError(e.message || 'Could not submit your decision. Please try again.');
    } finally {
      setApprovalBusy(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const status = deployment?.status ?? '';
  const summary = plan?.summary;
  const isPlanning     = POLLING_STATUSES.has(status);
  const isReady        = READY_STATUSES.has(status);
  const isApproved     = status === 'approved';
  const isRejected     = status === 'rejected';
  const isFailed       = status === 'failed';
  const hasDestructive = summary?.has_destructive_changes ?? false;

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 bg-[#f4f6fa]">
        <Loader size={22} className="text-[#c9692a] animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading deployment plan…</p>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-6 bg-[#f4f6fa] h-full">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-[#1e3a7a] hover:underline mb-6 cursor-pointer">
          <ArrowLeft size={16} /> Back to deployments
        </button>
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-semibold text-sm">Could not load deployment</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
          <button onClick={() => void fetchData()} className="ml-auto text-xs text-red-500 hover:underline cursor-pointer flex items-center gap-1">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!deployment || !plan) return null;

  const displayProject = (plan as any).project_name || projectName || deployment.project_id;

  return (
    <div className="p-6 bg-[#f4f6fa] h-full overflow-y-auto space-y-5">

      {/* ── Breadcrumb / back nav ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-[#1e3a7a] hover:underline cursor-pointer"
        >
          <ArrowLeft size={16} /> Deployments
        </button>
        <ChevronRight size={14} className="text-gray-300" />
        <span className="text-gray-700 text-sm font-semibold truncate max-w-xs">{displayProject}</span>
        <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold border ${statusBadgeClass(status)}`}>
          {humanStatus(status)}
        </span>
      </div>

      {/* ── Page title ── */}
      <div>
        <h1 className="text-gray-900 font-bold text-xl">Review deployment</h1>
        <p className="text-gray-400 text-xs mt-1 font-mono">{deployment.id}</p>
      </div>

      {/* ── Planning in progress ── */}
      {isPlanning && (
        <div className="bg-white rounded-2xl border border-amber-200 px-5 py-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Hourglass size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-gray-800 font-semibold text-sm">Terraform plan in progress</p>
            <p className="text-gray-500 text-xs mt-1">
              Running terraform fmt → init → validate → plan. This page refreshes automatically.
            </p>
          </div>
          <Loader size={16} className="text-amber-600 animate-spin ml-auto flex-shrink-0" />
        </div>
      )}

      {/* ── Account + Region summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">AWS account</p>
          <p className="text-gray-800 font-mono text-sm font-semibold">{plan.account_id ?? '—'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">Region</p>
          <p className="text-gray-800 text-sm font-semibold">{plan.region ?? deployment.region ?? '—'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">Environment</p>
          <p className="text-gray-800 text-sm font-semibold capitalize">{(plan as any).environment ?? deployment.environment}</p>
        </div>
      </div>

      {/* ── Plan timestamps ── */}
      {(plan as any).plan_created_at && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock size={13} />
          Plan generated at {new Date((plan as any).plan_created_at).toLocaleString()}
        </div>
      )}

      {/* ── Destructive warning ── */}
      {hasDestructive && isReady && (
        <div className="bg-red-50 border-2 border-red-400 rounded-2xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-800 font-bold text-sm mb-1">
            <AlertTriangle size={18} /> Destructive changes detected
          </div>
          <p className="text-red-700 text-xs">
            This plan will <strong>destroy {summary?.destroy ?? 0}</strong> resource(s) and{' '}
            <strong>replace {summary?.replace ?? 0}</strong> resource(s). Review every red item
            carefully before proceeding.
          </p>
        </div>
      )}

      {/* ── Plan summary counts ── */}
      {summary && (
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
          <h2 className="text-gray-800 font-semibold text-sm mb-4">Terraform plan summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { label: 'Create',  value: summary.create,  bg: 'bg-emerald-50', text: 'text-emerald-800' },
              { label: 'Modify',  value: summary.modify,  bg: 'bg-amber-50',   text: 'text-amber-800' },
              {
                label: 'Destroy', value: summary.destroy,
                bg: summary.destroy || summary.replace ? 'bg-red-100'  : 'bg-gray-100',
                text: summary.destroy || summary.replace ? 'text-red-800' : 'text-gray-700',
              },
              {
                label: 'Replace', value: summary.replace,
                bg: summary.replace ? 'bg-red-100'  : 'bg-gray-100',
                text: summary.replace ? 'text-red-800' : 'text-gray-700',
              },
            ].map(({ label, value, bg, text }) => (
              <div key={label} className={`rounded-xl p-4 ${bg}`}>
                <p className={`text-2xl font-bold ${text}`}>{value}</p>
                <p className={`text-xs mt-0.5 ${text}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Resource list ── */}
      {summary?.resources && summary.resources.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
          <h2 className="text-gray-800 font-semibold text-sm mb-4">Resources</h2>
          <div className="space-y-2">
            {summary.resources.map((resource, i) => (
              <div
                key={`${resource.address}-${i}`}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                  resource.action === 'destroy' || resource.action === 'replace'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-gray-50 border-gray-100'
                }`}
              >
                {/* Action badge */}
                <span
                  className={`w-[68px] flex-shrink-0 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase border ${actionColor(resource.action)}`}
                >
                  <span className="text-sm leading-none">{actionSymbol(resource.action)}</span>
                  {resource.action}
                </span>
                {/* Resource info */}
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800 text-xs font-semibold truncate">{resource.type}</p>
                  <p className="text-gray-500 text-[10px] font-mono break-all">{resource.address}</p>
                </div>
                {/* Server icon */}
                <Server size={14} className="text-gray-300 flex-shrink-0" />
              </div>
            ))}
          </div>
          {summary.resources.length === 0 && (
            <p className="text-gray-400 text-xs">No resource changes in this plan.</p>
          )}
        </div>
      )}

      {/* ── Raw Terraform plan (collapsible) ── */}
      {plan.terraform_plan && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => setPlanOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors cursor-pointer"
            aria-expanded={planOpen}
          >
            <span className="text-gray-700 font-semibold text-sm">Full Terraform plan output</span>
            {planOpen
              ? <ChevronDown size={16} className="text-gray-400" />
              : <ChevronRight size={16} className="text-gray-400" />
            }
          </button>
          {planOpen && (
            <div className="border-t border-gray-100">
              <pre className="px-5 py-4 text-[11px] text-gray-700 bg-gray-50 overflow-x-auto max-h-96 whitespace-pre-wrap leading-relaxed">
                {plan.terraform_plan}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Error detail ── */}
      {isFailed && plan.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2">
            <XCircle size={16} /> Deployment planning failed
          </div>
          <pre className="text-red-700 text-xs whitespace-pre-wrap break-words leading-relaxed">
            {plan.error_message}
          </pre>
        </div>
      )}

      {/* ── APPROVED state ── */}
      {isApproved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={20} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-emerald-800 font-bold text-sm">Deployment approved successfully</p>
            <p className="text-emerald-700 text-xs mt-1">
              Your approval has been recorded. The plan is ready for the apply phase.{' '}
              <strong>No AWS infrastructure has been created yet.</strong>
            </p>
          </div>
        </div>
      )}

      {/* ── REJECTED state ── */}
      {isRejected && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
            <XCircle size={20} className="text-gray-500" />
          </div>
          <div>
            <p className="text-gray-700 font-bold text-sm">Deployment plan rejected</p>
            <p className="text-gray-500 text-xs mt-1">
              This plan was rejected. Create a new deployment plan when you are ready to proceed.
            </p>
          </div>
        </div>
      )}

      {/* ── Approval gate (only when plan is AWAITING_APPROVAL or PLAN_READY) ── */}
      {isReady && (
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 space-y-4">
          {/* Safety note */}
          <div className="flex items-start gap-3 bg-[#edf3fb] border border-[#a8c1ea] rounded-xl px-4 py-3">
            <ShieldCheck size={16} className="text-[#1e3a7a] flex-shrink-0 mt-0.5" />
            <p className="text-[#1e3a7a] text-xs">
              Approving this plan records your explicit consent. The infrastructure changes shown
              above will be applied to your AWS account in the next phase.{' '}
              <strong>No changes are made by clicking Approve — this only records your decision.</strong>
            </p>
          </div>

          {/* Approval error */}
          {approvalError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs">{approvalError}</p>
            </div>
          )}

          {/* Acknowledgement checkbox */}
          <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-[#1e3a7a] transition-colors cursor-pointer group">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#1e3a7a] cursor-pointer flex-shrink-0"
              aria-label="I understand these changes will be applied to my AWS account"
            />
            <span className="text-gray-700 text-sm group-hover:text-gray-900">
              I reviewed this Terraform plan and understand these changes will be applied to my AWS account
              {plan.account_id ? ` (${plan.account_id})` : ''} in region{' '}
              <strong>{plan.region ?? deployment.region}</strong>.
            </span>
          </label>

          {/* Action buttons */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <button
              disabled={approvalBusy}
              onClick={() => void handleDecision(false)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
            >
              <XCircle size={15} />
              {approvalBusy ? 'Processing…' : 'Reject plan'}
            </button>

            <div className="flex items-center gap-3">
              <button
                disabled={approvalBusy}
                onClick={onBack}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!understood || approvalBusy}
                onClick={() => void handleDecision(true)}
                aria-label="Approve deployment plan"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {approvalBusy
                  ? <Loader size={15} className="animate-spin" />
                  : <CheckCircle2 size={15} />
                }
                {approvalBusy ? 'Submitting…' : 'Approve'}
              </button>
            </div>
          </div>

          {/* Disabled-button explanation */}
          {!understood && (
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <Info size={12} />
              Check the box above to enable the Approve button.
            </div>
          )}
        </div>
      )}

      {/* ── Bottom back link ── */}
      <div className="pb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-[#1e3a7a] hover:underline cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to all deployments
        </button>
      </div>

    </div>
  );
}
