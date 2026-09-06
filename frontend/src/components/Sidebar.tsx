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
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/context/useAuth';

type Page = 'dashboard' | 'projects' | 'agents' | 'infrastructure' | 'pipelines' | 'deployments' | 'monitoring' | 'security' | 'cost' | 'automation' | 'insights' | 'reports' | 'settings';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  isOpen?: boolean;
  onToggle?: () => void;
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

export default function Sidebar({ activePage, onNavigate, isOpen = true, onToggle }: SidebarProps) {
  const { logout } = useAuth();

  return (
    <aside
      className={`${
        isOpen ? 'w-56' : 'w-16'
      } flex-shrink-0 flex flex-col h-screen bg-white border-r border-gray-100 transition-all duration-300 ease-in-out overflow-hidden select-none`}
    >
      {/* Top Header / Logo Section */}
      <div className={`flex items-center ${isOpen ? 'justify-between px-4' : 'justify-center px-2'} py-4 border-b border-gray-100 flex-shrink-0 h-16`}>
        {isOpen ? (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/favicon.png"
                alt="Infra Genie"
                className="w-8 h-8 object-contain flex-shrink-0"
              />
              <p className="font-bold text-base leading-tight truncate">
                <span className="text-[#1e3a7a]">Infra </span>
                <span className="text-[#c9692a]">Genie</span>
              </p>
            </div>
            {onToggle && (
              <button
                onClick={onToggle}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-150 cursor-pointer flex-shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft size={18} className="stroke-[2]" />
              </button>
            )}
          </>
        ) : (
          <button
            onClick={onToggle}
            className="p-1 rounded-xl hover:bg-slate-100/80 transition-all duration-150 cursor-pointer group flex items-center justify-center"
            title="Click to expand sidebar"
            aria-label="Expand sidebar"
          >
            <img
              src="/favicon.png"
              alt="Infra Genie - Click to expand"
              className="w-9 h-9 object-contain transition-transform duration-200 group-hover:scale-110"
            />
          </button>
        )}
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;

            if (!isOpen) {
              return (
                <li key={item.id} className="flex justify-center">
                  <button
                    onClick={() => onNavigate(item.id)}
                    title={item.label}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer ${
                      isActive
                        ? 'bg-[#1e3a7a] text-white shadow-md shadow-[#1e3a7a]/20'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                    }`}
                  >
                    <Icon size={18} />
                  </button>
                </li>
              );
            }

            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-[#1e3a7a] text-white font-semibold shadow-md shadow-[#1e3a7a]/15'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-white' : 'text-gray-400'} />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}

          <li className="pt-2 border-t border-gray-100 mt-2">
            {isOpen ? (
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all duration-150 cursor-pointer font-medium"
              >
                <LogOut size={18} className="text-rose-500" />
                <span>Sign Out</span>
              </button>
            ) : (
              <div className="flex justify-center">
                <button
                  onClick={logout}
                  title="Sign Out"
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-rose-600 hover:bg-rose-50 transition-all duration-150 cursor-pointer"
                >
                  <LogOut size={18} />
                </button>
              </div>
            )}
          </li>
        </ul>
      </nav>
    </aside>
  );
}



