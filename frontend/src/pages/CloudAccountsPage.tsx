/**
 * CloudAccountsPage.tsx
 *
 * Displays all connected AWS accounts and hosts:
 *  • AWSConnectWizard for adding new connections
 *  • AWS Discovery panel — trigger scan, view structured inventory results
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
  Search,
  ChevronDown,
  ChevronRight,
  Server,
  Database,
  Shield,
  Box,
  HardDrive,
  Network,
  Cpu,
  Archive,
  Globe,
} from 'lucide-react';
import {
  listAWSConnections,
  verifyAWSConnection,
  disconnectAWSAccount,
  runAWSDiscovery,
  getAWSDiscoveryResult,
  type CloudAccountOut,
  type CloudAccountStatus,
  type DiscoveryResult,
  type DiscoverySummary,
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

// ── Discovery Summary cards ───────────────────────────────────────────────────

interface SummaryTileProps {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}

function SummaryTile({ label, count, icon, color, sub }: SummaryTileProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-800 leading-none">{count}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>}
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
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-500">{icon}</span>
          <span className="font-semibold text-slate-700 text-sm">{title}</span>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
            {count}
          </span>
        </div>
        {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </div>
  );
}

// ── Resource Table ────────────────────────────────────────────────────────────

function ResourceTable({ columns, rows }: {
  columns: string[];
  rows: (string | number | boolean | null | undefined)[][];
}) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50">
            {columns.map((col) => (
              <th key={col} className="text-left px-3 py-2 text-slate-500 font-semibold border-b border-slate-100 whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-slate-700 font-mono whitespace-nowrap max-w-[200px] truncate" title={String(cell ?? '—')}>
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
    {
      label: 'VPCs',
      count: s.vpc_count,
      icon: <Network size={16} className="text-blue-600" />,
      color: 'bg-blue-50',
    },
    {
      label: 'Subnets',
      count: s.subnet_count,
      icon: <Globe size={16} className="text-cyan-600" />,
      color: 'bg-cyan-50',
    },
    {
      label: 'Security Groups',
      count: s.security_group_count,
      icon: <Shield size={16} className="text-violet-600" />,
      color: 'bg-violet-50',
    },
    {
      label: 'EC2 Instances',
      count: s.ec2_instance_count,
      icon: <Server size={16} className="text-emerald-600" />,
      color: 'bg-emerald-50',
      sub: Object.entries(s.ec2_by_state || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    {
      label: 'Load Balancers',
      count: s.load_balancer_count,
      icon: <Cpu size={16} className="text-orange-600" />,
      color: 'bg-orange-50',
      sub: Object.entries(s.lb_by_type || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    {
      label: 'EKS Clusters',
      count: s.eks_cluster_count,
      icon: <Box size={16} className="text-indigo-600" />,
      color: 'bg-indigo-50',
    },
    {
      label: 'RDS Instances',
      count: s.rds_instance_count,
      icon: <Database size={16} className="text-rose-600" />,
      color: 'bg-rose-50',
      sub: Object.entries(s.rds_by_engine || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || undefined,
    },
    {
      label: 'S3 Buckets',
      count: s.s3_bucket_count,
      icon: <Archive size={16} className="text-amber-600" />,
      color: 'bg-amber-50',
    },
    {
      label: 'NAT Gateways',
      count: s.nat_gateway_count,
      icon: <HardDrive size={16} className="text-teal-600" />,
      color: 'bg-teal-50',
    },
    {
      label: 'ECR Repos',
      count: s.ecr_repo_count,
      icon: <Box size={16} className="text-pink-600" />,
      color: 'bg-pink-50',
    },
    {
      label: 'IAM Roles',
      count: s.iam_role_count,
      icon: <Shield size={16} className="text-slate-600" />,
      color: 'bg-slate-100',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {summaryTiles.filter((t) => t.count > 0).map((tile) => (
          <SummaryTile key={tile.label} {...tile} />
        ))}
        {summaryTiles.every((t) => t.count === 0) && (
          <div className="col-span-full text-center py-6 text-slate-400 text-sm">
            No AWS resources found in region <code className="font-mono">{result.region}</code>.
          </div>
        )}
      </div>

      {/* Detailed resource sections */}
      <div className="space-y-3">

        {/* VPCs */}
        <ResourceSection title="VPCs" icon={<Network size={15} />} count={result.vpcs.length} defaultOpen>
          <ResourceTable
            columns={['VPC ID', 'CIDR', 'State', 'Default', 'Name']}
            rows={result.vpcs.map((v) => [v.vpc_id, v.cidr, v.state, v.is_default, v.name || '—'])}
          />
        </ResourceSection>

        {/* Subnets */}
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

        {/* Security Groups */}
        <ResourceSection title="Security Groups" icon={<Shield size={15} />} count={result.security_groups.length}>
          <ResourceTable
            columns={['SG ID', 'Name', 'VPC ID', 'Inbound Rules', 'Outbound Rules']}
            rows={result.security_groups.map((sg) => [
              sg.sg_id, sg.name, sg.vpc_id,
              sg.inbound.length, sg.outbound.length,
            ])}
          />
        </ResourceSection>

        {/* EC2 Instances */}
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

        {/* Load Balancers */}
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

        {/* EKS Clusters */}
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

        {/* RDS Instances */}
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

        {/* S3 Buckets */}
        <ResourceSection title="S3 Buckets" icon={<Archive size={15} />} count={result.s3_buckets.length}>
          <ResourceTable
            columns={['Bucket Name', 'Region', 'Created']}
            rows={result.s3_buckets.map((b) => [b.name, b.region || '—', formatDate(b.created_at)])}
          />
        </ResourceSection>

        {/* ECR Repositories */}
        <ResourceSection title="ECR Repositories" icon={<Box size={15} />} count={result.ecr_repositories.length}>
          <ResourceTable
            columns={['Name', 'URI', 'Scan on Push']}
            rows={(result.ecr_repositories as any[]).map((r) => [
              r.name, r.uri, r.scan_on_push,
            ])}
          />
        </ResourceSection>

        {/* IAM Roles */}
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-slate-700 text-sm">AWS Infrastructure Discovery</h3>
          {discoveredAt ? (
            <p className="text-xs text-slate-400 mt-0.5">
              Last scanned: {formatDate(discoveredAt)}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">No scan has been run yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          {discoveredAt && !result && (
            <button
              onClick={handleLoadCached}
              disabled={loadingCached}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {loadingCached
                ? <><Loader2 size={12} className="animate-spin" /> Loading…</>
                : <><Search size={12} /> View Last Results</>
              }
            </button>
          )}
          <button
            onClick={handleRunDiscovery}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1e3a7a] text-white text-xs font-semibold hover:bg-[#2d52a8] disabled:opacity-50 transition-colors"
          >
            {running
              ? <><Loader2 size={12} className="animate-spin" /> Scanning AWS…</>
              : <><Search size={12} /> {discoveredAt ? 'Re-scan' : 'Run Discovery'}</>
            }
          </button>
        </div>
      </div>

      {/* Scanning progress */}
      {running && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={15} className="animate-spin text-blue-500" />
            <span className="font-semibold">Scanning AWS account {account.account_id}…</span>
          </div>
          <p className="text-xs text-blue-600">
            Discovering VPCs, subnets, EC2, EKS, RDS, S3, load balancers, security groups,
            ECR, and IAM roles. This may take 10–20 seconds.
          </p>
          <div className="mt-3 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full animate-pulse w-3/4" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <XCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary banner for accounts that have been scanned but result not loaded yet */}
      {!result && !running && discoveredAt && account.discovery_summary && (
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Last Scan Summary — click "View Last Results" to see details
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              <div key={label} className="bg-white rounded-lg border border-slate-100 p-2.5 text-center">
                <p className="text-lg font-bold text-slate-800">{count}</p>
                <p className="text-xs text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full discovery results */}
      {result && !running && <DiscoveryResultsPanel result={result} />}

      {/* Empty state */}
      {!result && !running && !discoveredAt && !error && (
        <div className="flex flex-col items-center gap-3 py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <Search size={28} className="text-slate-300" />
          <div>
            <p className="text-sm font-semibold text-slate-600">No discovery scan yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Run a discovery scan to see what AWS resources already exist in this account.
              This helps Infra Genie plan your deployment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: CloudAccountOut;
  onVerifyAgain: (id: string) => void;
  onDisconnect: (id: string) => void;
  onDiscoveryComplete: () => void;
  verifyingId: string | null;
  disconnectingId: string | null;
}

function AccountCard({
  account,
  onVerifyAgain,
  onDisconnect,
  onDiscoveryComplete,
  verifyingId,
  disconnectingId,
}: AccountCardProps) {
  const isVerifying    = verifyingId === account.id;
  const isDisconnecting = disconnectingId === account.id;
  const [showDiscovery, setShowDiscovery] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <div className="p-5">
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
            ['Region',        account.region],
            ['Role',          account.role_arn ? 'InfraGenieExecutionRole' : '—'],
            ['Connected',     formatDate(account.created_at)],
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

        {/* Discovery badge */}
        {account.discovery_ran_at && (
          <div className="mb-4 flex items-center gap-1.5 text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1.5">
            <Search size={11} className="shrink-0" />
            <span>Discovery ran: {formatDate(account.discovery_ran_at)}</span>
          </div>
        )}

        {/* Error message */}
        {account.status === 'FAILED' && account.connection_error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700 mb-4">
            <AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-500" />
            <span>{account.connection_error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {(account.status === 'CONNECTED' || account.status === 'FAILED') && account.role_arn && (
            <button
              onClick={() => onVerifyAgain(account.id)}
              disabled={isVerifying}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#1e3a7a] text-[#1e3a7a] text-xs font-semibold hover:bg-[#1e3a7a]/5 disabled:opacity-50 transition-colors"
            >
              {isVerifying ? (
                <><Loader2 size={13} className="animate-spin" /> Verifying…</>
              ) : (
                <><RefreshCw size={13} /> Verify Again</>
              )}
            </button>
          )}

          {account.status === 'CONNECTED' && (
            <button
              onClick={() => setShowDiscovery((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${
                showDiscovery
                  ? 'bg-[#1e3a7a] text-white border-[#1e3a7a]'
                  : 'border-teal-300 text-teal-700 hover:bg-teal-50'
              }`}
            >
              <Search size={13} />
              {showDiscovery ? 'Hide Discovery' : 'AWS Discovery'}
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

      {/* Discovery panel (expandable) */}
      {showDiscovery && account.status === 'CONNECTED' && (
        <div className="border-t border-slate-100 p-5 bg-slate-50/50">
          <DiscoveryPanel
            account={account}
            onDiscoveryComplete={onDiscoveryComplete}
          />
        </div>
      )}
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

  const handleDiscoveryComplete = () => {
    // Silently refresh account list so discovery_ran_at updates
    loadAccounts();
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
                Connect AWS accounts and discover existing infrastructure.
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
                  title: 'Discover & Deploy',
                  desc: 'Infra Genie scans existing resources then plans and deploys new infrastructure.',
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
                  <div className="space-y-4">
                    {items.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        onVerifyAgain={handleVerifyAgain}
                        onDisconnect={handleDisconnect}
                        onDiscoveryComplete={handleDiscoveryComplete}
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
            connection. Discovery calls are read-only (Describe / List) — no resources are
            created or modified during scanning.
          </p>
        </div>
      </div>
    </div>
  );
}
