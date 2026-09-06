import { useState, useRef, useEffect } from 'react';
import {
  Search, Bell, ChevronDown, Command, LogOut,
  Settings as SettingsIcon, PanelLeft, Sparkles, Zap,
} from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import type { UserRole } from '@/api';

const roleLabels: Record<UserRole, string> = {
  user: 'User',
  developer: 'Developer',
  devops_engineer: 'DevOps Engineer',
  admin: 'Admin',
};

const roleBadgeColors: Record<UserRole, string> = {
  user: 'bg-slate-100 text-slate-600',
  developer: 'bg-blue-50 text-blue-700',
  devops_engineer: 'bg-violet-50 text-violet-700',
  admin: 'bg-amber-50 text-amber-700',
};

export default function Header({
  title,
  subtitle,
  onNavigate,
  sidebarOpen,
  onToggleSidebar,
  aiOpen,
  onToggleAI,
}: {
  title: string;
  subtitle: string;
  onNavigate?: (p: 'settings' | any) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  aiOpen?: boolean;
  onToggleAI?: () => void;
}) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initial = user?.username ? user.username.charAt(0).toUpperCase() : 'V';
  const displayName = user?.username || 'Vaibhav';
  const displayEmail = user?.email || 'admin@infragenie.io';
  const displayRole = user?.role ? roleLabels[user.role] : 'User';
  const roleBadge = user?.role ? roleBadgeColors[user.role] : roleBadgeColors['user'];

  const handleLogout = () => {
    setOpen(false);
    logout();
  };

  return (
    <header className="h-16 flex items-center justify-between px-5 bg-white border-b border-gray-100/80 flex-shrink-0 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)]">
      {/* ── Left: sidebar toggle + page title ── */}
      <div className="flex items-center gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-[#1e3a7a] hover:bg-[#1e3a7a]/8 transition-all duration-150"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <PanelLeft size={17} />
          </button>
        )}

        <div className="flex items-center gap-3 min-w-0">
          <div className="w-px h-6 bg-gray-200 hidden sm:block" />
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-gray-900 leading-tight tracking-tight truncate">
              {title}
            </h1>
            <p className="text-[11px] text-gray-400 leading-tight mt-0.5 truncate hidden sm:block">
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* ── Centre: search ── */}
      <div className="hidden md:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 w-72 xl:w-96 focus-within:border-[#1e3a7a] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(30,58,122,0.06)] transition-all duration-150 mx-6">
        <Search size={13} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="Search anything..."
          className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
        />
        <div className="flex items-center gap-0.5 text-gray-300 flex-shrink-0">
          <Command size={10} />
          <span className="text-[10px] font-medium">K</span>
        </div>
      </div>

      {/* ── Right: actions + user ── */}
      <div className="flex items-center gap-1.5">

        {/* AI Assistant toggle */}
        <button
          onClick={onToggleAI}
          aria-pressed={aiOpen}
          title={aiOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          className={`
            relative flex items-center gap-2 h-8 px-3 rounded-lg text-sm font-medium
            transition-all duration-200 cursor-pointer select-none
            ${aiOpen
              ? 'bg-[#1e3a7a] text-white shadow-md shadow-[#1e3a7a]/25'
              : 'bg-gradient-to-r from-[#1e3a7a] to-[#2a50a8] text-white hover:shadow-md hover:shadow-[#1e3a7a]/20 hover:scale-[1.02]'
            }
          `}
        >
          <Sparkles size={13} className={aiOpen ? 'text-orange-300' : 'text-blue-200'} />
          <span className="hidden sm:inline text-xs">AI Assistant</span>
          {!aiOpen && (
            <span className="hidden sm:flex items-center gap-0.5 ml-0.5 bg-white/15 rounded-md px-1 py-0.5 text-[9px] font-semibold tracking-wide">
              <Zap size={8} className="text-yellow-300" />
              ON
            </span>
          )}
        </button>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* Notifications */}
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-[#1e3a7a] hover:bg-[#1e3a7a]/8 transition-all duration-150 cursor-pointer">
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#c9692a] rounded-full ring-2 ring-white" />
        </button>

        {/* User dropdown */}
        <div className="relative ml-1" ref={dropRef}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-200 cursor-pointer transition-all duration-150"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c9692a] to-[#8b3d14] flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">
              {initial}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-gray-800 text-[12px] font-semibold leading-tight">{displayName}</p>
              <p className={`text-[9px] font-medium leading-tight px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${roleBadge}`}>
                {displayRole}
              </p>
            </div>
            <ChevronDown
              size={12}
              className={`text-gray-400 transition-transform duration-200 ml-0.5 hidden sm:block ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-xl shadow-gray-200/80 border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
              {/* User info */}
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#c9692a] to-[#8b3d14] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{displayEmail}</p>
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div className="py-1.5 border-b border-gray-100">
                <button
                  onClick={() => { setOpen(false); onNavigate?.('settings'); }}
                  className="w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50 flex items-center gap-3 cursor-pointer transition-colors rounded-sm"
                >
                  <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <SettingsIcon size={13} className="text-gray-500" />
                  </div>
                  Account Settings
                </button>
              </div>

              <div className="pt-1.5">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-3 cursor-pointer transition-colors rounded-sm"
                >
                  <div className="w-6 h-6 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0">
                    <LogOut size={13} className="text-rose-500" />
                  </div>
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
