import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal, RefreshCw, Server, Play, FileCode2, Lock, Loader, CheckCircle2, XCircle,
  Clock, History, ChevronRight,
} from 'lucide-react';
import {
  listAnsibleDeployments, getDeploymentAnsible, getAnsibleFile, startAnsibleRun, getAnsibleRun,
  timeAgo, parseDate,
  type AnsibleDeploymentListItem, type DeploymentAnsible, type AnsibleRun, type AnsibleRunSummary,
} from '@/api';
import { PageHeader, EmptyState, LoadingState, ErrorBanner } from '@/components/ui';

const RUN_BADGE: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600 border-gray-200',
  running: 'bg-amber-50 text-amber-700 border-amber-200',
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

function RunStatus({ status }: { status: string }) {
  const Icon = status === 'succeeded' ? CheckCircle2 : status === 'failed' ? XCircle
    : status === 'running' ? Loader : Clock;
  return (
    <span className={`badge inline-flex items-center gap-1 ${RUN_BADGE[status] ?? RUN_BADGE.queued}`}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {status}
    </span>
  );
}

function duration(run: AnsibleRunSummary): string {
  if (!run.started_at) return '—';
  const start = parseDate(run.started_at);
  const end = run.finished_at ? parseDate(run.finished_at) : run.status === 'running' ? new Date() : null;
  if (!end) return '—';
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function recapText(run: AnsibleRunSummary): string {
  const hosts = Object.values(run.recap || {});
  if (hosts.length === 0) return '';
  const sum = (key: string) => hosts.reduce((total, host) => total + (host[key] || 0), 0);
  return `ok ${sum('ok')} · changed ${sum('changed')} · failed ${sum('failed') + sum('unreachable')}`;
}

export default function AnsiblePage() {
  const [servers, setServers] = useState<AnsibleDeploymentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeploymentAnsible | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [run, setRun] = useState<AnsibleRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlaybook, setBusyPlaybook] = useState<string | null>(null);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLPreElement>(null);

  const loadServers = useCallback(async () => {
    try {
      setError('');
      const list = await listAnsibleDeployments();
      setServers(list);
      setSelectedId((current) => current ?? list[0]?.deployment_id ?? null);
    } catch (e: any) {
      setError(e.message || 'Could not load server deployments.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (deploymentId: string) => {
    try {
      const data = await getDeploymentAnsible(deploymentId);
      setDetail(data);
      return data;
    } catch (e: any) {
      setError(e.message || 'Could not load the Ansible configuration.');
      return null;
    }
  }, []);

  useEffect(() => { void loadServers(); }, [loadServers]);

  // Selecting a deployment: load its files and open the latest run.
  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    setRun(null);
    setFilePath(null);
    void loadDetail(selectedId).then((data) => {
      if (!data) return;
      setFilePath(data.files.find((f) => f.path.startsWith('playbooks/deploy'))?.path ?? data.files[0]?.path ?? null);
      if (data.runs[0]) void getAnsibleRun(data.runs[0].id).then(setRun);
    });
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId || !filePath) return;
    setFileContent('');
    getAnsibleFile(selectedId, filePath)
      .then((file) => setFileContent(file.content))
      .catch((e: any) => setFileContent(`# ${e.message || 'Could not load the file.'}`));
  }, [selectedId, filePath]);

  // Live log: poll the open run while it is queued or running.
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    const timer = setTimeout(async () => {
      const next = await getAnsibleRun(run.id);
      setRun(next);
      if (!['queued', 'running'].includes(next.status) && selectedId) {
        void loadDetail(selectedId);
        void loadServers();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [run, selectedId, loadDetail, loadServers]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.log]);

  const handleRun = async (playbook: string, label: string) => {
    if (!selectedId) return;
    if (playbook === 'update_os' && !window.confirm(`${label} on the server now?`)) return;
    try {
      setBusyPlaybook(playbook);
      setError('');
      const started = await startAnsibleRun(selectedId, playbook);
      setRun({ ...started, log: '' });
      void loadDetail(selectedId);
    } catch (e: any) {
      setError(e.message || 'Could not start the playbook.');
    } finally {
      setBusyPlaybook(null);
    }
  };

  // Group files by their top-level folder for the browser.
  const fileGroups = useMemo(() => {
    const groups = new Map<string, DeploymentAnsible['files']>();
    for (const file of detail?.files ?? []) {
      const group = file.path.includes('/') ? file.path.split('/')[0] : '';
      groups.set(group, [...(groups.get(group) ?? []), file]);
    }
    return [...groups.entries()];
  }, [detail]);

  return (
    <div className="page">
      <PageHeader
        title="Ansible"
        description="Server configuration managed with Ansible: inventory, playbooks, roles and variables, and the built-in playbooks you can run."
        icon={Terminal}
        actions={
          <button onClick={() => { setLoading(true); void loadServers(); }} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading && servers.length === 0 ? (
        <div className="card"><LoadingState label="Loading server deployments…" /></div>
      ) : servers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Server}
            title="No server deployments yet"
            description="Projects that run on servers (EC2) are configured with Ansible. They appear here once a deployment plan has been created for them."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* ── Server deployments ── */}
          <section className="card overflow-hidden self-start">
            <div className="card-header"><h2 className="section-title">Servers</h2></div>
            <ul className="divide-y divide-gray-100">
              {servers.map((item) => (
                <li key={item.deployment_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.deployment_id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 ${
                      item.deployment_id === selectedId ? 'bg-primary-50' : ''
                    }`}
                  >
                    <Server size={15} className="mt-0.5 text-primary shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-800">{item.project_name}</span>
                      <span className="block truncate text-xs text-gray-500 font-mono">
                        {item.server_ip ?? 'not created yet'} · {item.deployment_id.slice(0, 8)}
                      </span>
                      {item.last_run && (
                        <span className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                          <RunStatus status={item.last_run.status} /> {item.last_run.playbook}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Selected deployment ── */}
          {!detail ? (
            <div className="card"><LoadingState label="Loading Ansible configuration…" /></div>
          ) : (
            <div className="space-y-4 min-w-0">
              <section className="card px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{detail.project_name}</p>
                  <p className="text-xs text-gray-500">Deployment {detail.deployment_id.slice(0, 8)} · {detail.status}</p>
                </div>
                <div className="text-xs text-gray-600">
                  <span className="text-gray-400">Server </span>
                  <span className="font-mono">{detail.server ? `${detail.server.user}@${detail.server.host}` : 'created when the deployment is applied'}</span>
                </div>
              </section>

              {/* Playbooks */}
              <section className="card overflow-hidden">
                <div className="card-header flex items-center justify-between gap-2">
                  <h2 className="section-title">Run a playbook</h2>
                  {!detail.can_run && detail.run_blocked_reason && (
                    <span className="text-xs text-gray-500">{detail.run_blocked_reason}</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {detail.playbooks.map((playbook) => (
                    <div key={playbook.id} className="rounded-xl border border-gray-200 p-3 flex flex-col gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{playbook.label}</p>
                        <p className="text-xs text-gray-500">{playbook.description}</p>
                      </div>
                      <button
                        type="button"
                        disabled={!detail.can_run || busyPlaybook !== null}
                        onClick={() => void handleRun(playbook.id, playbook.label)}
                        className="btn btn-secondary btn-sm self-start"
                      >
                        {busyPlaybook === playbook.id ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
                        Run
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Runs + log */}
              <section className="card overflow-hidden">
                <div className="card-header"><h2 className="section-title flex items-center gap-2"><History size={15} /> Runs</h2></div>
                {detail.runs.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-500">No playbook has run yet. The deploy playbook runs automatically when the deployment is applied.</p>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto border-b xl:border-b-0 xl:border-r border-gray-100">
                      {detail.runs.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => void getAnsibleRun(item.id).then(setRun)}
                            className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 ${run?.id === item.id ? 'bg-primary-50' : ''}`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800">{item.playbook}</span>
                              <RunStatus status={item.status} />
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              {item.trigger === 'deployment' ? 'during deployment' : 'manual'} · {timeAgo(item.created_at)} · {duration(item)}
                            </span>
                            {recapText(item) && <span className="block text-[11px] text-gray-500">{recapText(item)}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="min-w-0">
                      {run ? (
                        <>
                          <div className="px-4 py-2 text-xs text-gray-600 flex items-center gap-2 border-b border-gray-100">
                            <ChevronRight size={12} /> {run.playbook} <RunStatus status={run.status} />
                            {run.return_code !== null && <span className="text-gray-400">exit {run.return_code}</span>}
                          </div>
                          <pre ref={logRef} className="text-[11px] leading-relaxed text-gray-100 bg-gray-900 p-4 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                            {run.log || (run.status === 'queued' ? 'Waiting for the worker…' : 'Starting…')}
                          </pre>
                        </>
                      ) : (
                        <p className="px-5 py-4 text-sm text-gray-500">Select a run to see its log.</p>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Files */}
              <section className="card overflow-hidden">
                <div className="card-header"><h2 className="section-title flex items-center gap-2"><FileCode2 size={15} /> Configuration files</h2></div>
                <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]">
                  <nav className="max-h-[32rem] overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-100 py-2" aria-label="Ansible files">
                    {fileGroups.map(([group, files]) => (
                      <div key={group || 'root'} className="mb-1">
                        {group && <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group}</p>}
                        {files.map((file) => (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => setFilePath(file.path)}
                            className={`w-full text-left px-4 py-1.5 text-xs font-mono truncate flex items-center gap-1.5 hover:bg-gray-50 ${
                              filePath === file.path ? 'bg-primary-50 text-primary' : 'text-gray-700'
                            }`}
                          >
                            {file.redacted && <Lock size={11} className="shrink-0 text-amber-600" />}
                            {group ? file.path.slice(group.length + 1) : file.path}
                          </button>
                        ))}
                      </div>
                    ))}
                  </nav>
                  <div className="min-w-0">
                    {filePath && (
                      <div className="px-4 py-2 text-xs font-mono text-gray-600 border-b border-gray-100 flex items-center gap-2">
                        {filePath}
                        {detail.files.find((f) => f.path === filePath)?.redacted && (
                          <span className="badge bg-amber-50 text-amber-700 border-amber-200">values hidden</span>
                        )}
                      </div>
                    )}
                    <pre className="text-xs leading-relaxed text-gray-800 bg-gray-50 p-4 max-h-[30rem] overflow-auto whitespace-pre">
                      {fileContent}
                    </pre>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
