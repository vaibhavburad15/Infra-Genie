import { useState } from 'react';
import {
  FolderGit2, GitBranch, Clock, Rocket, MoreVertical, Plus,
  Server, Database, Boxes, Cloud, Search, Filter, Shield,
  CheckCircle2, AlertTriangle, Loader,
} from 'lucide-react';

const projects: { name: string; description: string; type: string; icon: any; status: string; lastDeploy: string; version: string; services: number; environment: string; language: string }[] = [];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Healthy' },
  deploying: { dot: 'bg-[#c9692a] animate-pulse', text: 'text-[#c9692a]', bg: 'bg-[#fdf3eb]', label: 'Deploying' },
  degraded: { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Degraded' },
  failed: { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
};

const envColors: Record<string, string> = {
  Production: 'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  Staging: 'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  Development: 'bg-gray-100 text-gray-500 border-gray-200',
};

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

export default function ProjectsPage() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {['all', 'healthy', 'deploying', 'degraded'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                filter === f ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
              }`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search projects..."
              className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-600 placeholder-gray-400 focus:outline-none focus:border-[#1e3a7a] w-48" />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-gray-300 text-xs cursor-pointer transition-colors">
            <Filter size={12} /> Filter
          </button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('grid')} className={`px-3 py-1.5 text-xs cursor-pointer ${view === 'grid' ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500'}`}>Grid</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs cursor-pointer ${view === 'list' ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500'}`}>List</button>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">
            <Plus size={14} /> New Project
          </button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project) => {
            const Icon = project.icon;
            const sc = statusConfig[project.status];
            return (
              <div key={project.name} className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow group cursor-pointer">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center">
                      <Icon size={18} className="text-[#1e3a7a]" />
                    </div>
                    <div>
                      <h3 className="text-gray-800 text-sm font-bold">{project.name}</h3>
                      <p className="text-gray-400 text-xs">{project.type}</p>
                    </div>
                  </div>
                  <button className="text-gray-300 hover:text-[#c9692a] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <MoreVertical size={15} />
                  </button>
                </div>
                <p className="text-gray-500 text-xs leading-relaxed mb-4 min-h-[32px]">{project.description}</p>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[project.environment]}`}>{project.environment}</span>
                  <span className="text-gray-400 text-xs px-2 py-0.5 rounded bg-gray-100">{project.language}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
                  <div><p className="text-gray-300 text-[10px] uppercase tracking-wider">Version</p><p className="text-gray-700 text-xs font-semibold mt-0.5">{project.version}</p></div>
                  <div><p className="text-gray-300 text-[10px] uppercase tracking-wider">Services</p><p className="text-gray-700 text-xs font-semibold mt-0.5">{project.services}</p></div>
                  <div><p className="text-gray-300 text-[10px] uppercase tracking-wider">Deployed</p><p className="text-gray-700 text-xs font-semibold mt-0.5">{project.lastDeploy}</p></div>
                </div>
                <button className="w-full mt-4 py-2 rounded-lg bg-[#edf3fb] text-[#1e3a7a] text-xs font-semibold hover:bg-[#c9692a] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1.5">
                  <Rocket size={12} /> Deploy Now
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Project</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden md:table-cell">Environment</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Version</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Last Deploy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((project) => {
                const Icon = project.icon;
                const sc = statusConfig[project.status];
                return (
                  <tr key={project.name} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center"><Icon size={14} className="text-[#1e3a7a]" /></div>
                        <div><p className="text-gray-800 text-sm font-medium">{project.name}</p><p className="text-gray-400 text-xs">{project.type}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[project.environment]}`}>{project.environment}</span></td>
                    <td className="px-4 py-3 hidden lg:table-cell"><span className="text-gray-600 text-xs font-mono">{project.version}</span></td>
                    <td className="px-4 py-3"><span className="text-gray-400 text-xs flex items-center gap-1"><Clock size={11} />{project.lastDeploy}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
