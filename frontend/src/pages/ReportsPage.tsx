import { useEffect, useState } from 'react';
import { FileText, Calendar, RefreshCw } from 'lucide-react';
import { PageHeader, EmptyState, LoadingState, ErrorBanner } from '@/components/ui';
import { listProjects, listReports, timeAgo, parseDate, type Project } from '@/api';

interface Report {
  id: string;
  project_id: string;
  deployment_id: string | null;
  report_type: string;
  content: any;
  insights: string | null;
  created_at: string;
}

const typeColors: Record<string, string> = {
  monitoring:  'badge-info',
  security:    'badge-danger',
  cost:        'badge-success',
  telemetry:   'badge-warning',
};

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const ps: Project[] = await listProjects();
      const map: Record<string, string> = {};
      ps.forEach((p) => { map[p.id] = p.name; });
      setProjectMap(map);

      const all: Report[] = [];
      await Promise.all(
        ps.map(async (p) => {
          try {
            const rs = await listReports(p.id) as Report[];
            all.push(...rs);
          } catch { /* no reports */ }
        })
      );
      all.sort((a, b) => parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime());
      setReports(all);
    } catch (e: any) {
      setError(e.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        description="Reports are generated automatically once deployment execution is live."
        icon={FileText}
        actions={
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-icon" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {loading && <div className="card"><LoadingState label="Loading reports…" /></div>}

      {error && !loading && (
        <ErrorBanner
          message={error}
          action={<button onClick={load} className="btn btn-secondary btn-sm">Retry</button>}
        />
      )}

      {!loading && !error && (
        <section className="card overflow-hidden">
          <div className="card-header">
            <h2 className="section-title">All reports</h2>
            <span className="text-xs text-gray-500">{reports.length} report{reports.length !== 1 ? 's' : ''}</span>
          </div>

          {reports.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No reports yet"
              description="Deployment execution is in progress — reports will be generated automatically once provisioning is live."
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {reports.map((r) => (
                <div key={r.id}>
                  <button
                    className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-gray-50"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    aria-expanded={expanded === r.id}
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <FileText size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium">{projectMap[r.project_id] || r.project_id}</p>
                      <p className="text-gray-500 text-xs font-mono">{r.id.slice(0, 12)}…</p>
                    </div>
                    <span className={`badge capitalize ${typeColors[r.report_type] || 'badge-neutral'}`}>
                      {r.report_type}
                    </span>
                    <span className="text-gray-500 text-xs items-center gap-1 flex-shrink-0 hidden sm:flex">
                      <Calendar size={12} />{timeAgo(r.created_at)}
                    </span>
                  </button>

                  {expanded === r.id && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      {r.insights && (
                        <div className="mt-3">
                          <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-1.5 font-semibold">AI Insights</p>
                          <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap">{r.insights}</p>
                        </div>
                      )}
                      {r.content && (
                        <div className="mt-3">
                          <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-1.5 font-semibold">Report Data</p>
                          <pre className="text-[10px] text-gray-600 bg-white rounded-lg p-3 overflow-x-auto max-h-48 border border-gray-100">
                            {JSON.stringify(r.content, null, 2)}
                          </pre>
                        </div>
                      )}
                      {!r.insights && !r.content && (
                        <p className="text-gray-400 text-xs mt-3 italic">No content available for this report.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
