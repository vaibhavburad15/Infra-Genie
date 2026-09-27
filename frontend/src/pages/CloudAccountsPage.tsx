/**
 * CloudAccountsPage.tsx
 *
 * Displays all connected AWS accounts for the current user and hosts the
 * AWSConnectWizard for adding new connections.
 *
 * Status badges:
 *   🟡 PENDING       — External ID generated, CFN not yet deployed
 *   🔵 VERIFYING     — STS AssumeRole in progress
 *   🟢 CONNECTED     — Verified and ready
 *   🔴 FAILED        — Verification failed (error shown)
 *   ⚫ DISCONNECTED  — Manually disconnected
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Cloud,
  PlusCircle,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  WifiOff,
  X,
} from 'lucide-react';
import {
  listAWSConnections,
  verifyAWSConnection,
  disconnectAWSAccount,
  type CloudAccountOut,
  type CloudAccountStatus,
} from '@/api';
import AWSConnectWizard from '@/components/AWSConnectWizard';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  CloudAccountStatus,
  { label: string; dot: string; badge: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: 'Setup required',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    icon: <Clock size={13} />,
  },
  VERIFYING: {
    label: 'Verifying…',
    dot: 'bg-blue-400 animate-pulse',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: <Loader2 size={13} className="animate-spin" />,
  },
  CONNECTED: {
    label: 'Connected',
    dot: 'bg-green-500',
    badge: 'bg-green-50 text-green-700 border-green-200',
    icon: <CheckCircle2 size={13} />,
  },
  FAILED: {
    label: 'Connection failed',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
    icon: <XCircle size={13} />,
  },
  DISCONNECTED: {
    label: 'Disconnected',
    dot: 'bg-slate-400',
    badge: 'bg-slate-50 text-slate-600 border-slate-200',
    icon: <WifiOff size={13} />,
  },
};

function StatusBadge({ status }: { status: CloudAccountStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['PENDING'];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.badge}`}
    >
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Account card ──────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: CloudAccountOut;
  onVerifyAgain: (id: string) => void;
  onDisconnect: (id: string) => void;
  verifyingId: string | null;
  disconnectingId: string | null;
}

function AccountCard({
  account,
  onVerifyAgain,
  onDisconnect,
  verifyingId,
  disconnectingId,
}: AccountCardProps) {
  const isVerifying = verifyingId === account.id;
  const isDisconnecting = disconnectingId === account.id;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FF9900]/10 flex items-center justify-center shrink-0">
            <span className="text-xl">☁️</span>
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{account.provider} Account</p>
            <p className="font-mono text-xs text-slate-500 mt-0.5">{account.account_id}</p>
          </div>
        </div>
        <StatusBadge status={account.status} />
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
        {[
          ['Region', account.region],
          ['Role', account.role_arn ? 'InfraGenieExecutionRole' : '—'],
          ['Connected', formatDate(account.created_at)],
          ['Last verified', formatDate(account.last_verified_at)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-slate-400">{label}</p>
            <p className="text-slate-700 font-medium truncate" title={value ?? undefined}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Error message */}
      {account.status === 'FAILED' && account.connection_error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700 mb-4">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-500" />
          <span>{account.connection_error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {(account.status === 'CONNECTED' || account.status === 'FAILED') && account.role_arn && (
          <button
            onClick={() => onVerifyAgain(account.id)}
            disabled={isVerifying}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#1e3a7a] text-[#1e3a7a] text-xs font-semibold hover:bg-[#1e3a7a]/5 disabled:opacity-50 transition-colors"
          >
            {isVerifying ? (
              <><Loader2 size={13} className="animate-spin" /> Verifying…</>
            ) : (
              <><RefreshCw size={13} /> Verify Again</>
            )}
          </button>
        )}
        {account.status !== 'DISCONNECTED' && (
          <button
            onClick={() => onDisconnect(account.id)}
            disabled={isDisconnecting}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {isDisconnecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            {isDisconnecting ? 'Removing…' : 'Disconnect'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CloudAccountsPage() {
  const [accounts, setAccounts] = useState<CloudAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await listAWSConnections();
      setAccounts(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleVerifyAgain = async (connectionId: string) => {
    const account = accounts.find((a) => a.id === connectionId);
    if (!account?.role_arn) return;
    setActionError('');
    setActionSuccess('');
    setVerifyingId(connectionId);
    try {
      const result = await verifyAWSConnection(connectionId, { role_arn: account.role_arn });
      if (result.status === 'CONNECTED') {
        setActionSuccess(`AWS account ${account.account_id} verified successfully.`);
        await loadAccounts();
      } else {
        setActionError(result.message ?? 'Verification failed.');
        await loadAccounts();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    const account = accounts.find((a) => a.id === connectionId);
    if (!account) return;
    if (!window.confirm(
      `Disconnect AWS account ${account.account_id}?\n\n` +
      'This removes the connection from Infra Genie. ' +
      'To fully revoke access, also delete the CloudFormation stack in your AWS console.'
    )) return;

    setActionError('');
    setActionSuccess('');
    setDisconnectingId(connectionId);
    try {
      await disconnectAWSAccount(connectionId);
      setActionSuccess(`AWS account ${account.account_id} disconnected.`);
      await loadAccounts();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to disconnect.');
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleConnected = async (newAccount: CloudAccountOut) => {
    setShowWizard(false);
    setActionSuccess(`AWS account ${newAccount.account_id} connected successfully!`);
    await loadAccounts();
  };

  const connected = accounts.filter((a) => a.status === 'CONNECTED');
  const pending   = accounts.filter((a) => a.status === 'PENDING' || a.status === 'VERIFYING');
  const failed    = accounts.filter((a) => a.status === 'FAILED');
  const other     = accounts.filter((a) => a.status === 'DISCONNECTED');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto bg-[#f4f6fa]">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1e3a7a]/10 flex items-center justify-center">
              <Cloud size={22} className="text-[#1e3a7a]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Cloud Accounts</h1>
              <p className="text-sm text-slate-500">
                Securely connect your AWS accounts via cross-account IAM roles.
              </p>
            </div>
          </div>
          <button
            onClick={() => { setShowWizard(true); setActionError(''); setActionSuccess(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1e3a7a] text-white text-sm font-semibold rounded-xl hover:bg-[#2d52a8] transition-colors shadow-sm"
          >
            <PlusCircle size={16} />
            Connect AWS Account
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Connected',    count: connected.length, color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100' },
            { label: 'Pending',      count: pending.length,   color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-100' },
            { label: 'Failed',       count: failed.length,    color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100' },
            { label: 'Disconnected', count: other.length,     color: 'text-slate-500',  bg: 'bg-slate-50',  border: 'border-slate-100' },
          ].map(({ label, count, color, bg, border }) => (
            <div key={label} className={`${bg} border ${border} rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold ${color}`}>{count}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Action feedback */}
        {actionSuccess && (
          <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0" />
              {actionSuccess}
            </div>
            <button onClick={() => setActionSuccess('')}><X size={14} /></button>
          </div>
        )}
        {actionError && (
          <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
            <div className="flex items-center gap-2">
              <XCircle size={15} className="shrink-0" />
              {actionError}
            </div>
            <button onClick={() => setActionError('')}><X size={14} /></button>
          </div>
        )}

        {/* Wizard modal */}
        {showWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl">
              <AWSConnectWizard
                onConnected={handleConnected}
                onCancel={() => setShowWizard(false)}
              />
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#1e3a7a]" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <XCircle size={32} className="text-red-400" />
            <p className="text-slate-600 text-sm">{loadError}</p>
            <button
              onClick={loadAccounts}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : accounts.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Cloud size={32} className="text-slate-300" />
            </div>
            <div>
              <p className="font-semibold text-slate-700">No AWS accounts connected</p>
              <p className="text-slate-400 text-sm mt-1">
                Connect your first AWS account to start deploying infrastructure.
              </p>
            </div>
            <button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1e3a7a] text-white text-sm font-semibold rounded-xl hover:bg-[#2d52a8] transition-colors"
            >
              <PlusCircle size={16} />
              Connect AWS Account
            </button>

            {/* How it works */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl text-left">
              {[
                {
                  step: '1',
                  title: 'Enter Account ID',
                  desc: 'Provide your 12-digit AWS Account ID and region.',
                },
                {
                  step: '2',
                  title: 'Deploy CloudFormation Stack',
                  desc: 'We generate a template that creates a cross-account IAM role.',
                },
                {
                  step: '3',
                  title: 'Verify & Connect',
                  desc: 'Infra Genie verifies access via STS AssumeRole and marks your account connected.',
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="bg-white rounded-xl border border-slate-100 p-4">
                  <div className="w-7 h-7 rounded-full bg-[#1e3a7a] text-white text-xs font-bold flex items-center justify-center mb-2">
                    {step}
                  </div>
                  <p className="font-semibold text-slate-700 text-sm">{title}</p>
                  <p className="text-slate-400 text-xs mt-1">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Account cards */
          <div className="space-y-6">
            {[
              { heading: '🟢 Connected', items: connected },
              { heading: '🟡 Pending Setup', items: pending },
              { heading: '🔴 Failed', items: failed },
              { heading: '⚫ Disconnected', items: other },
            ]
              .filter(({ items }) => items.length > 0)
              .map(({ heading, items }) => (
                <div key={heading}>
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    {heading}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        onVerifyAgain={handleVerifyAgain}
                        onDisconnect={handleDisconnect}
                        verifyingId={verifyingId}
                        disconnectingId={disconnectingId}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Security note */}
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-500 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-slate-400" />
          <p>
            <strong className="text-slate-600">Security:</strong> Infra Genie never stores
            your AWS access keys or secret keys. All access uses temporary STS credentials
            obtained via cross-account IAM role assumption with a unique External ID per
            connection. Temporary credentials are used in-memory only and are never logged
            or returned to the frontend.
          </p>
        </div>
      </div>
    </div>
  );
}
