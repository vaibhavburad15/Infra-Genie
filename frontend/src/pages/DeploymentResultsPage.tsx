/**
 * DeploymentResultsPage.tsx
 *
 * Shows the complete results of an executed deployment:
 *   - Overall status (deployed / partial failure / failed)
 *   - Per-stage status (infrastructure, application, verification)
 *   - Application endpoint (clickable when safe)
 *   - Deployment outputs (sensitive values are redacted server-side)
 *   - Verification results per component
 *   - Duration and timestamps
 *   - Error detail and recovery suggestions
 *
 * Security:
 *   - Sensitive output keys arrive already redacted from the server.
 *   - AWS credentials and session tokens are never shown.
 *   - Account ID is shown in masked form only.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Loader,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Globe,
  Server,
  Database,
  Package,
  Clock,
  Zap,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { getDeploymentResults, timeAgo, type DeploymentResults } from '@/api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DeploymentResultsPageProps {
  deploymentId: string;
  onBack: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  'deployed', 'failed', 'apply_failed', 'application_deploy_failed', 'verification_failed',
]);
const POLLING_STATUSES = new Set([
  'applying', 'infrastructure_ready', 'deploying_application', 'verifying',
]);

function stageStatusClass(s: string | null | undefined): string {
  if (s === 'ready' || s === 'passed')  return 'text-emerald-700 bg-emerald-50';
  if (s === 'failed')                   return 'text-red-600 bg-red-50';
  if (s === 'applying' || s === 'deploying' || s === 'running')
    return 'text-amber-700 bg-amber-50';
  return 'text-gray-500 bg-gray-100';
}

function stageIcon(s: string | null | undefined) {
  if (s === 'ready' || s === 'passed')  return CheckCircle2;
  if (s === 'failed')                   return XCircle;
  if (s === 'applying' || s === 'deploying' || s === 'running') return Loader;
  return Clock;
}

function humanStageStatus(s: string | null | undefined): string {
  const map: Record<string, string> = {
    ready:      'Ready',
    passed:     'Passed',
    failed:     'Failed',
    applying:   'Applying…',
    deploying:  'Deploying…',
    running:    'Running…',
    skipped:    'Skipped',
  };
  return s ? (map[s] ?? s) : '—';
}

function overallStatusClass(status: string): string {
  if (status === 'deployed')                   return 'bg-emerald-50 border-emerald-200 text-emerald-800';
  if (status === 'verification_failed' || status === 'application_deploy_failed')
    return 'bg-orange-50 border-orange-200 text-orange-800';
  if (status.includes('failed') || status === 'failed')
    return 'bg-red-50 border-red-200 text-red-800';
  return 'bg-amber-50 border-amber-200 text-amber-800';
}

function overallStatusLabel(status: string): string {
  const map: Record<string, string> = {
    deployed:                  'Deployment successful',
    apply_failed:              'Infrastructure provisioning failed',
    application_deploy_failed: 'Infrastructure ready — application deploy failed',
    verification_failed:       'Deployed — health verification failed',
    failed:                    'Deployment failed',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

function formatDuration(s: number | null | undefined): string {
  if (!s) return '—';
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function isEndpointSafe(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false;
  // Only expose https:// or http:// URLs — not IP addresses alone
  return endpoint.startsWith('http://') || endpoint.startsWith('https://');
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DeploymentResultsPage({
  deploymentId,
  onBack,
}: DeploymentResultsPageProps) {
  const [results, setResults]   = useState<DeploymentResults | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [verifyOpen, setVerifyOpen]   = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetch = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const data = await getDeploymentResults(deploymentId);
      setResults(data);
    } catch (e: any) {
      setError(e.message || 'Could not load deployment results.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => { void fetch(); }, [fetch]);

  useEffect(() => {
    if (!results) return;
    if (POLLING_STATUSES.has(results.status)) {
      pollRef.current = setTimeout(() => void fetch(true), 5000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [results, fetch]);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24" role="status">
        <Loader size={22} className="text-primary animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading deployment results…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page space-y-4">
        <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2 self-start">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4" role="alert">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-semibold text-sm">Could not load results</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
          <button onClick={() => void fetch()} className="btn btn-secondary btn-sm ml-auto">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!results) return null;

  const endpoint = results.endpoint;
  const hasOutputs = Object.keys(results.outputs || {}).length > 0;
  const hasVerification = results.verification_results &&
    Object.keys(results.verification_results).length > 0;
  const isStillRunning = POLLING_STATUSES.has(results.status);

  return (
    <div className="page space-y-5">

      {/* ── Back + title ── */}
      <div className="flex flex-col gap-3">
        <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2 self-start">
          <ArrowLeft size={16} /> Deployments
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="page-title">Deployment results</h1>
            {results.project_name && (
              <p className="text-gray-500 text-xs mt-0.5">{results.project_name}</p>
            )}
            <p className="font-mono text-[11px] text-gray-400 mt-0.5">{deploymentId}</p>
          </div>
          <button
            onClick={() => void fetch(true)}
            className="btn btn-ghost btn-icon btn-sm self-start sm:self-center"
            title="Refresh"
          >
            <RefreshCw size={14} className={isStillRunning ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Overall status banner ── */}
      <div className={`rounded-xl border px-5 py-4 flex items-start gap-4 ${overallStatusClass(results.status)}`}>
        <div className="w-10 h-10 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0">
          {results.status === 'deployed'
            ? <CheckCircle2 size={20} className="text-emerald-600" />
            : results.status.includes('failed') || results.status === 'failed'
              ? <AlertTriangle size={20} className="text-red-500" />
              : <Loader size={20} className="animate-spin text-amber-600" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{overallStatusLabel(results.status)}</p>
          {results.duration_seconds && (
            <p className="text-xs mt-0.5 opacity-80">
              Completed in {formatDuration(results.duration_seconds)}
            </p>
          )}
        </div>
        {isStillRunning && (
          <span className="text-xs opacity-70 self-center">Refreshing…</span>
        )}
      </div>

      {/* ── Application endpoint ── */}
      {endpoint && (
        <div className="card px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Globe size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-0.5">Application endpoint</p>
            {isEndpointSafe(endpoint) ? (
              <a
                href={endpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm font-semibold hover:underline flex items-center gap-1 truncate"
              >
                {endpoint}
                <ExternalLink size={12} className="flex-shrink-0" />
              </a>
            ) : (
              <p className="text-gray-800 font-mono text-sm font-semibold truncate">{endpoint}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Metadata bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card px-4 py-3">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-0.5">AWS account</p>
          <p className="text-gray-800 font-mono text-sm font-semibold">
            {results.account_id_masked ?? '—'}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-0.5">Region</p>
          <p className="text-gray-800 text-sm font-semibold">{results.region ?? '—'}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-0.5">Environment</p>
          <p className="text-gray-800 text-sm font-semibold capitalize">{results.environment}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-0.5">Duration</p>
          <p className="text-gray-800 text-sm font-semibold">{formatDuration(results.duration_seconds)}</p>
        </div>
      </div>

      {/* ── Per-stage status cards ── */}
      <div className="card px-5 py-5">
        <h2 className="section-title mb-4">Stage status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Infrastructure',   status: results.infra_status,         icon: Server   },
            { label: 'Application',      status: results.app_deploy_status,    icon: Package  },
            { label: 'Health checks',    status: results.verification_status,  icon: ShieldCheck },
          ].map(({ label, status: s, icon: Icon }) => {
            const SIcon = stageIcon(s);
            const isSpinning = s === 'applying' || s === 'deploying' || s === 'running';
            return (
              <div key={label} className={`flex items-center gap-3 px-4 py-3 rounded-xl ${stageStatusClass(s)}`}>
                <div className="w-8 h-8 rounded-lg bg-white/60 flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="opacity-70" />
                </div>
                <div>
                  <p className="text-xs font-semibold">{label}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <SIcon size={11} className={isSpinning ? 'animate-spin' : ''} />
                    <span className="text-[11px]">{humanStageStatus(s)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Timestamps ── */}
      {(results.apply_started_at || results.completed_at) && (
        <div className="flex flex-wrap gap-4 text-xs text-gray-400">
          {results.apply_started_at && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              Started {timeAgo(results.apply_started_at)}
            </span>
          )}
          {results.completed_at && (
            <span className="flex items-center gap-1">
              <Zap size={11} />
              Completed {timeAgo(results.completed_at)}
            </span>
          )}
        </div>
      )}

      {/* ── Plan summary (context) ── */}
      {results.plan_summary && (
        <div className="card px-5 py-4">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-2">Plan applied</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">
              Created {results.plan_summary.create}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">
              Modified {results.plan_summary.modify}
            </span>
            {(results.plan_summary.destroy > 0 || results.plan_summary.replace > 0) && (
              <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-800 font-semibold">
                Destroyed {results.plan_summary.destroy} · Replaced {results.plan_summary.replace}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Deployment outputs (collapsible) ── */}
      {hasOutputs && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setOutputsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors cursor-pointer"
            aria-expanded={outputsOpen}
          >
            <span className="text-gray-700 font-semibold text-sm">Deployment outputs</span>
            {outputsOpen
              ? <ChevronDown size={16} className="text-gray-400" />
              : <ChevronRight size={16} className="text-gray-400" />
            }
          </button>
          {outputsOpen && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-2">
              {Object.entries(results.outputs).map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 text-xs">
                  <span className="font-mono text-gray-500 shrink-0 w-48 truncate">{k}</span>
                  <span className={`font-mono break-all ${v === '<redacted>' ? 'text-gray-300 italic' : 'text-gray-800'}`}>
                    {v === '<redacted>' ? '(redacted)' : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Verification results (collapsible) ── */}
      {hasVerification && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setVerifyOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors cursor-pointer"
            aria-expanded={verifyOpen}
          >
            <span className="text-gray-700 font-semibold text-sm">Health check results</span>
            {verifyOpen
              ? <ChevronDown size={16} className="text-gray-400" />
              : <ChevronRight size={16} className="text-gray-400" />
            }
          </button>
          {verifyOpen && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-2">
              {Object.entries(results.verification_results ?? {}).map(([comp, res]: [string, any]) => {
                const passed = res?.status === 'passed';
                const skipped = res?.status === 'skipped';
                return (
                  <div key={comp} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-xs ${
                    passed  ? 'bg-emerald-50 text-emerald-800' :
                    skipped ? 'bg-gray-50 text-gray-500' :
                    'bg-red-50 text-red-700'
                  }`}>
                    <span className="shrink-0">
                      {passed  ? <CheckCircle2 size={13} /> :
                       skipped ? <Clock size={13} /> :
                       <XCircle size={13} />}
                    </span>
                    <div className="min-w-0">
                      <span className="font-semibold capitalize">{comp}</span>
                      {res?.detail && <p className="text-[11px] opacity-80 mt-0.5">{res.detail}</p>}
                      {res?.url   && <p className="font-mono text-[10px] opacity-70 mt-0.5">{res.url}</p>}
                      {res?.attempts != null && (
                        <p className="text-[10px] opacity-60 mt-0.5">{res.attempts} attempt(s)</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Error message ── */}
      {results.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2">
            <AlertTriangle size={16} />
            {overallStatusLabel(results.status)}
          </div>
          <pre className="text-red-700 text-xs whitespace-pre-wrap break-words leading-relaxed">
            {results.error_message}
          </pre>
          {/* Partial-success guidance */}
          {(results.status === 'application_deploy_failed' || results.status === 'verification_failed') && (
            <div className="mt-3 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 text-orange-800 text-xs">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                The AWS infrastructure was provisioned. Review the resources in your AWS console.
                Do not create a new deployment plan until you have assessed the partial state —
                this could result in duplicate or conflicting resources.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Next steps ── */}
      {results.status === 'deployed' && (
        <div className="card px-5 py-4">
          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-3">Next steps</p>
          <ul className="space-y-1.5 text-sm text-gray-600">
            {endpoint && (
              <li className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                Visit your application at the endpoint above.
              </li>
            )}
            <li className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
              Review deployed resources in the AWS console.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
              Set up monitoring and alerting for your application.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
              Review AWS Cost Explorer to track infrastructure spend.
            </li>
          </ul>
        </div>
      )}

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
