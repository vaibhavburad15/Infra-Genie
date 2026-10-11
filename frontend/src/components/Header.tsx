import { useState, useRef, useEffect } from 'react';
import {
  Search, Bell, Command, LogOut, Moon, Menu, ChevronRight,
  Settings as SettingsIcon, User,
} from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import type { UserRole } from '@/api';
import CommandPalette from './CommandPalette';

const roleLabels: Record<UserRole, string> = {
  user: 'User',
  organization: 'Organization',
  developer: 'Developer',
  devops_engineer: 'DevOps',
  admin: 'Admin',
};

const roleBadgeColors: Record<UserRole, string> = {
  user: 'bg-gray-100 text-gray-600 border-gray-200/80',
  organization: 'bg-teal-50 text-teal-700 border-teal-200/80',
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
  crumbs,
  onNavigate,
  onOpenMobileNav,
}: {
  /** Breadcrumb trail for the current view, e.g. ['Deployments', 'Review Deployment']. */
  crumbs: string[];
  onNavigate?: (p: 'settings' | any) => void;
  onOpenMobileNav?: () => void;
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
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

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
      {/* ── Left: mobile menu + breadcrumb ── */}
      <button
        onClick={onOpenMobileNav}
        className="btn btn-ghost btn-icon -ml-1 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="hidden shrink-0 text-gray-500 sm:block">Workspace</li>
          {crumbs.map((c, i) => (
            <li key={c} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight size={14} className={`shrink-0 text-gray-300 ${i === 0 ? 'hidden sm:block' : ''}`} aria-hidden />
              <span
                className={`truncate ${i === crumbs.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500'}`}
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {c}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      {/* Command Palette Modal */}
      <CommandPalette
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={(p) => onNavigate?.(p)}
      />

      {/* ── Right: search, notifications, user ── */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          onClick={() => setSearchOpen(true)}
          className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-left transition-colors hover:border-gray-300 hover:bg-white md:flex xl:w-80"
          aria-label="Open search command palette"
        >
          <Search size={15} className="shrink-0 text-gray-400" />
          <span className="flex-1 truncate text-sm text-gray-400">Search anything…</span>
          <kbd className="flex shrink-0 items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-gray-500">
            {isMac ? <Command size={10} /> : 'Ctrl'} K
          </kbd>
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className="btn btn-ghost btn-icon md:hidden"
          aria-label="Search"
        >
          <Search size={18} />
        </button>

        {/* Notifications */}
        <button className="btn btn-ghost btn-icon relative" aria-label="Notifications">
          <Bell size={18} />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-white" />
        </button>

        {/* User dropdown */}
        <div className="relative ml-1" ref={dropRef}>
          <button
            onClick={() => setOpen(!open)}
            className="w-9 h-9 rounded-full bg-primary-50 hover:bg-primary-100 border border-primary-100 text-primary font-semibold text-[13px] flex items-center justify-center transition-colors select-none"
            aria-label="User profile menu"
            aria-expanded={open}
          >
            {initials}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-[var(--shadow-pop)] border border-gray-200 p-1.5 z-50">
              {/* User info header */}
              <div className="px-3 py-3 rounded-xl bg-gray-50/80 border border-gray-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary-50 text-primary font-semibold text-xs flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-xs">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-[13.5px] font-semibold text-gray-900 leading-tight truncate">
                      {displayName}
                    </p>
                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${roleBadge}`}>
                      {displayRole}
                    </span>
                  </div>
                  <p className="text-[11.5px] font-normal text-gray-500 leading-tight truncate mt-1">
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
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 rounded-lg flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <User size={16} className="text-gray-500 flex-shrink-0" />
                  <span>View Profile</span>
                </button>

                <button
                  onClick={toggleDarkMode}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 rounded-lg flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Moon size={16} className="text-gray-500 flex-shrink-0" />
                    <span>Dark Mode</span>
                  </div>
                  {darkMode && (
                    <span className="text-[10px] font-semibold text-primary bg-primary-50 px-2 py-0.5 rounded-full">
                      ON
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full text-left px-3 py-2 text-[13.5px] font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 rounded-lg flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <SettingsIcon size={16} className="text-gray-500 flex-shrink-0" />
                  <span>Settings</span>
                </button>
              </div>

              {/* Menu items 2: Sign Out */}
              <div className="pt-1 mt-0.5 border-t border-gray-100">
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




