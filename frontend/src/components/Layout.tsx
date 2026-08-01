import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Zap, LayoutDashboard, LogOut, User } from "lucide-react";
import { useStore } from "../store";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="border-b border-gray-800 bg-gray-950 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white">InfraGenie</span>
            </NavLink>

            {/* Nav links */}
            <nav className="flex items-center gap-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
                  }`
                }
                end
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </NavLink>
            </nav>
          </div>

          {/* User menu */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">{user.username}</span>
              </div>
            )}
            <button
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {children}
      </main>
    </div>
  );
}
