import { useEffect, useState } from 'react';
import {
  Server, GitBranch, Rocket, Activity, CheckCircle2, Clock,
  ArrowUp, Zap, Shield, DollarSign, Loader, FolderGit2, Construction,
} from 'lucide-react';
import { listProjects, type Project } from '@/api';

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  pending:   { dot: 'bg-gray-400',                text: 'text-gray-500',    bg: 'bg-gray-100',   label: 'Pending' },
  analyzing: { dot: 'bg-[#c9692a] animate-pulse', text: 'text-[#c9692a]',  bg: 'bg-[#fdf3eb]',  label: 'Analyzing' },
  ready:     { dot: 'bg-emerald-500',             text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Ready' },
  deploying: { dot: 'bg-[#1e3a7a] animate-pulse', text: 'text-[#1e3a7a]',  bg: 'bg-[#edf3fb]',  label: 'Deploying' },
  deployed:  { dot: 'bg-emerald-500',             text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Deployed' },
  failed:    { dot: 'bg-red-500',                 text: 'text-red-600',     bg: 'bg-red-50',     label: 'Failed' },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total    = projects.length;
  const deployed = projects.filter((p) => p.status === 'deployed').length;
  const failed   = projects.filter((p) => p.status === 'failed').length;
  const pending  = projects.filter((p) => ['pending', 'analyzing'].includes(p.status)).length;

  const recent = [...projects]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', value: loading ? '…' : String(total),    icon: Server,       color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
          { label: 'Deployed',       value: loading ? '…' : String(deployed),  icon: Rocket,       color: '#059669', bg: 'bg-emerald-50' },
          { label: 'Failed',         value: loading ? '…' : String(failed),    icon: Activity,     color: '#ef4444', bg: 'bg-red-50' },
          { label: 'Pending',        value: loading ? '…' : String(pending),   icon: Loader,       color: '#c9692a', bg: 'bg-[#fdf3eb]' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${stat.bg}`} style={{ color: stat.color }}>
                  <Icon size={20} />
                </div>
              </div>
              <p className="text-gray-800 text-2xl font-bold">{stat.value}</p>
              <p className="text-gray-400 text-xs mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Projects */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-gray-800 font-bold text-sm">Recent Projects</h3>
            <span className="text-gray-400 text-xs">{total} total</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader size={18} className="text-[#c9692a] animate-spin mr-2" />
              <span className="text-gray-400 text-sm">Loading…</span>
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-12 h-12 rounded-xl bg-[#edf3fb] flex items-center justify-center mb-3">
                <FolderGit2 size={22} className="text-[#1e3a7a]" />
              </div>
              <p className="text-gray-800 text-sm font-semibold">No projects yet</p>
              <p className="text-gray-400 text-xs mt-1">Go to Projects and create your first one.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recent.map((p) => {
                const sc = statusConfig[p.status] || statusConfig.pending;
                return (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
                      <GitBranch size={14} className="text-[#1e3a7a]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium truncate">{p.name}</p>
                      <p className="text-gray-400 text-xs truncate">{p.description || p.source_type}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                    </span>
                    <span className="text-gray-400 text-xs flex items-center gap-1 flex-shrink-0">
                      <Clock size={11} />{timeAgo(p.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-gray-800 font-bold text-sm mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { icon: Rocket,    label: 'New Deployment',   color: '#c9692a', bg: 'bg-[#fdf3eb]',  desc: 'Go to Projects → Deploy' },
              { icon: GitBranch, label: 'Create Pipeline',  color: '#059669', bg: 'bg-emerald-50', desc: 'Coming soon' },
              { icon: Shield,    label: 'Security Scan',    color: '#8b3d14', bg: 'bg-[#fdf3eb]',  desc: 'Coming soon' },
              { icon: Zap,       label: 'Automation Rules', color: '#4a72c4', bg: 'bg-[#edf3fb]',  desc: 'Coming soon' },
              { icon: DollarSign,label: 'Cost Report',      color: '#1e3a7a', bg: 'bg-[#edf3fb]',  desc: 'Coming soon' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <div key={action.label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all group">
                  <div className={`w-8 h-8 rounded-lg ${action.bg} flex items-center justify-center`}>
                    <Icon size={15} style={{ color: action.color }} />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-gray-700 text-sm font-medium block">{action.label}</span>
                    <span className="text-gray-400 text-xs">{action.desc}</span>
                  </div>
                  <ArrowUp size={12} className="text-gray-300 group-hover:text-[#c9692a] rotate-45 transition-colors" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Coming soon modules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { label: 'AI Insights', desc: 'Cost, performance & security recommendations powered by AI.', color: '#c9692a', bg: 'bg-[#fdf3eb]', icon: Zap },
          { label: 'Monitoring', desc: 'Real-time metrics, latency tracking, and alerting per service.', color: '#1e3a7a', bg: 'bg-[#edf3fb]', icon: Activity },
          { label: 'Cost Intelligence', desc: 'Cloud spend breakdown and AI-driven optimization suggestions.', color: '#059669', bg: 'bg-emerald-50', icon: DollarSign },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-2xl p-5 border border-gray-100 flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.bg}`} style={{ color: card.color }}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-gray-800 text-sm font-semibold flex items-center gap-2">
                  {card.label}
                  <span className="text-[10px] font-medium bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                    <Construction size={9} /> Soon
                  </span>
                </p>
                <p className="text-gray-400 text-xs mt-1 leading-relaxed">{card.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
