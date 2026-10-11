/**
 * ui.tsx — shared layout primitives used by every app page so headings,
 * stat tiles, empty/loading/error states look the same everywhere.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-primary-100 bg-primary-50 text-primary sm:flex">
            <Icon size={20} strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {description && <p className="page-subtitle mt-0.5">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export type Tone = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE: Record<Tone, { icon: string; dot: string; value: string }> = {
  primary: { icon: 'bg-primary-50 text-primary', dot: 'bg-primary', value: 'text-gray-900' },
  accent:  { icon: 'bg-accent-50 text-accent-700', dot: 'bg-accent', value: 'text-gray-900' },
  success: { icon: 'bg-success-bg text-success', dot: 'bg-emerald-500', value: 'text-gray-900' },
  warning: { icon: 'bg-warning-bg text-warning', dot: 'bg-amber-500', value: 'text-gray-900' },
  danger:  { icon: 'bg-danger-bg text-danger', dot: 'bg-red-500', value: 'text-gray-900' },
  info:    { icon: 'bg-info-bg text-info', dot: 'bg-blue-500', value: 'text-gray-900' },
  neutral: { icon: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', value: 'text-gray-900' },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className="card flex items-center gap-3.5 px-4 py-3.5">
      {Icon ? (
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${t.icon}`}>
          <Icon size={18} strokeWidth={1.9} />
        </div>
      ) : (
        <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} aria-hidden />
      )}
      <div className="min-w-0">
        <p className="truncate text-[13px] text-gray-500">{label}</p>
        <p className={`text-[22px] font-semibold leading-7 tabular-nums ${t.value}`}>{value}</p>
        {hint && <p className="truncate text-xs text-gray-400">{hint}</p>}
      </div>
    </div>
  );
}

// ── Empty / loading / error states ───────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary">
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-[13px] leading-5 text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-12 text-sm text-gray-500 ${className}`} role="status">
      <Loader2 size={18} className="animate-spin text-primary" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-red-200 bg-danger-bg px-4 py-3" role="alert">
      <AlertTriangle size={16} className="shrink-0 text-danger" />
      <p className="flex-1 text-sm text-danger">{message}</p>
      {action}
    </div>
  );
}
