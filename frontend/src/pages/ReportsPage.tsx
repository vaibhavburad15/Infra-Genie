import { useEffect, useState } from 'react';
import { FileText, Calendar, Loader, AlertTriangle, RefreshCw } from 'lucide-react';
import { listProjects, listReports, type Project } from '@/api';

interface Report {
  id: string;
  project_id: string;
  deployment_id: string | null;
  report_type: string;
  content: any;
  insights: string | null;
  created_at: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const typeColors: Record<string, string> = {
  monitoring:  'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  security:    'bg-red-50 text-red-600 border-red-200',
  cost:        'bg-emerald-50 text-emerald-600 border-emerald-200',
  telemetry:   'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
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
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setReports(all);
    } catch (e: any) {
      setError(e.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center">
              <FileText size={18} className="text-[#1e3a7a]" />
            </div>
            <div>
              <h3 className="text-gray-800 font-bold text-sm">Reports</h3>
              <p className="text-gray-400 text-xs">Reports are generated automatically after deployments and analysis runs.</p>
            </div>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader size={20} className="text-[#c9692a] animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading reports…</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={load} className="ml-auto text-xs text-red-500 hover:underline cursor-pointer">Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-gray-800 font-semibold text-sm">All Reports</h3>
            <span className="text-gray-400 text-xs">{reports.length} report{reports.length !== 1 ? 's' : ''}</span>
          </div>

          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#fdf3eb] flex items-center justify-center mb-4">
                <FileText size={24} className="text-[#c9692a]" />
              </div>
              <p className="text-gray-800 font-semibold text-sm">No reports yet</p>
              <p className="text-gray-400 text-xs mt-1 max-w-xs">
                Reports are generated automatically after project analysis and deployments. Analyze a project to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {reports.map((r) => (
                <div key={r.id}>
                  <div
                    className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#fdf3eb] flex items-center justify-center flex-shrink-0">
                      <FileText size={16} className="text-[#c9692a]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm font-medium">{projectMap[r.project_id] || r.project_id}</p>
                      <p className="text-gray-400 text-xs font-mono">{r.id.slice(0, 12)}…</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColors[r.report_type] || 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                      {r.report_type}
                    </span>
                    <span className="text-gray-400 text-xs flex items-center gap-1 flex-shrink-0 hidden sm:flex">
                      <Calendar size={11} />{timeAgo(r.created_at)}
                    </span>
                  </div>

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
        </div>
      )}
    </div>
  );
}
