import { Settings, User, Bell, Shield, Cloud, Zap, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function SettingsPage() {
  const { logout } = useAuth();

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><User size={18} className="text-[#1e3a7a]" /></div><h3 className="text-gray-800 font-bold text-sm">Profile Settings</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-gray-400 text-xs block mb-1.5">Full Name</label><input type="text" defaultValue="Vaibhav" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" /></div>
          <div><label className="text-gray-400 text-xs block mb-1.5">Email</label><input type="email" defaultValue="admin@infragenie.io" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" /></div>
          <div><label className="text-gray-400 text-xs block mb-1.5">Role</label><input type="text" defaultValue="Admin" disabled className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400" /></div>
          <div><label className="text-gray-400 text-xs block mb-1.5">Timezone</label><select className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a] cursor-pointer"><option>UTC</option><option>IST (UTC+5:30)</option><option>EST (UTC-5)</option></select></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl bg-[#fdf3eb] flex items-center justify-center"><Bell size={18} className="text-[#c9692a]" /></div><h3 className="text-gray-800 font-bold text-sm">Notifications</h3></div>
        {[
          { label: 'Deployment alerts', desc: 'Get notified when deployments succeed or fail' },
          { label: 'Security warnings', desc: 'Critical vulnerabilities and compliance issues' },
          { label: 'Cost threshold alerts', desc: 'When spending exceeds budget limits' },
          { label: 'AI insights digest', desc: 'Daily summary of AI recommendations' },
        ].map((n) => (
          <div key={n.label} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
            <div><p className="text-gray-800 text-sm font-medium">{n.label}</p><p className="text-gray-400 text-xs">{n.desc}</p></div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-10 h-5.5 bg-gray-200 rounded-full peer peer-checked:bg-[#c9692a] transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5"></div>
            </label>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><Cloud size={18} className="text-[#1e3a7a]" /></div><h3 className="text-gray-800 font-bold text-sm">Cloud Integrations</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['AWS', 'Azure', 'GCP'].map((p) => (
            <div key={p} className="rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2"><span className="text-gray-800 text-sm font-bold">{p}</span><span className="w-2 h-2 rounded-full bg-emerald-500" /></div>
              <p className="text-gray-400 text-xs">Connected</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
        <button
          onClick={logout}
          className="px-4 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-100 cursor-pointer transition-colors flex items-center gap-2"
        >
          <LogOut size={15} />
          Sign Out
        </button>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 cursor-pointer transition-colors">Cancel</button>
          <button className="px-4 py-2 rounded-lg bg-[#c9692a] text-white text-sm font-semibold hover:bg-[#b85820] cursor-pointer transition-colors">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
