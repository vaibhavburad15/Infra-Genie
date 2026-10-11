/**
 * DeploymentReviewPage.tsx
 *
 * Full-page review UI for a single deployment plan.
 *
 * Flow this page supports:
 *   PLANNING / DRAFT        — spinner, auto-refresh until plan ready
 *   PLAN_READY /
 *   AWAITING_APPROVAL       — full plan, checkbox + Approve / Reject buttons
 *   APPROVED                — strategy summary + "Deploy Approved Plan" button
 *   APPLYING /
 *   INFRASTRUCTURE_READY /
 *   DEPLOYING_APPLICATION /
 *   VERIFYING               — live progress tracker, auto-refresh
 *   DEPLOYED                — links to results page
 *   APPLY_FAILED /
 *   APPLICATION_DEPLOY_FAILED /
 *   VERIFICATION_FAILED     — error detail + recovery options
 *   REJECTED / FAILED       — terminal error states
 *
 * Security:
 *   • Never displays AWS credentials, session tokens, or role ARNs.
 *   • Approval requires explicit checkbox acknowledgement.
 *   • The Apply button is separate and sends POST /api/deployments/{id}/apply.
 *   • Duplicate clicks are prevented client-side; server enforces idempotency.
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
  Rocket,
  Zap,
  Globe,
  Database,
  Package,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import {
  getDeployment,
  getDeploymentPlan,
  getDeploymentStrategy,
  approveDeployment,
  applyDeployment,
  type Deployment,
  type DeploymentPlanReview,
  type DeploymentStrategyResponse,
  type DeploymentStrategyComponent,
} from '@/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeploymentReviewPageProps {
  deploymentId: string;
  projectName?: string;
  onBack: () => void;
  onViewResults?: (deploymentId: string) => void;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const POLLING_STATUSES = new Set([
  'planning', 'draft', 'applying', 'infrastructure_ready',
  'deploying_application', 'verifying',
]);
const READY_STATUSES   = new Set(['plan_ready', 'awaiting_approval']);
const ACTIVE_STATUSES  = new Set([
  'applying', 'infrastructure_ready', 'deploying_application', 'verifying',
]);
const FAILURE_STATUSES = new Set([
  'failed', 'apply_failed', 'application_deploy_failed', 'verification_failed',
  'plan_failed', 'artifact_failed', 'strategy_failed',
]);

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
    planning:               'bg-amber-50  text-amber-700  border-amber-200',
    draft:                  'bg-gray-100  text-gray-600   border-gray-200',
    plan_ready:             'bg-primary-50 text-primary   border-primary-200',
    awaiting_approval:      'bg-primary-50 text-primary   border-primary-200',
    approved:               'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected:               'bg-gray-100  text-gray-600   border-gray-200',
    failed:                 'bg-red-50    text-red-600    border-red-200',
    plan_failed:            'bg-red-50    text-red-600    border-red-200',
    apply_failed:           'bg-red-50    text-red-600    border-red-200',
    application_deploy_failed: 'bg-orange-50 text-orange-700 border-orange-200',
    verification_failed:    'bg-orange-50 text-orange-700 border-orange-200',
    applying:               'bg-amber-50  text-amber-700  border-amber-200',
    infrastructure_ready:   'bg-blue-50   text-blue-700   border-blue-200',
    deploying_application:  'bg-amber-50  text-amber-700  border-amber-200',
    verifying:              'bg-purple-50 text-purple-700 border-purple-200',
    deployed:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return map[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
}

function humanStatus(status: string): string {
  const map: Record<string, string> = {
    planning:               'Preparing Terraform plan…',
    draft:                  'Draft',
    plan_ready:             'Plan ready · awaiting review',
    awaiting_approval:      'Awaiting approval',
    approved:               'Approved · ready to deploy',
    rejected:               'Rejected',
    failed:                 'Failed',
    plan_failed:            'Plan failed',
    apply_failed:           'Infrastructure apply failed',
    application_deploy_failed: 'Application deploy failed',
    verification_failed:    'Verification failed',
    applying:               'Applying infrastructure…',
    infrastructure_ready:   'Infrastructure ready',
    deploying_application:  'Deploying application…',
    verifying:              'Verifying deployment…',
    deployed:               'Deployed ✓',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

function targetLabel(target: string): string {
  const map: Record<string, string> = {
    ec2:           'Amazon EC2',
    ecs_fargate:   'ECS Fargate',
    s3_cloudfront: 'S3 + CloudFront',
    eks:           'Amazon EKS',
    rds:           'Amazon RDS',
    ecr:           'Amazon ECR',
    lambda:        'AWS Lambda',
  };
  return map[target] ?? target;
}

function targetIcon(target: string) {
  if (target === 's3_cloudfront') return Globe;
  if (target === 'rds')           return Database;
  if (target === 'ecr')           return Package;
  return Server;
}

// ── Progress steps ────────────────────────────────────────────────────────────

const APPLY_STEPS = [
  { key: 'applying',              label: 'Applying infrastructure',   detail: 'Running terraform apply…' },
  { key: 'infrastructure_ready',  label: 'Infrastructure ready',      detail: 'Resources created successfully.' },
  { key: 'deploying_application', label: 'Deploying application',     detail: 'Pushing build artifacts…' },
  { key: 'verifying',             label: 'Verifying deployment',      detail: 'Running health checks…' },
  { key: 'deployed',              label: 'Deployed',                  detail: 'All checks passed.' },
];

const STATUS_ORDER = ['applying', 'infrastructure_ready', 'deploying_application', 'verifying', 'deployed'];

function stepState(stepKey: string, currentStatus: string): 'done' | 'active' | 'failed' | 'pending' {
  const failed = FAILURE_STATUSES.has(currentStatus);
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const stepIdx    = STATUS_ORDER.indexOf(stepKey);
  if (currentStatus === 'deployed' && stepKey === 'deployed') return 'done';
  if (failed && stepIdx === currentIdx) return 'failed';
  if (failed && stepIdx < currentIdx)   return 'done';
  if (currentIdx > stepIdx)             return 'done';
  if (currentIdx === stepIdx)           return 'active';
  return 'pending';
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeploymentReviewPage({
  deploymentId,
  projectName,
  onBack,
  onViewResults,
}: DeploymentReviewPageProps) {
  const [deployment, setDeployment]         = useState<Deployment | null>(null);
  const [plan, setPlan]                     = useState<DeploymentPlanReview | null>(null);
  const [strategy, setStrategy]             = useState<DeploymentStrategyResponse | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const [understood, setUnderstood]         = useState(false);
  const [approvalBusy, setApprovalBusy]     = useState(false);
  const [approvalError, setApprovalError]   = useState('');
  const [applyBusy, setApplyBusy]           = useState(false);
  const [applyError, setApplyError]         = useState('');
  const [planOpen, setPlanOpen]             = useState(false);
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
      // Load strategy when available (non-blocking — don't block on it)
      if ((dep as any).strategy_json) {
        try {
          const strat = await getDeploymentStrategy(deploymentId);
          setStrategy(strat);
        } catch {
          // Strategy optional — older deployments may not have it
        }
      }
    } catch (e: any) {
      setError(e.message || 'Could not load deployment details.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Auto-refresh while the worker is busy
  useEffect(() => {
    if (!deployment) return;
    if (POLLING_STATUSES.has(deployment.status)) {
      pollRef.current = setTimeout(() => void fetchData(true), 4000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [deployment, fetchData]);

  // ── Approval / rejection ──────────────────────────────────────────────────

  const handleDecision = async (approve: boolean) => {
    if (!deployment) return;
    if (approve && !understood) return;
    try {
      setApprovalBusy(true);
      setApprovalError('');
      const updated = await approveDeployment(deployment.id, approve);
      setDeployment(updated);
      setUnderstood(false);
      const planData = await getDeploymentPlan(deployment.id);
      setPlan(planData);
    } catch (e: any) {
      setApprovalError(e.message || 'Could not submit your decision. Please try again.');
    } finally {
      setApprovalBusy(false);
    }
  };

  // ── Apply ─────────────────────────────────────────────────────────────────

  const handleApply = async () => {
    if (!deployment) return;
    try {
      setApplyBusy(true);
      setApplyError('');
      const updated = await applyDeployment(deployment.id);
      setDeployment(updated);
      // Start polling immediately
      void fetchData(true);
    } catch (e: any) {
      setApplyError(e.message || 'Could not start deployment. Please try again.');
    } finally {
      setApplyBusy(false);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const status        = deployment?.status ?? '';
  const summary       = plan?.summary;
  const isPlanning    = status === 'planning' || status === 'draft';
  const isReady       = READY_STATUSES.has(status);
  const isApproved    = status === 'approved';
  const isActive      = ACTIVE_STATUSES.has(status);
  const isDeployed    = status === 'deployed';
  const isRejected    = status === 'rejected';
  const isFailed      = FAILURE_STATUSES.has(status);
  const hasDestructive = summary?.has_destructive_changes ?? false;
  const strategyData  = strategy?.strategy?.components ? strategy.strategy : null;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24" role="status">
        <Loader size={22} className="text-primary animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading deployment plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page space-y-4">
        <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2 self-start">
          <ArrowLeft size={16} /> Back to deployments
        </button>
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4" role="alert">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-semibold text-sm">Could not load deployment</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
          <button onClick={() => void fetchData()} className="btn btn-secondary btn-sm ml-auto">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!deployment || !plan) return null;

  const displayProject = (plan as any).project_name || projectName || deployment.project_id;

  return (
    <div className="page space-y-5">

      {/* ── Back nav + title ── */}
      <div className="flex flex-col gap-3">
        <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2 self-start">
          <ArrowLeft size={16} /> Deployments
        </button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="page-title truncate">Review deployment · {displayProject}</h1>
            <p className="mt-0.5 truncate font-mono text-xs text-gray-500">{deployment.id}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge shrink-0 ${statusBadgeClass(status)}`}>
              {humanStatus(status)}
            </span>
            <button
              onClick={() => void fetchData(true)}
              className="btn btn-ghost btn-icon btn-sm"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Planning in progress ── */}
      {isPlanning && (
        <div className="bg-white rounded-xl border border-amber-200 px-5 py-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Hourglass size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="section-title">Terraform plan in progress</p>
            <p className="text-gray-500 text-xs mt-1">
              Running terraform fmt → init → validate → plan. This page refreshes automatically.
            </p>
          </div>
          <Loader size={16} className="text-amber-600 animate-spin ml-auto flex-shrink-0" />
        </div>
      )}

      {/* ── Active execution progress tracker ── */}
      {(isActive || isDeployed || isFailed) && (
        <div className="card px-5 py-5">
          <h2 className="section-title mb-5">Deployment progress</h2>
          <div className="relative">
            {/* Connecting line */}
            <div className="absolute left-4 top-5 bottom-5 w-px bg-gray-200" aria-hidden="true" />
            <div className="space-y-4">
              {APPLY_STEPS.map((step) => {
                const state = stepState(step.key, status);
                return (
                  <div key={step.key} className="flex items-start gap-4 relative">
                    {/* Step icon */}
                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      state === 'done'    ? 'bg-emerald-100 text-emerald-600' :
                      state === 'active'  ? 'bg-primary-100 text-primary ring-2 ring-primary ring-offset-2' :
                      state === 'failed'  ? 'bg-red-100 text-red-500' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {state === 'done'   && <CheckCircle2 size={16} />}
                      {state === 'active' && <Loader size={16} className="animate-spin" />}
                      {state === 'failed' && <XCircle size={16} />}
                      {state === 'pending' && <span className="w-2 h-2 rounded-full bg-gray-300" />}
                    </div>
                    {/* Label */}
                    <div className="pt-1 min-w-0">
                      <p className={`text-sm font-semibold ${
                        state === 'done'    ? 'text-emerald-700' :
                        state === 'active'  ? 'text-gray-900' :
                        state === 'failed'  ? 'text-red-700' :
                        'text-gray-400'
                      }`}>{step.label}</p>
                      {state === 'active' && (
                        <p className="text-gray-500 text-xs mt-0.5">{step.detail}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results link when deployed */}
          {isDeployed && onViewResults && (
            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
              <p className="text-emerald-700 text-sm font-semibold">
                <CheckCircle2 size={15} className="inline mr-1 mb-0.5" />
                Deployment complete
              </p>
              <button
                onClick={() => onViewResults(deploymentId)}
                className="btn btn-primary btn-sm"
              >
                <ExternalLink size={13} /> View results
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Failure detail for apply-phase failures ── */}
      {isFailed && deployment.error_message && !isPlanning && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-5">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-3">
            <AlertTriangle size={16} />
            {humanStatus(status)}
          </div>
          <pre className="text-red-700 text-xs whitespace-pre-wrap break-words leading-relaxed">
            {deployment.error_message}
          </pre>
          {/* For partial-success states, infrastructure may still be running */}
          {(status === 'application_deploy_failed' || status === 'verification_failed') && (
            <div className="mt-3 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 text-orange-800 text-xs">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Infrastructure was provisioned successfully. Review the AWS console to manage
                the created resources. A new plan may not be required — check the error above.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Metadata bar ── */}
      {!isPlanning && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card px-5 py-4">
            <p className="text-gray-500 text-[11px] uppercase tracking-widest mb-1">AWS account</p>
            <p className="text-gray-800 font-mono text-sm font-semibold">{plan.account_id ?? '—'}</p>
          </div>
          <div className="card px-5 py-4">
            <p className="text-gray-500 text-[11px] uppercase tracking-widest mb-1">Region</p>
            <p className="text-gray-800 text-sm font-semibold">{plan.region ?? deployment.region ?? '—'}</p>
          </div>
          <div className="card px-5 py-4">
            <p className="text-gray-500 text-[11px] uppercase tracking-widest mb-1">Environment</p>
            <p className="text-gray-800 text-sm font-semibold capitalize">
              {(plan as any).environment ?? deployment.environment}
            </p>
          </div>
        </div>
      )}

      {/* ── Plan timestamp ── */}
      {(plan as any).plan_created_at && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock size={13} />
          Plan generated at {new Date((plan as any).plan_created_at).toLocaleString()}
        </div>
      )}

      {/* ── Deployment strategy panel ── */}
      {strategyData && (
        <div className="card px-5 py-5">
          <h2 className="section-title mb-1">Deployment strategy</h2>
          <p className="text-gray-500 text-xs mb-4">{strategyData.description}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {strategyData.components.map((comp: DeploymentStrategyComponent) => {
              const Icon = targetIcon(comp.target);
              return (
                <div
                  key={comp.name}
                  className="flex items-start gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-gray-900 font-semibold text-sm capitalize">{comp.name}</p>
                    <p className="text-primary text-[11px] font-medium">{targetLabel(comp.target)}</p>
                    {comp.rationale && (
                      <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed">{comp.rationale}</p>
                    )}
                    {comp.assumptions.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {comp.assumptions.map((a, i) => (
                          <li key={i} className="text-gray-400 text-[10px] flex items-start gap-1">
                            <span className="mt-0.5">•</span><span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cost estimate */}
          {strategyData.cost_estimate && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-blue-900 text-xs font-semibold mb-1">
                Estimated monthly cost (rough estimate only)
              </p>
              <p className="text-blue-800 text-sm font-bold">
                ${strategyData.cost_estimate.monthly_usd_low}–
                ${strategyData.cost_estimate.monthly_usd_high} / month
              </p>
              <p className="text-blue-600 text-[10px] mt-1">{strategyData.cost_estimate.disclaimer}</p>
            </div>
          )}

          {/* Limitations */}
          {strategyData.limitations.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-amber-800 font-semibold text-xs mb-1">Limitations</p>
              <ul className="space-y-0.5">
                {strategyData.limitations.map((l, i) => (
                  <li key={i} className="text-amber-700 text-xs flex items-start gap-1">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /><span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Validation errors */}
          {strategyData.validation_errors && strategyData.validation_errors.length > 0 && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-red-700 font-semibold text-xs mb-1">Strategy validation errors</p>
              <ul className="space-y-0.5">
                {strategyData.validation_errors.map((e, i) => (
                  <li key={i} className="text-red-600 text-xs">• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Destructive changes warning ── */}
      {hasDestructive && isReady && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-800 font-semibold text-sm mb-1">
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
      {summary && !isActive && !isDeployed && (
        <div className="card px-5 py-5">
          <h2 className="section-title mb-4">Terraform plan summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { label: 'Create',  value: summary.create,  bg: 'bg-emerald-50', text: 'text-emerald-800' },
              { label: 'Modify',  value: summary.modify,  bg: 'bg-amber-50',   text: 'text-amber-800' },
              {
                label: 'Destroy', value: summary.destroy,
                bg:   summary.destroy || summary.replace ? 'bg-red-100'   : 'bg-gray-100',
                text: summary.destroy || summary.replace ? 'text-red-800' : 'text-gray-700',
              },
              {
                label: 'Replace', value: summary.replace,
                bg:   summary.replace ? 'bg-red-100'   : 'bg-gray-100',
                text: summary.replace ? 'text-red-800' : 'text-gray-700',
              },
            ].map(({ label, value, bg, text }) => (
              <div key={label} className={`rounded-xl p-4 ${bg}`}>
                <p className={`text-2xl font-semibold ${text}`}>{value}</p>
                <p className={`text-xs mt-0.5 ${text}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Resource list ── */}
      {summary?.resources && summary.resources.length > 0 && !isActive && !isDeployed && (
        <div className="card px-5 py-5">
          <h2 className="section-title mb-4">Resources</h2>
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
                <span className={`w-[68px] flex-shrink-0 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase border ${actionColor(resource.action)}`}>
                  <span className="text-sm leading-none">{actionSymbol(resource.action)}</span>
                  {resource.action}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800 text-xs font-semibold truncate">{resource.type}</p>
                  <p className="text-gray-500 text-[10px] font-mono break-all">{resource.address}</p>
                </div>
                <Server size={14} className="text-gray-300 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Raw Terraform plan (collapsible) ── */}
      {plan.terraform_plan && !isActive && !isDeployed && (
        <div className="card overflow-hidden">
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

      {/* ── Planning failure error ── */}
      {(status === 'failed' || status === 'plan_failed') && plan.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2">
            <XCircle size={16} /> Deployment planning failed
          </div>
          <pre className="text-red-700 text-xs whitespace-pre-wrap break-words leading-relaxed">
            {plan.error_message}
          </pre>
        </div>
      )}

      {/* ── APPROVED state — show Deploy button ── */}
      {isApproved && (
        <div className="card px-5 py-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-emerald-800 font-semibold text-sm">Deployment plan approved</p>
              <p className="text-gray-500 text-xs mt-1">
                Your approval is recorded. Click <strong>Deploy Approved Plan</strong> to provision
                the infrastructure shown in this plan. The apply runs in the background — you can
                leave this page and check back.
              </p>
            </div>
          </div>

          {/* Security reminder */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <ShieldCheck size={15} className="text-amber-700 flex-shrink-0 mt-0.5" />
            <p className="text-amber-800 text-xs">
              This will create real AWS resources in your account and may incur charges.
              Ensure you have reviewed all resource changes above before proceeding.
            </p>
          </div>

          {/* Apply error */}
          {applyError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs">{applyError}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={onBack}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-colors"
            >
              Back to list
            </button>
            <button
              disabled={applyBusy}
              onClick={() => void handleApply()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              aria-label="Deploy approved plan to AWS"
            >
              {applyBusy
                ? <Loader size={15} className="animate-spin" />
                : <Rocket size={15} />
              }
              {applyBusy ? 'Queuing deployment…' : 'Deploy Approved Plan'}
            </button>
          </div>
        </div>
      )}

      {/* ── REJECTED state ── */}
      {isRejected && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
            <XCircle size={20} className="text-gray-500" />
          </div>
          <div>
            <p className="text-gray-700 font-semibold text-sm">Deployment plan rejected</p>
            <p className="text-gray-500 text-xs mt-1">
              This plan was rejected. Create a new deployment plan when you are ready to proceed.
            </p>
          </div>
        </div>
      )}

      {/* ── Approval gate ── */}
      {isReady && (
        <div className="card px-5 py-5 space-y-4">
          <div className="flex items-start gap-3 bg-primary-50 border border-primary-200 rounded-xl px-4 py-3">
            <ShieldCheck size={16} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="text-primary text-xs">
              Approving records your explicit consent. The infrastructure changes above will be
              applied to your AWS account in the next step.{' '}
              <strong>No changes are made by clicking Approve — this only records your decision.</strong>
            </p>
          </div>

          {approvalError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs">{approvalError}</p>
            </div>
          )}

          <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary transition-colors cursor-pointer group">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-primary cursor-pointer flex-shrink-0"
              aria-label="I understand these changes will be applied to my AWS account"
            />
            <span className="text-gray-700 text-sm group-hover:text-gray-900">
              I reviewed this Terraform plan and understand these changes will be applied to my
              AWS account{plan.account_id ? ` (${plan.account_id})` : ''} in region{' '}
              <strong>{plan.region ?? deployment.region}</strong>.
            </span>
          </label>

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

          {!understood && (
            <div className="flex items-center gap-2 text-gray-500 text-xs">
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
          className="flex items-center gap-2 text-sm text-primary hover:underline cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to all deployments
        </button>
      </div>

    </div>
  );
}
