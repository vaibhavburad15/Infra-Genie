import {
  Server, Cloud, Database, Cpu, HardDrive, Network, GitBranch, Rocket,
  Activity, CheckCircle2, AlertTriangle, Clock, ArrowUp, ArrowDown,
  Zap, Shield, DollarSign, TrendingUp, Users, Container, Layers,
} from 'lucide-react';

const resourceStats: { label: string; value: string; change: string; trend: string; icon: any; color: string; bg: string }[] = [];

const cloudProviders: { name: string; resources: number; color: string; icon: any; servers: number; databases: number; status: string }[] = [];

const resourceUsage: { name: string; used: number; total: string; icon: any; color: string }[] = [];

const recentDeployments: { project: string; version: string; status: string; time: string; env: string }[] = [];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  success: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Success' },
  running: { dot: 'bg-[#c9692a] animate-pulse', text: 'text-[#c9692a]', bg: 'bg-[#fdf3eb]', label: 'Running' },
  failed: { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
};

const envColors: Record<string, string> = {
  Production: 'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  Staging: 'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  Development: 'bg-gray-100 text-gray-500 border-gray-200',
};

const insights: { type: string; icon: any; title: string; desc: string; priority: string; color: string }[] = [];

function RadialGauge({ value, label, icon: Icon, color }: { value: number; label: string; icon: typeof Server; color: string }) {
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="#e5e7eb" strokeWidth="5" />
          <circle
            cx="32" cy="32" r="28" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon size={14} style={{ color }} />
          <span className="text-[#1e3a7a] text-base font-bold mt-0.5">{value}%</span>
        </div>
      </div>
      <p className="text-gray-500 text-[11px] mt-2 text-center">{label}</p>
    </div>
  );
}

// Bar chart data
const chartData: number[] = [];

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {resourceStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${stat.bg}`} style={{ color: stat.color }}>
                  <Icon size={20} />
                </div>
                <span className={`text-xs font-semibold flex items-center gap-0.5 px-2 py-1 rounded-lg ${
                  stat.trend === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-[#c9692a] bg-[#fdf3eb]'
                }`}>
                  {stat.trend === 'up' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                  {stat.change}
                </span>
              </div>
              <p className="text-gray-800 text-2xl font-bold">{stat.value}</p>
              <p className="text-gray-400 text-xs mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Middle row: Chart + Radial gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart card */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-gray-800 font-bold text-sm">Infrastructure Activity</h3>
              <p className="text-gray-400 text-xs">Deployments & resource changes - last 18 hours</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#1e3a7a]" /> Deployments
              </span>
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#c9692a]" /> Changes
              </span>
            </div>
          </div>
          <div className="flex items-end gap-1.5 h-40">
            {chartData.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="w-full flex flex-col items-center gap-0.5 relative">
                  <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity font-semibold">{v}</span>
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-[#1e3a7a] to-[#4a72c4] group-hover:from-[#c9692a] group-hover:to-[#d97f45] transition-all"
                    style={{ height: `${v * 1.3}px` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-3 text-[10px] text-gray-300 font-medium">
            <span>18h ago</span><span>12h</span><span>6h</span><span>Now</span>
          </div>
        </div>

        {/* Radial gauges */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-800 font-bold text-sm">Resource Utilization</h3>
            <button className="text-[#c9692a] text-xs font-medium hover:underline cursor-pointer">Details</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {resourceUsage.map((res) => (
              <RadialGauge key={res.name} value={res.used} label={res.name} icon={res.icon} color={res.color} />
            ))}
          </div>
        </div>
      </div>

      {/* Cloud Providers + AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cloud providers */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-800 font-bold text-sm">Cloud Providers</h3>
            <span className="text-gray-400 text-xs">{cloudProviders.reduce((a, p) => a + p.resources, 0)} total resources</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cloudProviders.map((provider) => {
              const Icon = provider.icon;
              return (
                <div key={provider.name} className="rounded-xl border border-gray-100 p-4 hover:border-gray-200 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${provider.color}15` }}>
                        <Icon size={18} style={{ color: provider.color }} />
                      </div>
                      <div>
                        <p className="text-gray-800 text-sm font-bold">{provider.name}</p>
                        <p className="text-gray-400 text-[10px]">{provider.resources} resources</p>
                      </div>
                    </div>
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex items-center gap-1"><Server size={11} /> Servers</span>
                      <span className="text-gray-700 font-semibold">{provider.servers}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex items-center gap-1"><Database size={11} /> Databases</span>
                      <span className="text-gray-700 font-semibold">{provider.databases}</span>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(provider.resources / 248) * 100}%`, background: provider.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Insights */}
        <div className="bg-gradient-to-br from-[#0f1f4a] to-[#1a2f68] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#c9692a] flex items-center justify-center">
                <Zap size={14} className="text-white" />
              </div>
              <h3 className="text-white font-bold text-sm">AI Insights</h3>
            </div>
            <span className="bg-[#c9692a] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">5 new</span>
          </div>
          <div className="space-y-2.5">
            {insights.map((ins) => {
              const Icon = ins.icon;
              return (
                <div key={ins.title} className="bg-[#162050] rounded-xl p-3 border border-[#1a2f68] hover:border-[#c9692a]/40 transition-colors cursor-pointer">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${ins.color}20` }}>
                      <Icon size={13} style={{ color: ins.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-semibold leading-tight">{ins.title}</p>
                      <p className="text-[#7099d8] text-[10px] mt-0.5 leading-relaxed">{ins.desc}</p>
                      <span className="inline-block mt-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${ins.color}20`, color: ins.color }}>
                        {ins.priority}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="w-full mt-3 py-2 rounded-xl bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">
            View All Recommendations
          </button>
        </div>
      </div>

      {/* Bottom row: Recent deployments + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent deployments */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-gray-800 font-bold text-sm">Recent Deployments</h3>
            <button className="text-[#c9692a] text-xs font-medium hover:underline cursor-pointer">View all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentDeployments.map((dep) => {
              const sc = statusConfig[dep.status];
              return (
                <div key={dep.project} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
                    <GitBranch size={14} className="text-[#1e3a7a]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-sm font-medium truncate">{dep.project}</p>
                    <p className="text-gray-400 text-xs">{dep.version}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[dep.env]}`}>
                    {dep.env}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {sc.label}
                  </span>
                  <span className="text-gray-400 text-xs flex items-center gap-1 flex-shrink-0">
                    <Clock size={11} /> {dep.time}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-gray-800 font-bold text-sm mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { icon: Rocket, label: 'New Deployment', color: '#c9692a', bg: 'bg-[#fdf3eb]' },
              { icon: Container, label: 'Add Resource', color: '#1e3a7a', bg: 'bg-[#edf3fb]' },
              { icon: GitBranch, label: 'Create Pipeline', color: '#059669', bg: 'bg-emerald-50' },
              { icon: Shield, label: 'Run Security Scan', color: '#8b3d14', bg: 'bg-[#fdf3eb]' },
              { icon: Layers, label: 'Provision Infra', color: '#4a72c4', bg: 'bg-[#edf3fb]' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer group"
                >
                  <div className={`w-8 h-8 rounded-lg ${action.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon size={15} style={{ color: action.color }} />
                  </div>
                  <span className="text-gray-700 text-sm font-medium flex-1 text-left">{action.label}</span>
                  <ArrowUp size={12} className="text-gray-300 group-hover:text-[#c9692a] rotate-45 transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
