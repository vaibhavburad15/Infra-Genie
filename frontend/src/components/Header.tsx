import { Search, Bell, HelpCircle, ChevronDown, Command } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
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

        {/* User */}
        <button className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 hover:border-[#1e3a7a] transition-colors cursor-pointer">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c9692a] to-[#8b3d14] flex items-center justify-center text-white text-xs font-bold">
            V
          </div>
          <div className="text-left">
            <p className="text-gray-800 text-xs font-semibold leading-tight">Vaibhav</p>
            <p className="text-gray-400 text-[10px] leading-tight">Admin</p>
          </div>
          <ChevronDown size={12} className="text-gray-400" />
        </button>
      </div>
    </header>
  );
}
