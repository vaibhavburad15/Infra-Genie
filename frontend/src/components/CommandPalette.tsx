import { useState, useEffect, useRef } from 'react';
import {
  Search, LayoutDashboard, Boxes, Server, GitBranch, Rocket,
  Bot, LineChart, ShieldCheck, DollarSign, Zap, Sparkles, FileText,
  Settings, ArrowRight, CornerDownLeft, X, User
} from 'lucide-react';

export interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  category: 'Pages' | 'Quick Actions';
  icon: any;
  action: () => void;
  keywords?: string[];
}

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onToggleAI,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onToggleAI?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items: CommandItem[] = [
    {
      id: 'dashboard',
      title: 'Dashboard',
      subtitle: 'Infrastructure overview and real-time status',
      category: 'Pages',
      icon: LayoutDashboard,
      action: () => { onNavigate('dashboard'); onClose(); },
      keywords: ['overview', 'home', 'main', 'status'],
    },
    {
      id: 'projects',
      title: 'Projects',
      subtitle: 'Manage your cloud projects and services',
      category: 'Pages',
      icon: Boxes,
      action: () => { onNavigate('projects'); onClose(); },
      keywords: ['apps', 'services', 'cloud'],
    },
    {
      id: 'infrastructure',
      title: 'Infrastructure',
      subtitle: 'Cloud resources and infrastructure management',
      category: 'Pages',
      icon: Server,
      action: () => { onNavigate('infrastructure'); onClose(); },
      keywords: ['aws', 'kubernetes', 'k8s', 'terraform', 'nodes', 'vms'],
    },
    {
      id: 'pipelines',
      title: 'Pipelines',
      subtitle: 'CI/CD pipeline management and history',
      category: 'Pages',
      icon: GitBranch,
      action: () => { onNavigate('pipelines'); onClose(); },
      keywords: ['cicd', 'builds', 'github', 'actions'],
    },
    {
      id: 'deployments',
      title: 'Deployments',
      subtitle: 'Deployment pipelines and release history',
      category: 'Pages',
      icon: Rocket,
      action: () => { onNavigate('deployments'); onClose(); },
      keywords: ['releases', 'deploy', 'prod', 'staging'],
    },
    {
      id: 'agents',
      title: 'AI Agents',
      subtitle: 'Autonomous infrastructure management agents',
      category: 'Pages',
      icon: Bot,
      action: () => { onNavigate('agents'); onClose(); },
      keywords: ['bot', 'automation', 'genie', 'ai'],
    },
    {
      id: 'monitoring',
      title: 'Monitoring',
      subtitle: 'Real-time metrics, health, and alerting',
      category: 'Pages',
      icon: LineChart,
      action: () => { onNavigate('monitoring'); onClose(); },
      keywords: ['metrics', 'cpu', 'memory', 'alerts', 'logs'],
    },
    {
      id: 'security',
      title: 'Security',
      subtitle: 'Vulnerability scanning and compliance',
      category: 'Pages',
      icon: ShieldCheck,
      action: () => { onNavigate('security'); onClose(); },
      keywords: ['vuln', 'cve', 'scan', 'compliance'],
    },
    {
      id: 'cost',
      title: 'Cost Intelligence',
      subtitle: 'Cloud spend analysis and optimization',
      category: 'Pages',
      icon: DollarSign,
      action: () => { onNavigate('cost'); onClose(); },
      keywords: ['spend', 'budget', 'billing', 'cloud cost'],
    },
    {
      id: 'automation',
      title: 'Automation',
      subtitle: 'Infrastructure automation rules and scripts',
      category: 'Pages',
      icon: Zap,
      action: () => { onNavigate('automation'); onClose(); },
      keywords: ['scripts', 'auto-scaling', 'triggers'],
    },
    {
      id: 'insights',
      title: 'AI Insights',
      subtitle: 'AI-powered recommendations and optimization',
      category: 'Pages',
      icon: Sparkles,
      action: () => { onNavigate('insights'); onClose(); },
      keywords: ['recommendations', 'ai', 'optimization'],
    },
    {
      id: 'reports',
      title: 'Reports',
      subtitle: 'Generate and download infrastructure reports',
      category: 'Pages',
      icon: FileText,
      action: () => { onNavigate('reports'); onClose(); },
      keywords: ['pdf', 'export', 'audit', 'summary'],
    },
    {
      id: 'settings',
      title: 'Settings',
      subtitle: 'Manage your account, organizations, and preferences',
      category: 'Pages',
      icon: Settings,
      action: () => { onNavigate('settings'); onClose(); },
      keywords: ['account', 'profile', 'org', 'users', 'billing'],
    },
    {
      id: 'action-ai',
      title: 'Toggle AI Assistant',
      subtitle: 'Open or close the interactive InfraGenie AI Assistant panel',
      category: 'Quick Actions',
      icon: Sparkles,
      action: () => { onToggleAI?.(); onClose(); },
      keywords: ['assistant', 'ai', 'chat', 'help'],
    },
    {
      id: 'action-profile',
      title: 'View Account Profile',
      subtitle: 'Go directly to user settings and organization options',
      category: 'Quick Actions',
      icon: User,
      action: () => { onNavigate('settings'); onClose(); },
      keywords: ['user', 'profile', 'me'],
    },
  ];

  const filteredItems = items.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    const matchTitle = item.title.toLowerCase().includes(q);
    const matchSub = item.subtitle.toLowerCase().includes(q);
    const matchKw = item.keywords?.some((k) => k.toLowerCase().includes(q));
    return matchTitle || matchSub || matchKw;
  });

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep selected index in bounds when filtered items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 animate-in fade-in duration-150">
      {/* Backdrop overlay */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Modal dialog */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden z-10 animate-in zoom-in-95 duration-150">
        {/* Search input bar */}
        <div className="flex items-center gap-3 px-4.5 py-3.5 border-b border-slate-100 bg-white">
          <Search size={18} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search pages..."
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
            >
              <X size={15} />
            </button>
          ) : (
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 rounded border border-slate-200">
              ESC
            </kbd>
          )}
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              No results found for &ldquo;<span className="text-slate-600 font-medium">{query}</span>&rdquo;
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  data-index={idx}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`
                    flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer
                    transition-all duration-100
                    ${isSelected
                      ? 'bg-[#1e3a7a] text-white shadow-sm shadow-[#1e3a7a]/20'
                      : 'text-slate-700 hover:bg-slate-100/80'
                    }
                  `}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`
                        w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                        ${isSelected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}
                      `}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[13.5px] font-semibold leading-snug truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                        {item.title}
                      </p>
                      <p className={`text-[11.5px] leading-snug truncate ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                        {item.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {item.category === 'Quick Actions' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        Action
                      </span>
                    )}
                    <CornerDownLeft size={13} className={isSelected ? 'text-white/80' : 'text-slate-300'} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts info */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono text-slate-500 bg-white rounded border border-slate-200 shadow-2xs">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono text-slate-500 bg-white rounded border border-slate-200 shadow-2xs">↵</kbd> select
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span>InfraGenie Command Palette</span>
          </div>
        </div>
      </div>
    </div>
  );
}
