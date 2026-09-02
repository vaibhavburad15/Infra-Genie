import { useState, useRef, useEffect } from 'react';
import { Search, Bell, HelpCircle, ChevronDown, Command, LogOut,
         Settings as SettingsIcon, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { UserRole, Organization } from '@/api';
import * as api from '@/api';

const roleLabels: Record<UserRole, string> = {
  user: 'User', developer: 'Developer',
  devops_engineer: 'DevOps Engineer', admin: 'Admin',
};

export default function Header({ title, subtitle, onNavigate }:
                               { title: string; subtitle: string;
                                 onNavigate?: (p: 'settings' | any) => void; }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(
    user?.current_org_id ?? null);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    api.listOrgs().then((o) => {
      setOrgs(o);
      if (!currentOrgId) setCurrentOrgId(user?.current_org_id || (o[0]?.id ?? null));
    }).catch(() => {});
  }, [user?.current_org_id]);

  const initial = user?.username ? user.username.charAt(0).toUpperCase() : 'V';
  const displayName = user?.username || 'Vaibhav';
  const displayEmail = user?.email || 'admin@infragenie.io';
  const displayRole = user?.role ? roleLabels[user.role] : 'User';
  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  const handleLogout = () => { setOpen(false); logout(); };

  const switchOrg = async (id: string) => {
    try {
      await api.switchOrg(id);
      setCurrentOrgId(id);
      setOrgMenuOpen(false);
      // Reload the page so all org-scoped data refreshes - predictable UX.
      window.location.reload();
    } catch (e) { /* surface later */ }
  };

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-gray-100 flex-shrink-0">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[#1e3a7a] font-bold text-xl leading-tight">{title}</h1>
          <span className="px-2 py-0.5 rounded-full bg-[#edf3fb] text-[#1e3a7a] text-[10px] font-semibold uppercase tracking-wide border border-[#a8c1ea]/40">
            SaaS
          </span>
        </div>
        <p className="text-gray-400 text-xs">{subtitle}</p>
      </div>

      {/* Org switcher (v3) */}
      <div className="relative" ref={orgMenuRef}>
        <button
          onClick={() => setOrgMenuOpen(!orgMenuOpen)}
          className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 hover:border-[#1e3a7a] cursor-pointer transition-colors"
          title="Switch organization"
        >
          <Building2 size={14} className="text-[#1e3a7a]" />
          <span className="text-gray-700 text-xs font-semibold max-w-[180px] truncate">
            {currentOrg ? currentOrg.name : 'No organization'}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
            (currentOrg?.plan || 'free') === 'enterprise' ? 'bg-[#c9692a] text-white'
            : (currentOrg?.plan || 'free') === 'pro' ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-500'}`}>
            {currentOrg?.plan || 'free'}
          </span>
          <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 ${orgMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {orgMenuOpen && (
          <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Your organizations</p>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {orgs.length === 0 && (
                <p className="px-4 py-3 text-xs text-gray-400">No organizations yet.</p>
              )}
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => switchOrg(o.id)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2.5 cursor-pointer transition-colors ${
                    o.id === currentOrgId ? 'bg-[#edf3fb]' : ''}`}
                >
                  <Building2 size={14} className={o.id === currentOrgId ? 'text-[#c9692a]' : 'text-gray-400'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{o.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">/{o.slug}</p>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase">{o.plan}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 w-80 focus-within:border-[#1e3a7a] transition-colors">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input type="text" placeholder="Search anything..."
               className="flex-1 bg-transparent text-sm text-gray-600 placeholder-gray-400 focus:outline-none" />
        <div className="flex items-center gap-0.5 text-gray-300">
          <Command size={11} /><span className="text-[11px]">K</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:border-[#1e3a7a] hover:text-[#1e3a7a] cursor-pointer transition-colors">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#c9692a] rounded-full text-white text-[9px] font-bold flex items-center justify-center">2</span>
        </button>
        <button className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:border-[#1e3a7a] hover:text-[#1e3a7a] cursor-pointer transition-colors">
          <HelpCircle size={16} />
        </button>

        <div className="relative" ref={dropRef}>
          <button onClick={() => setOpen(!open)}
                  className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 hover:border-[#1e3a7a] cursor-pointer transition-colors">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c9692a] to-[#8b3d14] flex items-center justify-center text-white text-xs font-bold">
              {initial}
            </div>
            <div className="text-left">
              <p className="text-gray-800 text-xs font-semibold leading-tight">{displayName}</p>
              <p className="text-gray-400 text-[10px] leading-tight">{displayRole}</p>
            </div>
            <ChevronDown size={12} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800 leading-tight">{displayName}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{displayEmail}</p>
              </div>
              <div className="py-1 border-b border-gray-100">
                <button onClick={() => { setOpen(false); onNavigate?.('settings'); }}
                        className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 cursor-pointer">
                  <SettingsIcon size={14} className="text-gray-400" /> Account Settings
                </button>
              </div>
              <div className="pt-1">
                <button onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 cursor-pointer">
                  <LogOut size={14} className="text-rose-500" /> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}