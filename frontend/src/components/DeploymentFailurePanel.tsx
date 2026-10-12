import { useState } from 'react';
import { AlertTriangle, ChevronRight, Loader, Wrench } from 'lucide-react';
import { resolveDeployment, type Deployment, type DeploymentFailure } from '@/api';

interface DeploymentFailurePanelProps {
  deployment: Deployment;
  failure: DeploymentFailure;
  /** Called with the updated deployment after a resolution was queued. */
  onResolved: (updated: Deployment) => void;
  compact?: boolean;
}

/**
 * Shows what actually went wrong and the fixes the server offers for it
 * (for example "Use PostgreSQL 17"). Every fix ends in a new plan that the
 * user reviews and approves before anything is applied.
 */
export default function DeploymentFailurePanel({
  deployment, failure, onResolved, compact = false,
}: DeploymentFailurePanelProps) {
  const [busyOption, setBusyOption] = useState<number | null>(null);
  const [error, setError] = useState('');

  const handleResolve = async (option: number) => {
    try {
      setBusyOption(option);
      setError('');
      onResolved(await resolveDeployment(deployment.id, option));
    } catch (e: any) {
      setError(e.message || 'Could not apply this fix. Please try again.');
    } finally {
      setBusyOption(null);
    }
  };

  return (
    <div className={`bg-red-50 border border-red-200 rounded-xl ${compact ? 'px-3 py-3 mt-4' : 'px-5 py-5'}`}>
      <div className={`flex items-center gap-2 text-red-700 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>
        <AlertTriangle size={compact ? 13 : 16} className="flex-shrink-0" />
        {failure.title}
      </div>

      {failure.detail && (
        <pre className="mt-2 text-red-800 text-xs whitespace-pre-wrap break-words leading-relaxed font-mono bg-white/60 border border-red-100 rounded-lg px-3 py-2 max-h-56 overflow-y-auto">
          {failure.detail}
        </pre>
      )}

      {failure.suggestion && (
        <p className="mt-2 text-xs text-red-700">{failure.suggestion}</p>
      )}

      {failure.resolutions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {failure.resolutions.map((resolution, index) => (
            <button
              key={`${resolution.id}-${index}`}
              type="button"
              disabled={busyOption !== null}
              onClick={() => void handleResolve(index)}
              title={resolution.description}
              className={`btn btn-sm ${resolution.recommended ? 'btn-primary' : 'btn-secondary'}`}
            >
              {busyOption === index
                ? <Loader size={13} className="animate-spin" />
                : <Wrench size={13} />}
              {resolution.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-700 font-medium" role="alert">{error}</p>}

      {failure.raw && failure.raw !== failure.detail && (
        <details className="mt-3">
          <summary className="text-xs text-red-600 cursor-pointer flex items-center gap-1">
            <ChevronRight size={12} /> Full output
          </summary>
          <pre className="mt-2 text-[10px] text-gray-600 bg-white rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap">
            {failure.raw}
          </pre>
        </details>
      )}
    </div>
  );
}
