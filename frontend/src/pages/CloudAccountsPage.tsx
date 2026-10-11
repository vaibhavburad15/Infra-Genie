/**
 * CloudAccountsPage.tsx
 *
 * Displays all connected AWS accounts and hosts:
 *  • AWSConnectWizard for adding new connections
 *  • AWS Discovery panel — trigger scan, view structured inventory results
 *
 * Status badges:
 *   PENDING       — External ID generated, CFN not yet deployed
 *   VERIFYING     — STS AssumeRole in progress
 *   CONNECTED     — Verified and ready
 *   FAILED        — Verification failed (error shown)
 *   DISCONNECTED  — Manually disconnected
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  WifiOff,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Server,
  Database,
  Shield,
  ShieldCheck,
  Box,
  HardDrive,
  Network,
  Cpu,
  Archive,
  Globe,
  KeyRound,
  FileCode2,
  Radar,
} from 'lucide-react';
import {
  listAWSConnections,
  verifyAWSConnection,
  disconnectAWSAccount,
  runAWSDiscovery,
  getAWSDiscoveryResult,
  getAWSConnectionSetup,
  ApiError,
  type CloudAccountConnectResponse,
  type CloudAccountOut,
  type CloudAccountStatus,
  type DiscoveryResult,
} from '@/api';
import AWSConnectWizard from '@/components/AWSConnectWizard';
import { PageHeader, StatCard, LoadingState } from '@/components/ui';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  CloudAccountStatus,
  { label: string; badge: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: 'Pending setup',
    badge: 'badge-warning',
    icon: <Clock size={12} />,
  },
  VERIFYING: {
    label: 'Verifying…',
    badge: 'badge-info',
    icon: <Loader2 size={12} className="animate-spin" />,
  },
  CONNECTED: {
    label: 'Connected',
    badge: 'badge-success',
    icon: <CheckCircle2 size={12} />,
  },
  FAILED: {
    label: 'Failed',
    badge: 'badge-danger',
    icon: <XCircle size={12} />,
  },
  DISCONNECTED: {
    label: 'Disconnected',
    badge: 'badge-neutral',
    icon: <WifiOff size={12} />,
  },
};

function StatusBadge({ status }: { status: CloudAccountStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['PENDING'];
  return (
    <span className={`badge ${cfg.badge}`}>
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

// ── Discovery Summary cards ───────────────────────────────────────────────────

interface SummaryTileProps {
  label: string;
  count: number;
  icon: React.ReactNode;
  sub?: string;
}

function SummaryTile({ label, count, icon, sub }: SummaryTileProps) {
  return (
    <div className="card flex items-center gap-3 px-3.5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-6 text-gray-900 tabular-nums">{count}</p>
        <p className="text-xs text-gray-500">{label}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

// ── Discovery Resource Section ────────────────────────────────────────────────

interface ResourceSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function ResourceSection({ title, icon, count, children, defaultOpen = false }: ResourceSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="card overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icon}</span>
          <span className="text-sm font-medium text-gray-800">{title}</span>
          <span className="badge badge-neutral">{count}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-200">{children}</div>}
    </div>
  );
}

// ── Resource Table ────────────────────────────────────────────────────────────

function ResourceTable({ columns, rows }: {
  columns: string[];
  rows: (string | number | boolean | null | undefined)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-50">
            {columns.map((col) => (
              <th key={col} scope="col" className="whitespace-nowrap border-b border-gray-200 px-4 py-2 text-left font-medium text-gray-500">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className="max-w-[240px] truncate whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-gray-700" title={String(cell ?? '—')}>
                  {cell === true ? '✓' : cell === false ? '✗' : cell ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Full Discovery Results Panel ──────────────────────────────────────────────

function DiscoveryResultsPanel({ result }: { result: DiscoveryResult }) {
  const s = result.summary;

  const summaryTiles: SummaryTileProps[] = [
    { label: 'VPCs', count: s.vpc_count, icon: <Network size={16} /> },
    { label: 'Subnets', count: s.subnet_count, icon: <Globe size={16} /> },
    { label: 'Security Groups', count: s.security_group_count, icon: <Shield size={16} /> },
    {
      label: 'EC2 Instances',
      count: s.ec2_instance_count,
      icon: <Server size={16} />,
      sub: Object.entries(s.ec2_by_state || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    {
      label: 'Load Balancers',
      count: s.load_balancer_count,
      icon: <Cpu size={16} />,
      sub: Object.entries(s.lb_by_type || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    { label: 'EKS Clusters', count: s.eks_cluster_count, icon: <Box size={16} /> },
    {
      label: 'RDS Instances',
      count: s.rds_instance_count,
      icon: <Database size={16} />,
      sub: Object.entries(s.rds_by_engine || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    { label: 'S3 Buckets', count: s.s3_bucket_count, icon: <Archive size={16} /> },
    { label: 'NAT Gateways', count: s.nat_gateway_count, icon: <HardDrive size={16} /> },
    { label: 'ECR Repos', count: s.ecr_repo_count, icon: <Box size={16} /> },
    { label: 'IAM Roles', count: s.iam_role_count, icon: <Shield size={16} /> },
  ];

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {summaryTiles.filter((t) => t.count > 0).map((tile) => (
          <SummaryTile key={tile.label} {...tile} />
        ))}
        {summaryTiles.every((t) => t.count === 0) && (
          <div className="col-span-full py-6 text-center text-sm text-gray-500">
            No AWS resources found in region <code className="font-mono">{result.region}</code>.
          </div>
        )}
      </div>

      {/* Detailed resource sections */}
      <div className="space-y-2.5">
        <ResourceSection title="VPCs" icon={<Network size={15} />} count={result.vpcs.length} defaultOpen>
          <ResourceTable
            columns={['VPC ID', 'CIDR', 'State', 'Default', 'Name']}
            rows={result.vpcs.map((v) => [v.vpc_id, v.cidr, v.state, v.is_default, v.name || '—'])}
          />
        </ResourceSection>

        <ResourceSection title="Subnets" icon={<Globe size={15} />} count={result.subnets.length}>
          <ResourceTable
            columns={['Subnet ID', 'VPC ID', 'CIDR', 'AZ', 'Free IPs', 'Public', 'Name']}
            rows={result.subnets.map((s) => [
              s.subnet_id, s.vpc_id, s.cidr,
              s.availability_zone, s.available_ip_count,
              s.map_public_ip_on_launch, s.name || '—',
            ])}
          />
        </ResourceSection>

        <ResourceSection title="Security Groups" icon={<Shield size={15} />} count={result.security_groups.length}>
          <ResourceTable
            columns={['SG ID', 'Name', 'VPC ID', 'Inbound Rules', 'Outbound Rules']}
            rows={result.security_groups.map((sg) => [
              sg.sg_id, sg.name, sg.vpc_id,
              sg.inbound.length, sg.outbound.length,
            ])}
          />
        </ResourceSection>

        <ResourceSection title="EC2 Instances" icon={<Server size={15} />} count={result.ec2_instances.length} defaultOpen>
          <ResourceTable
            columns={['Instance ID', 'Type', 'State', 'Private IP', 'Public IP', 'VPC', 'Name']}
            rows={result.ec2_instances.map((i) => [
              i.instance_id, i.instance_type, i.state,
              i.private_ip || '—', i.public_ip || '—',
              i.vpc_id || '—', i.name || '—',
            ])}
          />
        </ResourceSection>

        <ResourceSection title="Load Balancers" icon={<Cpu size={15} />} count={result.load_balancers.length} defaultOpen>
          <ResourceTable
            columns={['Name', 'Type', 'Scheme', 'State', 'VPC', 'DNS Name']}
            rows={result.load_balancers.map((lb) => [
              lb.name, lb.type, lb.scheme, lb.state,
              lb.vpc_id || '—',
              lb.dns_name || '—',
            ])}
          />
        </ResourceSection>

        <ResourceSection title="EKS Clusters" icon={<Box size={15} />} count={result.eks_clusters.length} defaultOpen>
          <ResourceTable
            columns={['Name', 'Status', 'K8s Version', 'VPC', 'Public Access', 'Private Access']}
            rows={result.eks_clusters.map((c) => [
              c.cluster_name, c.status, c.kubernetes_version,
              c.vpc_id || '—',
              c.endpoint_public_access, c.endpoint_private_access,
            ])}
          />
        </ResourceSection>

        <ResourceSection title="RDS Instances" icon={<Database size={15} />} count={result.rds_instances.length} defaultOpen>
          <ResourceTable
            columns={['Identifier', 'Class', 'Engine', 'Version', 'Status', 'Multi-AZ', 'Encrypted', 'Public']}
            rows={result.rds_instances.map((db) => [
              db.db_identifier, db.db_class,
              db.engine, db.engine_version, db.status,
              db.multi_az, db.storage_encrypted, db.publicly_accessible,
            ])}
          />
        </ResourceSection>

        <ResourceSection title="S3 Buckets" icon={<Archive size={15} />} count={result.s3_buckets.length}>
          <ResourceTable
            columns={['Bucket Name', 'Region', 'Created']}
            rows={result.s3_buckets.map((b) => [b.name, b.region || '—', formatDate(b.created_at)])}
          />
        </ResourceSection>

        <ResourceSection title="ECR Repositories" icon={<Box size={15} />} count={result.ecr_repositories.length}>
          <ResourceTable
            columns={['Name', 'URI', 'Scan on Push']}
            rows={(result.ecr_repositories as any[]).map((r) => [
              r.name, r.uri, r.scan_on_push,
            ])}
          />
        </ResourceSection>

        <ResourceSection title="IAM Roles (customer-managed)" icon={<Shield size={15} />} count={result.iam_roles.length}>
          <ResourceTable
            columns={['Role Name', 'Path', 'ARN']}
            rows={result.iam_roles.map((r) => [r.role_name, r.path, r.role_arn])}
          />
        </ResourceSection>
      </div>
    </div>
  );
}

// ── Discovery Panel (per account) ─────────────────────────────────────────────

interface DiscoveryPanelProps {
  account: CloudAccountOut;
  onDiscoveryComplete: () => void;
}

function DiscoveryPanel({ account, onDiscoveryComplete }: DiscoveryPanelProps) {
  const [running, setRunning] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState('');
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(account.discovery_ran_at);

  const handleRunDiscovery = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const resp = await runAWSDiscovery(account.id);
      setResult(resp.result);
      setDiscoveredAt(resp.discovered_at);
      onDiscoveryComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Discovery failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleLoadCached = async () => {
    setLoadingCached(true);
    setError('');
    try {
      const resp = await getAWSDiscoveryResult(account.id);
      setResult(resp.result);
      setDiscoveredAt(resp.discovered_at);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load cached results.');
    } finally {
      setLoadingCached(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="section-title">AWS Infrastructure Discovery</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {discoveredAt ? `Last scanned ${formatDate(discoveredAt)}` : 'No scan has been run yet.'}
          </p>
        </div>
        <div className="flex gap-2">
          {discoveredAt && !result && (
            <button onClick={handleLoadCached} disabled={loadingCached} className="btn btn-secondary btn-sm">
              {loadingCached
                ? <><Loader2 size={14} className="animate-spin" /> Loading…</>
                : <><Search size={14} /> View Last Results</>
              }
            </button>
          )}
          <button onClick={handleRunDiscovery} disabled={running} className="btn btn-primary btn-sm">
            {running
              ? <><Loader2 size={14} className="animate-spin" /> Scanning AWS…</>
              : <><Radar size={14} /> {discoveredAt ? 'Re-scan' : 'Run Discovery'}</>
            }
          </button>
        </div>
      </div>

      {/* Scanning progress */}
      {running && (
        <div className="rounded-[10px] border border-blue-200 bg-info-bg p-4 text-sm text-info" role="status">
          <div className="mb-1.5 flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" />
            <span className="font-medium">Scanning AWS account {account.account_id}…</span>
          </div>
          <p className="text-xs">
            Discovering VPCs, subnets, EC2, EKS, RDS, S3, load balancers, security groups,
            ECR, and IAM roles. This may take 10–20 seconds.
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full w-3/4 animate-pulse rounded-full bg-blue-400" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-danger-bg p-3 text-sm text-danger" role="alert">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary banner for accounts that have been scanned but result not loaded yet */}
      {!result && !running && discoveredAt && account.discovery_summary && (
        <div className="card p-4">
          <p className="mb-3 text-xs font-medium text-gray-500">
            Last scan summary — select “View Last Results” for full details
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'VPCs',       count: account.discovery_summary.vpc_count },
              { label: 'EC2',        count: account.discovery_summary.ec2_instance_count },
              { label: 'EKS',        count: account.discovery_summary.eks_cluster_count },
              { label: 'RDS',        count: account.discovery_summary.rds_instance_count },
              { label: 'S3 Buckets', count: account.discovery_summary.s3_bucket_count },
              { label: 'Load Bal.',  count: account.discovery_summary.load_balancer_count },
              { label: 'Sec Groups', count: account.discovery_summary.security_group_count },
              { label: 'IAM Roles',  count: account.discovery_summary.iam_role_count },
            ].map(({ label, count }) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-lg font-semibold text-gray-900 tabular-nums">{count}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full discovery results */}
      {result && !running && <DiscoveryResultsPanel result={result} />}

      {/* Empty state */}
      {!result && !running && !discoveredAt && !error && (
        <div className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
          <Radar size={22} className="text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No discovery scan yet</p>
          <p className="max-w-md text-xs text-gray-500">
            Run a discovery scan to see what AWS resources already exist in this account.
            This helps Infra Genie plan your deployment.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Error ownership ───────────────────────────────────────────────────────────

/** An error raised by an action on one specific account; rendered in that account's card. */
export interface AccountError {
  message: string;
  code?: string;
}

/**
 * An action on a single account failed. If the backend answered (any HTTP
 * status), the failure belongs to that account and is shown in its card. If no
 * response arrived at all (network down, backend unreachable) the problem is
 * not account-specific, so it is reported globally instead.
 */
function toAccountError(err: unknown, fallback: string): AccountError | null {
  if (err instanceof ApiError) return { message: err.message || fallback, code: err.code };
  return null;
}

/** Recovery guidance for structured backend error codes. */
const ERROR_HINTS: Record<string, string> = {
  NoCredentials:
    'This is an Infra Genie server configuration issue, not a problem with your AWS account. ' +
    'An administrator must configure AWS credentials for the backend, then select Verify Again.',
  AccessDenied:
    'Check that the CloudFormation stack deployed successfully and uses the External ID from this connection. ' +
    'Use Continue setup to download the template again.',
  AccessDeniedException:
    'Check that the CloudFormation stack deployed successfully and uses the External ID from this connection. ' +
    'Use Continue setup to download the template again.',
  NoSuchEntity: 'The IAM role was not found. Deploy the CloudFormation stack, then verify again.',
  AccountMismatch: 'The Role ARN belongs to a different AWS account. Use Continue setup to enter the correct ARN.',
  ExpiredTokenException: 'Temporary credentials expired. Select Verify Again to retry.',
};

function AccountErrorPanel({ error }: { error: AccountError }) {
  const hint = error.code ? ERROR_HINTS[error.code] : undefined;
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-red-200 bg-danger-bg px-3.5 py-3 text-danger" role="alert">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-[13px] leading-5">
        <p className="font-medium">{error.message}</p>
        {hint && <p className="mt-1 text-red-800/90">{hint}</p>}
        {error.code && (
          <p className="mt-1.5 font-mono text-[11px] text-red-700/80">Error code: {error.code}</p>
        )}
      </div>
    </div>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: CloudAccountOut;
  onVerifyAgain: (id: string) => void;
  onDisconnect: (id: string) => void;
  onContinueSetup: (id: string) => void;
  onDiscoveryComplete: () => void;
  verifyingId: string | null;
  disconnectingId: string | null;
  resumingId: string | null;
  /** Error from the most recent action on this account, if it failed. */
  actionError?: AccountError;
}

function AccountCard({
  account,
  onVerifyAgain,
  onDisconnect,
  onContinueSetup,
  onDiscoveryComplete,
  verifyingId,
  disconnectingId,
  resumingId,
  actionError,
}: AccountCardProps) {
  const isVerifying    = verifyingId === account.id;
  const isDisconnecting = disconnectingId === account.id;
  const isResuming     = resumingId === account.id;
  // PENDING: stack not deployed / ARN not entered yet. FAILED: user may need to
  // fix the stack or paste a different Role ARN.
  const canContinueSetup = account.status === 'PENDING' || account.status === 'FAILED';
  const [showDiscovery, setShowDiscovery] = useState(false);

  // One error panel per card: the latest action's error wins (it is fresher and
  // carries an error code); otherwise fall back to the error stored on the record.
  const cardError: AccountError | null =
    actionError ??
    (account.status === 'FAILED' && account.connection_error ? { message: account.connection_error } : null);

  return (
    <div className="card overflow-hidden">
      <div className="p-4 sm:p-5">
        {/* Identity + actions */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-orange-100 bg-orange-50 text-[#c2410c]">
              <Cloud size={20} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">{account.provider} Account</p>
                <StatusBadge status={account.status} />
              </div>
              <p className="mt-0.5 font-mono text-xs text-gray-500">{account.account_id}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {canContinueSetup && (
              <button
                onClick={() => onContinueSetup(account.id)}
                disabled={isResuming}
                className={`btn btn-sm ${account.status === 'PENDING' ? 'btn-primary' : 'btn-secondary'}`}
              >
                {isResuming ? (
                  <><Loader2 size={14} className="animate-spin" /> Loading…</>
                ) : (
                  <>Continue setup <ChevronRight size={14} /></>
                )}
              </button>
            )}

            {account.status === 'CONNECTED' && (
              <button
                onClick={() => setShowDiscovery((v) => !v)}
                className={`btn btn-sm ${showDiscovery ? 'btn-primary' : 'btn-secondary'}`}
                aria-expanded={showDiscovery}
              >
                <Radar size={14} />
                {showDiscovery ? 'Hide Discovery' : 'AWS Discovery'}
              </button>
            )}

            {(account.status === 'CONNECTED' || account.status === 'FAILED') && account.role_arn && (
              <button
                onClick={() => onVerifyAgain(account.id)}
                disabled={isVerifying}
                className="btn btn-secondary btn-sm"
              >
                {isVerifying ? (
                  <><Loader2 size={14} className="animate-spin" /> Verifying…</>
                ) : (
                  <><RefreshCw size={14} /> Verify Again</>
                )}
              </button>
            )}

            {account.status !== 'DISCONNECTED' && (
              <button
                onClick={() => onDisconnect(account.id)}
                disabled={isDisconnecting}
                className="btn btn-danger btn-sm"
              >
                {isDisconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {isDisconnecting ? 'Removing…' : 'Disconnect'}
              </button>
            )}
          </div>
        </div>

        {/* Detail grid */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-[13px] lg:grid-cols-5">
          {[
            ['Region',        account.region],
            ['Role',          account.role_arn ? 'InfraGenieExecutionRole' : '—'],
            ['Connected',     formatDate(account.created_at)],
            ['Last verified', formatDate(account.last_verified_at)],
            ['Last discovery', formatDate(account.discovery_ran_at)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-gray-500">{label}</dt>
              <dd className="mt-0.5 truncate font-medium text-gray-800" title={value ?? undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {account.status === 'PENDING' && (
          <p className="mt-4 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
            <Clock size={14} className="mt-0.5 shrink-0 text-amber-600" />
            Setup isn't finished. Deploy the CloudFormation stack in your AWS account, then
            paste the Role ARN to verify the connection.
          </p>
        )}

        {cardError && <AccountErrorPanel error={cardError} />}
      </div>

      {/* Discovery panel (expandable) */}
      {showDiscovery && account.status === 'CONNECTED' && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 sm:p-5">
          <DiscoveryPanel
            account={account}
            onDiscoveryComplete={onDiscoveryComplete}
          />
        </div>
      )}
    </div>
  );
}

// ── Empty state with onboarding steps ─────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    icon: KeyRound,
    title: 'Enter Account ID',
    desc: 'Provide your 12-digit AWS Account ID and the region you want to deploy into.',
  },
  {
    icon: FileCode2,
    title: 'Deploy CloudFormation',
    desc: 'Launch the generated stack to create a cross-account IAM role with a unique External ID.',
  },
  {
    icon: Radar,
    title: 'Discover & Deploy',
    desc: 'Infra Genie scans existing resources, then plans and deploys new infrastructure.',
  },
];

function NoAccountsState({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="no-accounts-heading">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary">
            <Cloud size={22} strokeWidth={1.75} />
          </div>
          <div>
            <h2 id="no-accounts-heading" className="section-title">No AWS accounts connected</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Infra Genie needs access to an AWS account to discover existing resources and deploy
              infrastructure. Setup takes about five minutes and only requires deploying one
              CloudFormation stack.
            </p>
          </div>
        </div>
        <button onClick={onConnect} className="btn btn-secondary shrink-0 self-start sm:self-center">
          Start setup
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="border-t border-gray-200 bg-gray-50/60 p-5 sm:p-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">How connecting works</p>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {ONBOARDING_STEPS.map(({ icon: Icon, title, desc }, i) => (
            <li key={title} className="relative flex gap-3 rounded-[10px] border border-gray-200 bg-white p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <Icon size={15} className="text-gray-400" aria-hidden />
                  {title}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-gray-500">{desc}</p>
              </div>
              {i < ONBOARDING_STEPS.length - 1 && (
                <span
                  className="absolute -right-[15px] top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 md:flex"
                  aria-hidden
                >
                  <ChevronRight size={14} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
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
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumeSetup, setResumeSetup] = useState<CloudAccountConnectResponse | null>(null);
  const [actionError, setActionError] = useState('');
  const [accountErrors, setAccountErrors] = useState<Record<string, AccountError>>({});

  const setAccountError = (id: string, error: AccountError | null) =>
    setAccountErrors((prev) => {
      if (!error) {
        if (!(id in prev)) return prev;
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: error };
    });

  /** Route a failed account action to its card, or to the global banner if it wasn't account-specific. */
  const reportAccountFailure = (id: string, err: unknown, fallback: string) => {
    const owned = toAccountError(err, fallback);
    if (owned) setAccountError(id, owned);
    else if (err instanceof TypeError) setActionError("Couldn't reach the Infra Genie backend. Check that it's running and try again.");
    else setActionError(err instanceof Error ? err.message : fallback);
  };
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

  // While the wizard is open: close on Escape, lock background scrolling, and
  // return focus to the element that opened it.
  useEffect(() => {
    if (!showWizard) return;
    const opener = document.activeElement as HTMLElement | null;
    const scrollers = [document.body, document.querySelector('main')].filter(Boolean) as HTMLElement[];
    const prev = scrollers.map((el) => el.style.overflow);
    scrollers.forEach((el) => { el.style.overflow = 'hidden'; });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowWizard(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      scrollers.forEach((el, i) => { el.style.overflow = prev[i]; });
      opener?.focus?.();
    };
  }, [showWizard]);

  const openWizard = () => {
    setResumeSetup(null);
    setShowWizard(true);
    setActionError('');
    setActionSuccess('');
  };

  /** Re-open the wizard at the CloudFormation step for an unfinished connection. */
  const handleContinueSetup = async (connectionId: string) => {
    setActionError('');
    setActionSuccess('');
    setResumingId(connectionId);
    try {
      const setup = await getAWSConnectionSetup(connectionId);
      setResumeSetup(setup);
      setShowWizard(true);
    } catch (err: unknown) {
      reportAccountFailure(connectionId, err, 'Could not load setup details.');
    } finally {
      setResumingId(null);
    }
  };

  const handleVerifyAgain = async (connectionId: string) => {
    const account = accounts.find((a) => a.id === connectionId);
    if (!account?.role_arn) return;
    setActionError('');
    setActionSuccess('');
    setAccountError(connectionId, null);
    setVerifyingId(connectionId);
    try {
      const result = await verifyAWSConnection(connectionId, { role_arn: account.role_arn });
      if (result.status === 'CONNECTED') {
        setActionSuccess(`AWS account ${account.account_id} verified successfully.`);
      } else {
        setAccountError(connectionId, {
          message: result.message ?? 'Verification failed.',
          code: result.error_code,
        });
      }
    } catch (err: unknown) {
      reportAccountFailure(connectionId, err, 'Verification failed.');
    } finally {
      setVerifyingId(null);
    }
    // Refresh either way so status / last-verified reflect what the backend stored.
    await loadAccounts();
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
    setAccountError(connectionId, null);
    setDisconnectingId(connectionId);
    try {
      await disconnectAWSAccount(connectionId);
      setActionSuccess(`AWS account ${account.account_id} disconnected.`);
      await loadAccounts();
    } catch (err: unknown) {
      reportAccountFailure(connectionId, err, 'Failed to disconnect.');
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleConnected = async (newAccount: CloudAccountOut) => {
    setShowWizard(false);
    setAccountError(newAccount.id, null);
    setActionSuccess(`AWS account ${newAccount.account_id} connected successfully!`);
    await loadAccounts();
  };

  const handleDiscoveryComplete = () => {
    // Silently refresh account list so discovery_ran_at updates
    loadAccounts();
  };

  const connected = accounts.filter((a) => a.status === 'CONNECTED');
  const pending   = accounts.filter((a) => a.status === 'PENDING' || a.status === 'VERIFYING');
  const failed    = accounts.filter((a) => a.status === 'FAILED');
  const other     = accounts.filter((a) => a.status === 'DISCONNECTED');

  // Before the first load completes, show placeholders rather than misleading zeros.
  const hasData = !loading || accounts.length > 0;
  const count = (n: number) => (hasData && !loadError ? n : '—');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      <PageHeader
        title="Cloud Accounts"
        description="Connect and manage your AWS accounts."
        icon={Cloud}
        actions={
          <>
            <button
              onClick={loadAccounts}
              disabled={loading}
              className="btn btn-secondary btn-icon"
              title="Refresh"
              aria-label="Refresh accounts"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={openWizard} className="btn btn-primary">
              <Plus size={16} />
              Connect AWS Account
            </button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Connected"    value={count(connected.length)} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending"      value={count(pending.length)}   icon={Clock}        tone="warning" />
        <StatCard label="Failed"       value={count(failed.length)}    icon={XCircle}      tone="danger" />
        <StatCard label="Disconnected" value={count(other.length)}     icon={WifiOff}      tone="neutral" />
      </div>

      {/* Action feedback */}
      {actionSuccess && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-green-200 bg-success-bg px-4 py-2.5 text-sm text-success" role="status">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            {actionSuccess}
          </div>
          <button onClick={() => setActionSuccess('')} className="btn btn-ghost btn-sm btn-icon -mr-2" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-danger-bg px-4 py-2.5 text-sm text-danger" role="alert">
          <div className="flex items-center gap-2">
            <XCircle size={16} className="shrink-0" />
            {actionError}
          </div>
          <button onClick={() => setActionError('')} className="btn btn-ghost btn-sm btn-icon -mr-2" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Wizard modal */}
      {/* Portalled to <body> so the overlay sits outside the page's scroll region. */}
      {showWizard && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 sm:p-6"
          onClick={(e) => e.target === e.currentTarget && setShowWizard(false)}
        >
          <AWSConnectWizard
            key={resumeSetup?.connection_id ?? 'new'}
            resume={resumeSetup}
            onConnected={handleConnected}
            onCancel={() => { setShowWizard(false); loadAccounts(); }}
          />
        </div>,
        document.body,
      )}

      {/* Content */}
      {loading && accounts.length === 0 ? (
        <div className="card">
          <LoadingState label="Loading accounts…" />
        </div>
      ) : loadError ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
          <XCircle size={28} className="text-red-500" />
          <p className="text-sm text-gray-600">{loadError}</p>
          <button onClick={loadAccounts} className="btn btn-secondary btn-sm">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : accounts.length === 0 ? (
        <NoAccountsState onConnect={openWizard} />
      ) : (
        /* Account cards */
        <div className="space-y-6">
          {[
            { heading: 'Connected', items: connected },
            { heading: 'Pending setup', items: pending },
            { heading: 'Failed', items: failed },
            { heading: 'Disconnected', items: other },
          ]
            .filter(({ items }) => items.length > 0)
            .map(({ heading, items }) => (
              <section key={heading} aria-label={heading}>
                <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  {heading}
                  <span className="badge badge-neutral">{items.length}</span>
                </h2>
                <div className="space-y-3">
                  {items.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      onVerifyAgain={handleVerifyAgain}
                      onDisconnect={handleDisconnect}
                      onContinueSetup={handleContinueSetup}
                      onDiscoveryComplete={handleDiscoveryComplete}
                      verifyingId={verifyingId}
                      disconnectingId={disconnectingId}
                      resumingId={resumingId}
                      actionError={accountErrors[account.id]}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}

      {/* Security note */}
      <div className="flex gap-3 rounded-[10px] border border-gray-200 bg-white px-4 py-3 text-xs leading-5 text-gray-500">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
        <p>
          <span className="font-medium text-gray-700">Security:</span> Infra Genie never stores
          your AWS access keys or secret keys. All access uses temporary STS credentials
          obtained via cross-account IAM role assumption with a unique External ID per
          connection. Discovery calls are read-only (Describe / List) — no resources are
          created or modified during scanning.
        </p>
      </div>
    </div>
  );
}
