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
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/context/useAuth';

type Page = 'dashboard' | 'projects' | 'agents' | 'infrastructure' | 'pipelines' | 'deployments' | 'monitoring' | 'security' | 'cost' | 'automation' | 'insights' | 'reports' | 'settings';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: LucideIcon }[] = [
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
  const { logout } = useAuth();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-screen bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        <img src="/favicon.png" alt="Infra Genie" className="w-10 h-10 object-contain flex-shrink-0" />
        <div className="leading-tight">
          <p className="font-bold text-base leading-tight">
            <span className="text-[#1e3a7a]">Infra </span>
            <span className="text-[#c9692a]">Genie</span>
          </p>
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
          <li className="pt-2 border-t border-gray-100 mt-2">
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all duration-150 cursor-pointer font-medium"
            >
              <LogOut size={16} className="text-rose-500" />
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}


