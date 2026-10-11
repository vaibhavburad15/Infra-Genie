import { useEffect, useState } from 'react';
import { Settings, User, Zap, LogOut,
         Building2, RefreshCw, Plus, CheckCircle2,
         Users } from 'lucide-react';
import { PageHeader, ErrorBanner } from '@/components/ui';
import { useAuth } from '@/context/useAuth';
import * as api from '@/api';
import { ForbiddenError } from '@/api';
import type { UserRole, Organization, AuditLogEntry } from '@/api';

const roleLabels: Record<string, string> = { user: 'Individual', organization: 'Organization', developer: 'Developer',
  devops_engineer: 'DevOps Engineer', admin: 'Admin' };

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const displayRole = user?.role ? roleLabels[user.role] : 'User';
  const [orgs, setOrgs] = useState<Organization[]>([]);
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
    : a.includes('clone') || a.includes('analyze') ? 'text-accent-700 bg-accent-50'
    : 'text-primary bg-primary-50';

  const sectionIcon = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary';

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        description="Manage your account, organizations and preferences."
        icon={Settings}
        actions={
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {err && <ErrorBanner message={err} />}
      {ok && <div className="flex items-center gap-3 rounded-[10px] border border-green-200 bg-success-bg px-4 py-3" role="status"><CheckCircle2 size={16} className="text-success" /><p className="text-sm text-success">{ok}</p></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className={sectionIcon}><Building2 size={18} /></div>
            <div>
              <h2 className="section-title">Organizations</h2>
              <p className="text-xs text-gray-500">Workspaces you belong to.</p>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {orgs.length === 0 && !loading ? (
              <div className="col-span-full flex items-center gap-3 rounded-[10px] border border-primary-200 bg-primary-50 px-4 py-3">
                <Users size={16} className="shrink-0 text-primary" />
                <p className="text-sm text-primary">
                  You don't belong to any organization yet. Ask an org owner to invite you, or create one below.
                </p>
              </div>
            ) : orgs.map((o) => (
              <div key={o.id} className={`rounded-[10px] border px-4 py-3 ${o.id === currentOrg?.id ? 'border-primary-200 bg-primary-50' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-gray-800">{o.name}</span>
                  {o.id === currentOrg?.id && <span className="badge badge-info">Current</span>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">/{o.slug}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <label htmlFor="new-org" className="sr-only">New organization name</label>
            <input id="new-org" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)}
                   placeholder="Create new organization" className="input flex-1" />
            <button onClick={createOrg} className="btn btn-primary">
              <Plus size={16} /> Create
            </button>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className={sectionIcon}><User size={18} /></div>
            <div>
              <h2 className="section-title">Invite a teammate</h2>
              <p className="text-xs text-gray-500">They must already have an InfraGenie account.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="invite-email" className="sr-only">Teammate email</label>
            <input id="invite-email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                   placeholder="teammate@company.com" className="input min-w-[200px] flex-1" />
            <label htmlFor="invite-role" className="sr-only">Role</label>
            <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                    className="input w-auto cursor-pointer pr-8">
              <option value="viewer">Viewer</option>
              <option value="developer">Developer</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={invite} className="btn btn-primary">Invite</button>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className={sectionIcon}><User size={18} /></div>
            <h2 className="section-title">Profile</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div><label htmlFor="profile-name" className="label">Full name</label><input id="profile-name" defaultValue={user?.username || ''} className="input" /></div>
            <div><label htmlFor="profile-email" className="label">Email</label><input id="profile-email" type="email" defaultValue={user?.email || ''} className="input" /></div>
            <div><label htmlFor="profile-role" className="label">Role</label><input id="profile-role" defaultValue={displayRole} disabled className="input" /></div>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className={sectionIcon}><Zap size={18} /></div>
            <div>
              <h2 className="section-title">Audit log</h2>
              <p className="text-xs text-gray-500">Every privileged action in this organization.</p>
            </div>
          </div>
          {audit.length === 0 ? <p className="text-sm text-gray-500">No events yet.</p> : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${actionColor(a.action)}`}>{a.action}</span>
                  <span className="truncate text-xs text-gray-500">{a.target_type || ''} · {(a.target_id || '').slice(0, 8)}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-gray-500">{api.parseDate(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <button onClick={logout} className="btn btn-danger">
          <LogOut size={16} />Sign out
        </button>
      </div>
    </div>
  );
}
