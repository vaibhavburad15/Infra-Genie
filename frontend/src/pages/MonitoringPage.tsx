import {
  Activity, Server, Cpu, HardDrive, Network, AlertTriangle,
  CheckCircle2, TrendingUp, TrendingDown, Gauge, Zap, Clock,
} from 'lucide-react';

const services: { name: string; status: string; latency: string; uptime: string; errorRate: string; requests: string; region: string }[] = [];

const alerts: { severity: string; service: string; message: string; time: string }[] = [];

const metrics: { label: string; value: string; change: string; trend: string; icon: any; color: string; bg: string }[] = [];

const severityConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: 'Critical' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', label: 'Warning' },
  info: { bg: 'bg-[#edf3fb]', text: 'text-[#1e3a7a]', border: 'border-[#a8c1ea]', label: 'Info' },
};

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Healthy' },
  degraded: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Degraded' },
  down: { dot: 'bg-red-500 animate-pulse', text: 'text-red-600', bg: 'bg-red-50', label: 'Down' },
};

const chartData: number[] = [];
const latencyData: number[] = [];

function Sparkline({ data, color, height = 100 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => { const x = (i / (data.length - 1)) * 100; const y = height - ((v - min) / range) * (height - 4) - 2; return `${x},${y}`; }).join(' ');
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs><linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${height} ${points} 100,${height}`} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function MonitoringPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-white rounded-2xl p-4 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.bg}`} style={{ color: m.color }}><Icon size={16} /></div>
                <span className={`text-xs font-medium flex items-center gap-0.5 ${m.trend === 'down' && m.label !== 'Active Alerts' ? 'text-emerald-600' : m.trend === 'up' && m.label === 'Active Alerts' ? 'text-red-500' : m.trend === 'up' ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {m.trend === 'up' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{m.change}
                </span>
              </div>
              <p className="text-gray-800 text-2xl font-bold">{m.value}</p><p className="text-gray-400 text-xs mt-0.5">{m.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4"><div><h3 className="text-gray-800 text-sm font-semibold">Request Throughput</h3><p className="text-gray-400 text-xs">Last 15 minutes - requests per second</p></div><span className="text-[#c9692a] text-xs font-bold">48.2K/min</span></div>
          <Sparkline data={chartData} color="#c9692a" height={120} />
          <div className="flex justify-between text-gray-300 text-[10px] mt-2"><span>15m ago</span><span>10m ago</span><span>5m ago</span><span>now</span></div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4"><div><h3 className="text-gray-800 text-sm font-semibold">Response Latency</h3><p className="text-gray-400 text-xs">P95 latency in milliseconds</p></div><span className="text-[#1e3a7a] text-xs font-bold">124ms avg</span></div>
          <Sparkline data={latencyData} color="#1e3a7a" height={120} />
          <div className="flex justify-between text-gray-300 text-[10px] mt-2"><span>15m ago</span><span>10m ago</span><span>5m ago</span><span>now</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Cpu, label: 'CPU Usage', value: 64, unit: '%', detail: '30.7 / 48 vCPUs', color: '#1e3a7a' },
          { icon: HardDrive, label: 'Memory', value: 72, unit: '%', detail: '138 / 192 GB', color: '#c9692a' },
          { icon: HardDrive, label: 'Storage', value: 41, unit: '%', detail: '3.4 / 8.2 TB', color: '#059669' },
          { icon: Network, label: 'Network I/O', value: 38, unit: '%', detail: '380 Mbps', color: '#4a72c4' },
        ].map((res) => {
          const Icon = res.icon;
          return (
            <div key={res.label} className="bg-white rounded-2xl p-4 border border-gray-100">
              <div className="flex items-center gap-2 mb-3"><Icon size={14} style={{ color: res.color }} /><span className="text-gray-800 text-xs font-semibold">{res.label}</span></div>
              <div className="flex items-baseline gap-1 mb-2"><span className="text-gray-800 text-xl font-bold">{res.value}</span><span className="text-gray-400 text-xs">{res.unit}</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2"><div className="h-full rounded-full transition-all" style={{ width: `${res.value}%`, background: res.color }} /></div>
              <p className="text-gray-400 text-[10px]">{res.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2"><Server size={16} className="text-[#c9692a]" /><h3 className="text-gray-800 font-semibold text-sm">Service Health</h3></div>
            <span className="text-gray-400 text-xs">{services.filter((s) => s.status === 'healthy').length}/{services.length} healthy</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5">Service</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5">Status</th>
                <th className="text-right text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5 hidden sm:table-cell">Latency</th>
                <th className="text-right text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5 hidden md:table-cell">Uptime</th>
                <th className="text-right text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5 hidden md:table-cell">Errors</th>
                <th className="text-right text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Requests</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Region</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {services.map((svc) => {
                  const sc = statusConfig[svc.status];
                  return (
                    <tr key={svc.name} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3"><p className="text-gray-800 text-sm font-medium">{svc.name}</p></td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}</span></td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell"><span className={`text-sm font-mono ${svc.latency.includes('890') ? 'text-amber-600' : 'text-gray-600'}`}>{svc.latency}</span></td>
                      <td className="px-4 py-3 text-right hidden md:table-cell"><span className="text-gray-600 text-sm font-mono">{svc.uptime}</span></td>
                      <td className="px-4 py-3 text-right hidden md:table-cell"><span className={`text-sm font-mono ${parseFloat(svc.errorRate) > 1 ? 'text-red-500' : 'text-emerald-600'}`}>{svc.errorRate}</span></td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell"><span className="text-gray-800 text-sm font-medium">{svc.requests}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="text-gray-500 text-xs font-mono">{svc.region}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2"><AlertTriangle size={16} className="text-[#c9692a]" /><h3 className="text-gray-800 font-semibold text-sm">Recent Alerts</h3></div>
            <span className="bg-red-50 text-red-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full">4 active</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
            {alerts.map((alert, idx) => {
              const cfg = severityConfig[alert.severity];
              return (
                <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                      {alert.severity === 'info' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>{cfg.label}</span>
                        <span className="text-gray-800 text-xs font-medium">{alert.service}</span>
                      </div>
                      <p className="text-gray-500 text-xs leading-relaxed">{alert.message}</p>
                      <p className="text-gray-300 text-[10px] mt-1 flex items-center gap-1"><Clock size={9} />{alert.time}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
