import { useState, useRef, useEffect } from 'react';
import {
  Search, Bell, Command, LogOut, Moon,
  Settings as SettingsIcon, PanelLeft, Sparkles, Zap, User, Shield,
} from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import type { UserRole } from '@/api';
import CommandPalette from './CommandPalette';

const roleLabels: Record<UserRole, string> = {
  user: 'User',
  developer: 'Developer',
  devops_engineer: 'DevOps',
  admin: 'Admin',
};

const roleBadgeColors: Record<UserRole, string> = {
  user: 'bg-slate-100 text-slate-600 border-slate-200/80',
  developer: 'bg-blue-50 text-blue-700 border-blue-200/80',
  devops_engineer: 'bg-purple-50 text-purple-700 border-purple-200/80',
  admin: 'bg-amber-50 text-amber-700 border-amber-200/80',
};

/** Returns up to 2 uppercase initials from a name string (e.g. "Luffy DMonkey" → "LD", "yraj17" → "YR") */
function getInitials(name: string): string {
  if (!name) return 'U';
  const cleanName = name.split('@')[0].trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) {
    return parts[0].length >= 2
      ? parts[0].substring(0, 2).toUpperCase()
      : parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Global Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, []);

  const displayName = user?.username || 'Luffy DMonkey';
  const displayEmail = user?.email || 'yraj43801@gmail.com';
  const displayRole = user?.role ? roleLabels[user.role] : 'User';
  const roleBadge = user?.role ? roleBadgeColors[user.role] : roleBadgeColors['user'];
  const initials = getInitials(displayName);

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return next;
    });
  };

  const handleLogout = () => {
    setOpen(false);
    logout();
  };

  return (
    <header className="h-16 flex items-center justify-between px-5 bg-white border-b border-gray-100/80 flex-shrink-0 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)]">
      {/* ── Left: page title ── */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-gray-900 leading-tight tracking-tight truncate">
            {title}
          </h1>
          <p className="text-[11px] text-gray-400 leading-tight mt-0.5 truncate hidden sm:block">
            {subtitle}
          </p>
        </div>
      </div>

      {/* ── Centre: search button ── */}
      <div
        onClick={() => setSearchOpen(true)}
        className="hidden md:flex items-center gap-2.5 bg-gray-50 hover:bg-slate-100/80 border border-gray-200 rounded-xl px-3.5 py-2 w-72 xl:w-96 cursor-pointer hover:border-[#1e3a7a]/40 hover:shadow-[0_0_0_3px_rgba(30,58,122,0.06)] transition-all duration-150 mx-6 select-none"
        role="button"
        tabIndex={0}
        aria-label="Open search command palette"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSearchOpen(true);
          }
        }}
      >
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <span className="flex-1 text-sm text-gray-400 truncate">Search anything...</span>
        <div className="flex items-center gap-0.5 text-gray-400 bg-white px-1.5 py-0.5 rounded-md border border-gray-200 shadow-2xs flex-shrink-0">
          <Command size={10} />
          <span className="text-[10px] font-semibold">K</span>
        </div>
      </div>

      {/* Command Palette Modal */}
      <CommandPalette
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={(p) => onNavigate?.(p)}
        onToggleAI={onToggleAI}
      />

      {/* ── Right: actions + user ── */}
      <div className="flex items-center gap-1.5">

        {/* AI Assistant toggle */}
        <button
          onClick={onToggleAI}
          aria-pressed={aiOpen}
          title={aiOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          className={`
            flex items-center gap-2 h-9 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0
            border transition-all duration-150 cursor-pointer select-none
            ${aiOpen
              ? 'bg-[#c9692a] text-white border-[#c9692a] shadow-xs'
              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs hover:border-slate-300'
            }
          `}
        >
          <Sparkles
            size={14}
            className={aiOpen ? 'text-amber-200 animate-pulse' : 'text-[#c9692a]'}
          />
          <span>AI Assistant</span>
          {aiOpen ? (
            <span className="w-2 h-2 rounded-full bg-amber-200 animate-pulse ml-0.5" />
          ) : (
            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-md bg-[#c9692a]/10 text-[#c9692a]">
              AI
            </span>
          )}
        </button>

        <div className="w-px h-5 bg-gray-200/80 mx-1 hidden sm:block" />

        {/* Notifications */}
        <button className="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-[#1e3a7a] hover:bg-slate-100 border border-transparent hover:border-slate-200/60 transition-all duration-150 cursor-pointer">
          <Bell size={16} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-[#c9692a] rounded-full ring-2 ring-white" />
        </button>

        {/* User dropdown */}
        <div className="relative ml-2" ref={dropRef}>
          <button
            onClick={() => setOpen(!open)}
            className="w-10 h-10 rounded-full bg-[#e9e7fd] hover:bg-[#dfe0fb] text-[#5b4fcf] font-semibold text-[14px] flex items-center justify-center cursor-pointer transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#5b4fcf]/30 select-none shadow-xs"
            aria-label="User profile menu"
            aria-expanded={open}
          >
            {initials}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl shadow-slate-900/10 border border-slate-200/70 p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* User info header */}
              <div className="px-3 py-3 rounded-xl bg-slate-50/80 border border-slate-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#e9e7fd] text-[#5b4fcf] font-bold text-xs flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-xs">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-tight truncate">
                      {displayName}
                    </p>
                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${roleBadge}`}>
                      {displayRole}
                    </span>
                  </div>
                  <p className="text-[11.5px] font-normal text-slate-500 leading-tight truncate mt-1">
                    {displayEmail}
                  </p>
                </div>
              </div>

              {/* Menu items 1 */}
              <div className="py-1 space-y-0.5">
                <button
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <User size={16} className="text-slate-500 flex-shrink-0" />
                  <span>View Profile</span>
                </button>

                <button
                  onClick={toggleDarkMode}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Moon size={16} className="text-slate-500 flex-shrink-0" />
                    <span>Dark Mode</span>
                  </div>
                  {darkMode && (
                    <span className="text-[10px] font-semibold text-[#5b4fcf] bg-[#e9e7fd] px-2 py-0.5 rounded-full">
                      ON
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <SettingsIcon size={16} className="text-slate-500 flex-shrink-0" />
                  <span>Settings</span>
                </button>
              </div>

              {/* Menu items 2: Sign Out */}
              <div className="pt-1 mt-0.5 border-t border-slate-100">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <LogOut size={16} className="text-rose-500 flex-shrink-0" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}




