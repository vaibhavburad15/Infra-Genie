import {
  LayoutDashboard,
  Server,
  GitBranch,
  Rocket,
  Activity,
  Shield,
  DollarSign,
  Zap,
  Lightbulb,
  FileText,
  Settings,
  Bot,
  ChevronRight,
} from 'lucide-react';

type Page = 'dashboard' | 'projects' | 'agents' | 'infrastructure' | 'pipelines' | 'deployments' | 'monitoring' | 'security' | 'cost' | 'automation' | 'insights' | 'reports' | 'settings';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: Server },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'pipelines', label: 'Pipelines', icon: GitBranch },
  { id: 'deployments', label: 'Deployments', icon: Rocket },
  { id: 'monitoring', label: 'Monitoring', icon: Activity },
  { id: 'agents', label: 'AI Agents', icon: Bot },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'cost', label: 'Cost Intelligence', icon: DollarSign },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'insights', label: 'AI Insights', icon: Lightbulb },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-screen bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        <img src="/logo.png" alt="Infra Genie" className="w-10 h-10 object-contain flex-shrink-0" />
        <div>
          <p className="font-bold text-[#1e3a7a] text-base leading-tight">Infra Genie</p>
          <p className="text-[10px] text-gray-400 leading-tight">AI-Powered CloudOps</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-[#1e3a7a] text-white font-semibold'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-white' : 'text-gray-400'} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom promo card */}
      <div className="mx-3 mb-4 rounded-xl bg-gradient-to-br from-[#1e3a7a] to-[#24478f] p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-[#c9692a] flex items-center justify-center">
            <Zap size={12} className="text-white" />
          </div>
          <p className="text-white text-xs font-bold">DevOpsIQ AI</p>
        </div>
        <p className="text-blue-200 text-[10px] leading-relaxed mb-3">Smart Automation for Smarter Operations</p>
        <button className="flex items-center gap-1 text-white text-[10px] font-semibold hover:gap-2 transition-all cursor-pointer">
          Learn more <ChevronRight size={11} />
        </button>
      </div>
    </aside>
  );
}
