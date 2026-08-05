import { useState, useRef, useEffect } from 'react';
import { Search, Bell, HelpCircle, ChevronDown, Command, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface HeaderProps {
  title: string;
  subtitle: string;
  onNavigate?: (page: 'settings' | any) => void;
}

export default function Header({ title, subtitle, onNavigate }: HeaderProps) {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initial = user?.username ? user.username.charAt(0).toUpperCase() : 'V';
  const displayName = user?.username || 'Vaibhav';
  const displayEmail = user?.email || 'admin@infragenie.io';

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
  };

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-gray-100 flex-shrink-0">
      {/* Title */}
      <div>
        <h1 className="text-[#1e3a7a] font-bold text-xl leading-tight">{title}</h1>
        <p className="text-gray-400 text-xs">{subtitle}</p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 w-80 focus-within:border-[#1e3a7a] transition-colors">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="Search anything..."
          className="flex-1 bg-transparent text-sm text-gray-600 placeholder-gray-400 focus:outline-none"
        />
        <div className="flex items-center gap-0.5 text-gray-300">
          <Command size={11} />
          <span className="text-[11px]">K</span>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:border-[#1e3a7a] hover:text-[#1e3a7a] transition-colors cursor-pointer">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#c9692a] rounded-full text-white text-[9px] font-bold flex items-center justify-center">2</span>
        </button>

        {/* Help */}
        <button className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:border-[#1e3a7a] hover:text-[#1e3a7a] transition-colors cursor-pointer">
          <HelpCircle size={16} />
        </button>

        {/* User Menu Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 hover:border-[#1e3a7a] transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c9692a] to-[#8b3d14] flex items-center justify-center text-white text-xs font-bold">
              {initial}
            </div>
            <div className="text-left">
              <p className="text-gray-800 text-xs font-semibold leading-tight">{displayName}</p>
              <p className="text-gray-400 text-[10px] leading-tight">Admin</p>
            </div>
            <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800 leading-tight">{displayName}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{displayEmail}</p>
              </div>

              {onNavigate && (
                <div className="py-1 border-b border-gray-100">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onNavigate('settings');
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                  >
                    <SettingsIcon size={14} className="text-gray-400" />
                    Account Settings
                  </button>
                </div>
              )}

              <div className="pt-1">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <LogOut size={14} className="text-rose-500" />
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
