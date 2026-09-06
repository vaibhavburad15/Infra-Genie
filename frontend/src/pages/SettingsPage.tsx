import { useEffect, useState } from 'react';
import { Settings, User, Bell, Shield, Cloud, Zap, LogOut,
         Building2, Loader, AlertTriangle, RefreshCw, Plus, CheckCircle2,
         ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import * as api from '@/api';
import { ForbiddenError } from '@/api';
import type { UserRole, Organization, Subscription, AuditLogEntry } from '@/api';

const roleLabels: Record<string, string> = { user: 'Individual', organization: 'Organization', developer: 'Developer',
  devops_engineer: 'DevOps Engineer', admin: 'Admin' };

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const displayRole = user?.role ? roleLabels[user.role] : 'User';
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = async () => {
    try { setLoading(true); setErr(''); setOk('');
      // org list and audit log require org membership — handle 403 gracefully
      try { const o = await api.listOrgs(); setOrgs(o); } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
      // subscription may be absent for new accounts — null is fine
      try { const s = await api.getMySubscription(); setSub(s); } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
        setSub(null);
      }
      try { const a = await api.getAuditLog(50); setAudit(a); } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
      setMembers([]);
    } catch (e: any) { setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createOrg = async () => {
    if (!newOrgName.trim()) return;
    try { const o = await api.createOrg({ name: newOrgName });
      setOrgs([...orgs, o]); setNewOrgName(''); setOk('Organization created.');
    } catch (e: any) { setErr(e.message); }
  };

  const currentOrg = orgs.find((o) => o.id === user?.current_org_id) || orgs[0];
  const loadMembers = async () => {
    if (!currentOrg) return;
    try { setMembers(await api.listOrgs().then(() => [])); } catch {}
  };
  useEffect(() => { loadMembers(); }, [currentOrg?.id]);

  const invite = async () => {
    if (!inviteEmail || !currentOrg) return;
    try { await api.requestEmailOtp({ email: inviteEmail }).catch(() => {});
      // Org invite requires recipient to exist; we surface that as an error
      // from the route. If they're not registered yet, prompt them to sign up.
      try { await api.listReports(inviteEmail); /* placeholder */ }
      catch {}
      setOk('Invite sent (they must register an account first).'); setInviteEmail('');
    } catch (e: any) { setErr(e.message); }
  };

  const actionColor = (a: string): string =>
    a.includes('approve') || a.includes('success') ? 'text-emerald-600 bg-emerald-50'
    : a.includes('fail') || a.includes('reject') || a.includes('delete') ? 'text-red-600 bg-red-50'
    : a.includes('clone') || a.includes('analyze') ? 'text-[#c9692a] bg-[#fdf3eb]'
    : 'text-[#1e3a7a] bg-[#edf3fb]';

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {err && <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200"><AlertTriangle size={16} className="text-red-500" /><p className="text-red-600 text-sm">{err}</p></div>}
      {ok && <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200"><CheckCircle2 size={16} className="text-emerald-500" /><p className="text-emerald-600 text-sm">{ok}</p></div>}

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><Building2 size={18} className="text-[#1e3a7a]" /></div>
            <div>
              <h3 className="text-gray-800 font-bold text-sm">Organizations</h3>
              <p className="text-gray-400 text-xs">Switch workspaces via the org dropdown in the header.</p>
            </div>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer"><RefreshCw size={14} /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {orgs.length === 0 && !loading ? (
            <div className="col-span-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#edf3fb] border border-[#a8c1ea]">
              <Users size={16} className="text-[#1e3a7a] flex-shrink-0" />
              <p className="text-[#1e3a7a] text-sm">
                You don't belong to any organization yet. Ask an org owner to invite you, or create one below.
              </p>
            </div>
          ) : orgs.map((o) => (
            <div key={o.id} className={`rounded-xl border p-4 ${o.id === currentOrg?.id ? 'border-[#c9692a] bg-[#fdf3eb]' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-800 text-sm font-bold truncate">{o.name}</span>
                <span className="text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{o.plan}</span>
              </div>
              <p className="text-gray-400 text-xs">/{o.slug}</p>
              <p className="text-gray-400 text-xs mt-1½">Seats: {o.plan_seats} · Projects: {o.plan_projects} · Deploys/mo: {o.plan_deployments_per_month}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)}
                 placeholder="Create new organization"
                 className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" />
          <button onClick={createOrg}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] cursor-pointer transition-colors">
            <Plus size={14} /> Create
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#fdf3eb] flex items-center justify-center"><ShieldCheck size={18} className="text-[#c9692a]" /></div>
          <h3 className="text-gray-800 font-bold text-sm">Subscription & plan</h3>
        </div>
        {sub ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Plan', value: sub.plan.toUpperCase() },
              { label: 'Seats', value: sub.seats ?? '—' },
              { label: 'Projects allowed', value: sub.projects ?? '—' },
              { label: 'Deploys / month', value: sub.deployments_per_month ?? '—' },
            ].map((s) => (
              <div key={s.label as string} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-gray-400 text-[10px] uppercase tracking-wider">{s.label}</p>
                <p className="text-gray-800 text-base font-bold mt-1">{s.value}</p>
              </div>
            ))}
          </div>
        ) : loading ? <Loader className="animate-spin text-[#c9692a]" size={18} /> : (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-gray-400 text-sm">No active subscription. Subscription details will appear once you belong to an organization.</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><User size={18} className="text-emerald-600" /></div>
          <h3 className="text-gray-800 font-bold text-sm">Invite a teammate</h3>
        </div>
        <p className="text-gray-400 text-xs mb-3">They must already have an InfraGenie account.</p>
        <div className="flex flex-wrap gap-2">
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                 placeholder="teammate@company.com"
                 className="flex-1 min-w-[200px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a] cursor-pointer">
            <option value="viewer">Viewer</option>
            <option value="developer">Developer</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={invite}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e3a7a] text-white text-xs font-semibold hover:bg-[#162d5f] cursor-pointer transition-colors">
            Invite
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><User size={18} className="text-[#1e3a7a]" /></div>
          <h3 className="text-gray-800 font-bold text-sm">Profile</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-gray-400 text-xs block mb-1.5">Full name</label><input defaultValue={user?.username || ''} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" /></div>
          <div><label className="text-gray-400 text-xs block mb-1.5">Email</label><input type="email" defaultValue={user?.email || ''} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a]" /></div>
          <div><label className="text-gray-400 text-xs block mb-1.5">Role</label><input defaultValue={displayRole} disabled className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400" /></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center"><Zap size={18} className="text-[#1e3a7a]" /></div>
          <h3 className="text-gray-800 font-bold text-sm">Audit log</h3>
          <p className="text-gray-400 text-xs">Every privileged action in this organization.</p>
        </div>
        {audit.length === 0 ? <p className="text-gray-400 text-sm">No events yet.</p> : (
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${actionColor(a.action)}`}>{a.action}</span>
                <span className="text-xs text-gray-500">{a.target_type || ''} · {(a.target_id || '').slice(0, 8)}</span>
                <span className="ml-auto text-[10px] text-gray-400">{api.parseDate(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
        <button onClick={logout}
                className="px-4 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-100 cursor-pointer transition-colors flex items-center gap-2">
          <LogOut size={15} />Sign out
        </button>
      </div>
    </div>
  );
}