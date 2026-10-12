import {
  LayoutDashboard,
  Server,
  GitBranch,
  Rocket,
  Activity,
  Shield,
  DollarSign,
  Lightbulb,
  FileText,
  Settings,
  Bot,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  X,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '@/context/useAuth';

type Page = 'dashboard' | 'projects' | 'ansible' | 'agents' | 'pipelines' | 'deployments' | 'monitoring' | 'security' | 'cost' | 'insights' | 'reports' | 'settings' | 'cloud-accounts';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  /** Desktop expanded (true) / icon-only (false). */
  isOpen?: boolean;
  onToggle?: () => void;
  /** Mobile off-canvas drawer state (below lg). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

type NavItem = { id: Page; label: string; icon: LucideIcon };

const navGroups: NavItem[][] = [
  [
    { id: 'dashboard',      label: 'Overview',          icon: LayoutDashboard },
    { id: 'projects',       label: 'Projects',          icon: Server },
    { id: 'cloud-accounts', label: 'Cloud Accounts',    icon: Cloud },
  ],
  [
    { id: 'pipelines',      label: 'Pipelines',         icon: GitBranch },
    { id: 'deployments',    label: 'Deployments',       icon: Rocket },
    { id: 'ansible',        label: 'Ansible',           icon: Terminal },
    { id: 'monitoring',     label: 'Monitoring',        icon: Activity },
  ],
  [
    { id: 'agents',         label: 'AI Agents',         icon: Bot },
    { id: 'security',       label: 'Security',          icon: Shield },
    { id: 'cost',           label: 'Cost Intelligence', icon: DollarSign },
    { id: 'insights',       label: 'AI Insights',       icon: Lightbulb },
    { id: 'reports',        label: 'Reports',           icon: FileText },
  ],
];

const settingsItem: NavItem = { id: 'settings', label: 'Settings', icon: Settings };

function NavButton({
  item,
  active,
  expanded,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={expanded ? undefined : item.label}
      aria-label={expanded ? undefined : item.label}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex h-9 w-full items-center gap-3 rounded-lg text-sm transition-colors duration-150 ${
        expanded ? 'px-3' : 'justify-center px-0'
      } ${
        active
          ? 'bg-primary text-white font-medium'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <Icon
        size={18}
        strokeWidth={1.85}
        className={`shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-700'}`}
      />
      {expanded && <span className="truncate">{item.label}</span>}
    </button>
  );
}

export default function Sidebar({
  activePage,
  onNavigate,
  isOpen = true,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const { logout } = useAuth();

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onMobileClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // In the mobile drawer the sidebar is always shown expanded.
  const renderPanel = (expanded: boolean, mobile: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand */}
      <div
        className={`flex h-16 shrink-0 items-center border-b border-gray-200 ${
          expanded ? 'justify-between pl-4 pr-2' : 'justify-center'
        }`}
      >
        {expanded ? (
          <>
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/favicon.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
              <p className="truncate text-[17px] font-semibold tracking-tight">
                <span className="text-primary">Infra</span>{' '}
                <span className="text-accent">Genie</span>
              </p>
            </div>
            {mobile ? (
              <button onClick={onMobileClose} className="btn btn-ghost btn-sm btn-icon" aria-label="Close navigation">
                <X size={18} />
              </button>
            ) : (
              onToggle && (
                <button onClick={onToggle} className="btn btn-ghost btn-sm btn-icon" title="Collapse sidebar" aria-label="Collapse sidebar">
                  <ChevronsLeft size={18} />
                </button>
              )
            )}
          </>
        ) : (
          <button
            onClick={onToggle}
            className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <img src="/favicon.png" alt="Infra Genie" className="h-8 w-8 object-contain" />
          </button>
        )}
      </div>

      {/* Primary navigation — only scrolls on very short viewports */}
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {navGroups.map((group, gi) => (
          <ul key={gi} className={`space-y-0.5 ${gi > 0 ? 'mt-2.5 border-t border-gray-100 pt-2.5' : ''}`}>
            {group.map((item) => (
              <li key={item.id}>
                <NavButton
                  item={item}
                  active={activePage === item.id}
                  expanded={expanded}
                  onClick={() => onNavigate(item.id)}
                />
              </li>
            ))}
          </ul>
        ))}
      </nav>

      {/* Bottom-anchored settings & sign out */}
      <div className="shrink-0 space-y-0.5 border-t border-gray-200 px-3 py-3">
        <NavButton
          item={settingsItem}
          active={activePage === 'settings'}
          expanded={expanded}
          onClick={() => onNavigate('settings')}
        />
        <button
          onClick={logout}
          title={expanded ? undefined : 'Sign out'}
          aria-label={expanded ? undefined : 'Sign out'}
          className={`flex h-9 w-full items-center gap-3 rounded-lg text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-700 ${
            expanded ? 'px-3' : 'justify-center'
          }`}
        >
          <LogOut size={18} strokeWidth={1.85} className="shrink-0" />
          {expanded && <span>Sign out</span>}
        </button>
        {!expanded && !mobile && onToggle && (
          <button
            onClick={onToggle}
            className="mt-1 flex h-9 w-full items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronsRight size={18} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: static, collapsible */}
      <aside
        className={`${
          isOpen ? 'w-60' : 'w-[68px]'
        } hidden h-dvh shrink-0 select-none border-r border-gray-200 bg-white transition-[width] duration-200 ease-out lg:block`}
      >
        {renderPanel(isOpen, false)}
      </aside>

      {/* Mobile / tablet: off-canvas drawer */}
      <div className={`lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} inert={!mobileOpen}>
        <div
          className={`fixed inset-0 z-40 bg-gray-900/40 transition-opacity duration-200 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onMobileClose}
        />
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] select-none border-r border-gray-200 bg-white shadow-xl transition-transform duration-200 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          {renderPanel(true, true)}
        </aside>
      </div>
    </>
  );
}
