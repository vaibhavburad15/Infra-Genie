// src/pages/AgentsPage.tsx
// AI Agent Fleet — server-driven management page.
//
// All data comes from the backend /agents API (see backend/agent_routes.py):
//   GET /agents        → full roster + per-user enable state + real run stats
//   GET /agents/{id}   → single agent state
//   PUT /agents/{id}   → enable / disable an agent (persisted in PostgreSQL)
//
// No localStorage. If the backend is unreachable, the page shows a warning
// banner and a transient in-memory fallback (all enabled) so the UI still
// renders — nothing is persisted client-side.

import { useEffect, useMemo, useState } from 'react';
import { type LucideIcon } from 'lucide-react';
import {
  Bot, Container, Cloud, Network, Workflow, ServerCog,
  Activity, ShieldCheck, BadgeDollarSign, TerminalSquare, Boxes,
  Send, Power, PowerOff, Sparkles, Clock, TrendingUp, CircleDot,
  Search, CheckCircle2, AlertTriangle, Play, Pause, Info, WifiOff, RefreshCw,
} from 'lucide-react';
import { listAgents, setAgentEnabled, type AgentInfo } from '@/api';

const CATEGORY_META: Record<string, { label: string; tint: string; text: string }> = {
  analysis:   { label: 'Analysis',   tint: 'bg-[#edf3fb]', text: 'text-[#1e3a7a]' },
  artifacts:  { label: 'Artifacts',  tint: 'bg-[#fdf3eb]', text: 'text-[#8b3d14]' },
  operations: { label: 'Operations', tint: 'bg-emerald-50', text: 'text-emerald-700' },
};

// Maps agent_id → Lucide icon component. Icons are a frontend concern only;
// the AgentInfo type from the API has no `icon` field.
const AGENT_ICONS: Record<string, LucideIcon> = {
  analyzer:     Bot,
  discovery:    Network,
  docker:       Container,
  terraform:    Cloud,
  kubernetes:   Boxes,
  cicd:         Workflow,
  architecture: ServerCog,
  monitoring:   Activity,
  security:     ShieldCheck,
  cost:         BadgeDollarSign,
};

// Category fallbacks for any future agents not in the map above.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  analysis:   Bot,
  artifacts:  ServerCog,
  operations: Activity,
};

function getAgentIcon(agent: AgentInfo): LucideIcon {
  return AGENT_ICONS[agent.agent_id] ?? CATEGORY_ICONS[agent.category] ?? Bot;
}

function timeAgo(iso?: string | null) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type FilterKey = 'all' | 'active' | 'disabled' | 'analysis' | 'artifacts' | 'operations';

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [coreIds, setCoreIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listAgents();
      setAgents(res.agents);
      setCoreIds(res.core_agent_ids);
      setSelectedId((prev) =>
        prev && res.agents.some((a) => a.agent_id === prev)
          ? prev
          : (res.agents[0]?.agent_id ?? ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selected = agents.find((a) => a.agent_id === selectedId) ?? agents[0];
  const totalEnabled = agents.filter((a) => a.enabled).length;
  const totalRuns = agents.reduce((s, a) => s + a.runs, 0);
  const avgSuccess = agents.length
    ? Math.round(
        (agents.reduce((s, a) => s + (a.runs ? a.successes / a.runs : 1), 0) / agents.length) * 100,
      )
    : 0;

  const filteredAgents = useMemo(
    () =>
      agents.filter((a) => {
        if (query && !`${a.name} ${a.role}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (filter === 'all') return true;
        if (filter === 'active') return a.enabled;
        if (filter === 'disabled') return !a.enabled;
        return a.category === filter;
      }),
    [agents, filter, query],
  );

  async function toggle(agent: AgentInfo) {
    if (!agent.optional || togglingId) return;
    setTogglingId(agent.agent_id);
    setError(null);
    try {
      const updated = await setAgentEnabled(agent.agent_id, !agent.enabled);
      setAgents((prev) => prev.map((a) => (a.agent_id === updated.agent_id ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    } finally {
      setTogglingId(null);
    }
  }

  async function bulkToggle(enable: boolean) {
    setError(null);
    try {
      await Promise.all(
        agents.filter((a) => a.optional).map((a) => setAgentEnabled(a.agent_id, enable)),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f4f6fa]">
      {/* ─── Main pane ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-gray-800 text-lg font-bold">AI Agent Fleet</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {loading ? (
                  'Loading agents…'
                ) : (
                  <>
                    <span className="font-semibold text-emerald-600">{totalEnabled} active</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>{agents.length} total agents</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>
                      {agents.filter((a) => a.optional && a.enabled).length}/
                      {agents.filter((a) => a.optional).length} optional enabled
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => bulkToggle(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#1e3a7a] hover:text-[#1e3a7a] transition-colors"
              >
                <Play size={12} /> Enable all
              </button>
              <button
                onClick={() => bulkToggle(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#c9692a] hover:text-[#c9692a] transition-colors"
              >
                <Pause size={12} /> Disable all
              </button>
              <button
                onClick={load}
                title="Refresh"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-[#1e3a7a] transition-colors"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-3">
              <WifiOff size={14} className="mt-0.5 text-rose-500 flex-shrink-0" />
              <div className="text-xs leading-relaxed text-rose-700">
                <strong>Backend unreachable.</strong> {error} — showing transient defaults (all
                enabled). Start the FastAPI backend to load real agent state. Nothing is saved
                client-side.
              </div>
            </div>
          )}

          {/* Info banner explaining behavior */}
          <div className="rounded-xl bg-[#edf3fb] border border-[#1e3a7a]/10 px-4 py-3 flex items-start gap-3">
            <Info size={14} className="mt-0.5 text-[#1e3a7a] flex-shrink-0" />
            <div className="text-xs leading-relaxed text-[#1e3a7a]">
              <strong>Two of ten agents are core</strong> (Project Analyzer and Application
              Discovery) — they run on every project and cannot be disabled. The remaining{' '}
              <strong>eight generation agents</strong> can be turned off individually; disabled
              agents skip their step in the pipeline and their artifacts are omitted from the
              deployment plan. State is stored per-user in the backend database.
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Active', value: totalEnabled, icon: Power, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Disabled', value: agents.length - totalEnabled, icon: PowerOff, color: 'text-[#c9692a]', bg: 'bg-[#fdf3eb]' },
              { label: 'Total runs', value: totalRuns, icon: TrendingUp, color: 'text-[#1e3a7a]', bg: 'bg-[#edf3fb]' },
              { label: 'Avg success', value: `${avgSuccess}%`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon size={14} className={s.color} />
                  </div>
                </div>
                <p className="text-gray-800 text-lg font-bold leading-tight">{s.value}</p>
                <p className="text-gray-400 text-[11px] uppercase tracking-wider font-semibold mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[220px] max-w-md">
              <Search size={13} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents by name or role..."
                className="flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
              {(['all', 'active', 'disabled', 'analysis', 'artifacts', 'operations'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={[
                    'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors capitalize',
                    filter === f
                      ? 'bg-[#1e3a7a] text-white shadow-sm'
                      : 'text-gray-500 hover:text-[#1e3a7a]',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Agent grid */}
          {loading ? (
            <div className="py-20 text-center text-gray-400 text-xs">Loading agent fleet…</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredAgents.map((agent) => {
                const enabled = agent.enabled;
                const successRate = agent.runs ? Math.round((agent.successes / agent.runs) * 100) : 100;
                const cat = CATEGORY_META[agent.category] ?? { label: agent.category, tint: 'bg-slate-100', text: 'text-slate-600' };
                const isCore = coreIds.includes(agent.agent_id);
                const isSelected = selectedId === agent.agent_id;
                const isToggling = togglingId === agent.agent_id;
                return (
                  <div
                    key={agent.agent_id}
                    onClick={() => setSelectedId(agent.agent_id)}
                    className={[
                      'group relative bg-white rounded-2xl border p-5 cursor-pointer transition-all',
                      isSelected
                        ? 'border-[#c9692a] shadow-[0_8px_28px_-8px_rgba(201,105,42,0.35)]'
                        : 'border-gray-100 hover:border-[#1e3a7a]/30 hover:shadow-md',
                      !enabled ? 'opacity-70' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={[
                          'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0',
                          enabled
                            ? 'bg-gradient-to-br from-[#1e3a7a] to-[#24478f] text-white'
                            : 'bg-gray-100 text-gray-400',
                        ].join(' ')}
                      >
                        {(() => { const Icon = getAgentIcon(agent); return <Icon size={20} />; })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-gray-800 truncate">{agent.name}</h3>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${cat.tint} ${cat.text}`}>
                            {cat.label}
                          </span>
                          {isCore && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                              Core
                            </span>
                          )}
                        </div>
                        <p className="text-gray-500 text-xs mt-0.5">{agent.role}</p>
                      </div>

                      {/* Toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggle(agent); }}
                        disabled={!agent.optional || isToggling}
                        title={agent.optional ? (enabled ? 'Disable this agent' : 'Enable this agent') : 'Core agent — always on'}
                        className={[
                          'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
                          enabled ? 'bg-emerald-500' : 'bg-gray-300',
                          !agent.optional || isToggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                            enabled ? 'translate-x-4' : 'translate-x-0.5',
                          ].join(' ')}
                        />
                      </button>
                    </div>

                    {/* Outputs */}
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {agent.outputs.map((o) => (
                        <span
                          key={o}
                          className="text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-0.5"
                        >
                          {o}
                        </span>
                      ))}
                    </div>

                    {/* Stats footer */}
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-2 text-[10.5px]">
                      <div>
                        <p className="text-gray-400 uppercase tracking-wider font-semibold">Status</p>
                        <p className={`mt-0.5 font-bold flex items-center gap-1 ${enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                          <CircleDot size={9} className={enabled ? 'animate-pulse' : ''} />
                          {enabled ? 'Live' : 'Disabled'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase tracking-wider font-semibold">Last run</p>
                        <p className="mt-0.5 font-bold text-gray-700">{timeAgo(agent.last_run_at)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase tracking-wider font-semibold">Success</p>
                        <p className={`mt-0.5 font-bold ${successRate >= 95 ? 'text-emerald-600' : successRate >= 85 ? 'text-[#c9692a]' : 'text-red-500'}`}>
                          {successRate}%
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredAgents.length === 0 && (
                <div className="col-span-full py-16 text-center text-gray-400 text-xs">
                  No agents match your filter.{' '}
                  <button
                    className="text-[#1e3a7a] font-semibold underline"
                    onClick={() => { setFilter('all'); setQuery(''); }}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Detail panel ─────────────────────────────────────── */}
      <div className="w-96 border-l border-gray-100 flex flex-col flex-shrink-0 bg-white">
        {selected ? (
          <>
            {/* Selected agent header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={[
                    'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0',
                    selected.enabled
                      ? 'bg-gradient-to-br from-[#1e3a7a] to-[#24478f] text-white'
                      : 'bg-gray-100 text-gray-400',
                  ].join(' ')}
                >
                  {(() => { const Icon = getAgentIcon(selected); return <Icon size={20} />; })()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-gray-800 text-sm font-bold truncate">{selected.name}</h3>
                  <span className="text-gray-400 text-[11px]">{selected.role}</span>
                </div>
                <button
                  onClick={() => toggle(selected)}
                  disabled={!selected.optional || !!togglingId}
                  className={[
                    'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
                    selected.optional
                      ? 'bg-gray-50 hover:bg-[#fdf3eb] text-gray-500 hover:text-[#c9692a] cursor-pointer'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed',
                  ].join(' ')}
                  title={selected.optional ? 'Toggle agent' : 'Core agent — always on'}
                >
                  {selected.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-600">{selected.description}</p>
            </div>

            {/* Config */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-gray-800 text-xs font-semibold mb-2">Configuration</p>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Model</span>
                  <span className="text-gray-700 font-mono">{selected.model}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Category</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${CATEGORY_META[selected.category]?.tint ?? 'bg-slate-100'} ${CATEGORY_META[selected.category]?.text ?? 'text-slate-600'}`}>
                    {CATEGORY_META[selected.category]?.label ?? selected.category}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Median runtime</span>
                  <span className="text-gray-700 font-semibold">{selected.median_runtime_sec}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Runs / Successes</span>
                  <span className="text-gray-700 font-semibold">
                    {selected.runs} / {selected.successes}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Optional</span>
                  <span className={`font-semibold ${selected.optional ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {selected.optional ? 'Yes — can be disabled' : 'No — core agent'}
                  </span>
                </div>
              </div>
            </div>

            {/* Recent activity */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-gray-800 text-xs font-semibold mb-2">Recent activity</p>
              <ul className="space-y-2">
                {[
                  { label: 'Last run', time: timeAgo(selected.last_run_at), icon: Clock, tone: 'text-[#1e3a7a]' },
                  { label: 'Successful runs', time: String(selected.successes), icon: CheckCircle2, tone: 'text-emerald-500' },
                  { label: 'Median runtime', time: `${selected.median_runtime_sec}s`, icon: Sparkles, tone: 'text-[#c9692a]' },
                  { label: 'State updated', time: timeAgo(selected.updated_at), icon: AlertTriangle, tone: 'text-gray-400' },
                ].map((row) => {
                  const Icon = row.icon;
                  return (
                    <li key={row.label} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-2 text-gray-600">
                        <Icon size={11} className={row.tone} />
                        {row.label}
                      </span>
                      <span className="text-gray-700 font-semibold">{row.time}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Console */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-gray-800 text-xs font-semibold">Agent Console</p>
                <span className="text-[10px] text-gray-400">{selected.name}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[10.5px] bg-gray-50">
                <ConsoleLine tone="system">Session started with agent: {selected.agent_id}</ConsoleLine>
                <ConsoleLine tone="info">Model: {selected.model}</ConsoleLine>
                <ConsoleLine tone="success">Status: {selected.enabled ? 'live' : 'disabled'}</ConsoleLine>
                <ConsoleLine tone="muted">─────────────────────────</ConsoleLine>
                <ConsoleLine tone="info">Waiting for command — try:</ConsoleLine>
                <ConsoleLine tone="muted">  › /status</ConsoleLine>
                <ConsoleLine tone="muted">  › /rerun last</ConsoleLine>
                <ConsoleLine tone="muted">  › /explain output</ConsoleLine>
              </div>
              <div className="p-3 border-t border-gray-100">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-[#1e3a7a]">
                  <TerminalSquare size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={`Send a command to ${selected.name}...`}
                    className="flex-1 bg-transparent text-gray-700 text-xs placeholder-gray-400 focus:outline-none"
                  />
                  <button
                    disabled={!message.trim()}
                    onClick={() => setMessage('')}
                    className={[
                      'flex-shrink-0',
                      message.trim() ? 'text-[#c9692a] cursor-pointer' : 'text-gray-300 cursor-not-allowed',
                    ].join(' ')}
                  >
                    <Send size={13} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Console is read-only until agent chat is wired to the backend.</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div>
              <Bot size={24} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-xs">No agent selected.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Small helper for colored console lines ────────────────────────────── */

function ConsoleLine({ tone, children }: { tone: 'system' | 'info' | 'success' | 'muted'; children: React.ReactNode }) {
  const cls = {
    system: 'text-[#c9692a]',
    info: 'text-[#1e3a7a]',
    success: 'text-emerald-600',
    muted: 'text-gray-400',
  }[tone];
  return <div className={cls}>{children}</div>;
}
