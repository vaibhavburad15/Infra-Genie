/**
 * AWSConnectWizard.tsx
 *
 * Multi-step wizard for connecting a customer AWS account to Infra Genie.
 *
 * Step 0 — Entry form:        Enter AWS Account ID + Region
 * Step 1 — CloudFormation:    Display External ID, CFN template download,
 *                              Launch Stack button, instructions
 * Step 2 — Verify:            Enter Role ARN, click Verify Connection
 * Step 3 — Connected:         Success screen with account summary
 *
 * Security notes:
 * • The External ID is shown once (step 1) so the user can embed it in
 *   CloudFormation. It is never shown again in the UI after that step.
 * • Temporary STS credentials are handled entirely server-side — this
 *   component never receives or transmits any AWS credentials.
 */

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Download,
  ExternalLink,
  Copy,
  Loader2,
  AlertTriangle,
  RefreshCw,
  X,
  Cloud,
} from 'lucide-react';
import {
  connectAWSAccount,
  verifyAWSConnection,
  disconnectAWSAccount,
  type CloudAccountConnectResponse,
  type CloudAccountOut,
} from '@/api';

// ── AWS region options shown in the dropdown ──────────────────────────────────
const AWS_REGIONS = [
  { value: 'ap-south-1',      label: 'ap-south-1 (Mumbai)' },
  { value: 'ap-southeast-1',  label: 'ap-southeast-1 (Singapore)' },
  { value: 'ap-southeast-2',  label: 'ap-southeast-2 (Sydney)' },
  { value: 'ap-northeast-1',  label: 'ap-northeast-1 (Tokyo)' },
  { value: 'ap-northeast-2',  label: 'ap-northeast-2 (Seoul)' },
  { value: 'us-east-1',       label: 'us-east-1 (N. Virginia)' },
  { value: 'us-east-2',       label: 'us-east-2 (Ohio)' },
  { value: 'us-west-1',       label: 'us-west-1 (N. California)' },
  { value: 'us-west-2',       label: 'us-west-2 (Oregon)' },
  { value: 'eu-west-1',       label: 'eu-west-1 (Ireland)' },
  { value: 'eu-west-2',       label: 'eu-west-2 (London)' },
  { value: 'eu-central-1',    label: 'eu-central-1 (Frankfurt)' },
  { value: 'eu-north-1',      label: 'eu-north-1 (Stockholm)' },
  { value: 'ca-central-1',    label: 'ca-central-1 (Canada)' },
  { value: 'sa-east-1',       label: 'sa-east-1 (São Paulo)' },
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface AWSConnectWizardProps {
  /** Called when the wizard successfully verifies a new connection. */
  onConnected: (account: CloudAccountOut) => void;
  /** Called when the user cancels/closes the wizard. */
  onCancel: () => void;
  /**
   * Setup details of an existing PENDING/FAILED connection. When provided the
   * wizard resumes at the CloudFormation step instead of creating a new record.
   */
  resume?: CloudAccountConnectResponse | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="btn btn-ghost btn-sm btn-icon ml-1 shrink-0"
      aria-label={copied ? 'Copied' : 'Copy External ID'}
    >
      {copied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

function StepBadge({ step, current }: { step: number; current: number }) {
  const done = current > step;
  const active = current === step;
  return (
    <div
      className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
        done
          ? 'bg-success border-success text-white'
          : active
          ? 'bg-primary border-primary text-white'
          : 'bg-white border-gray-200 text-gray-400'
      }`}
    >
      {done ? <CheckCircle2 size={16} /> : step}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AWSConnectWizard({ onConnected, onCancel, resume = null }: AWSConnectWizardProps) {
  const [step, setStep] = useState(resume ? 1 : 0);

  // Step 0 state
  const [accountId, setAccountId] = useState(resume?.account_id ?? '');
  const [region, setRegion] = useState(resume?.region ?? 'ap-south-1');
  const [step0Error, setStep0Error] = useState('');
  const [step0Loading, setStep0Loading] = useState(false);

  // Step 1 state (populated after connect API call)
  const [connectData, setConnectData] = useState<CloudAccountConnectResponse | null>(resume);

  // Step 2 state
  const [roleArn, setRoleArn] = useState(
    resume ? `arn:aws:iam::${resume.account_id}:role/${resume.role_name}` : '',
  );
  const [step2Error, setStep2Error] = useState('');
  const [step2Loading, setStep2Loading] = useState(false);

  // Step 3 state (populated after verify API call)
  const [connectedAccount, setConnectedAccount] = useState<CloudAccountOut | null>(null);

  // A connection was already created (or resumed) and the user came back to
  // step 0. If nothing changed we reuse it; otherwise it gets replaced.
  const detailsChanged = connectData !== null &&
    (connectData.account_id !== accountId.trim() || connectData.region !== region);

  // Bring the "this will replace your connection" notice into view as soon as it
  // appears — the body may be scrolled on short viewports.
  const replaceNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailsChanged) replaceNoticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [detailsChanged]);

  // Still working on the exact connection the wizard was resumed with.
  const onResumedConnection = resume !== null && connectData?.connection_id === resume.connection_id && !detailsChanged;

  // ── Step 0 → Step 1: call /api/cloud/aws/connect ──────────────────────────
  const handleConnect = async () => {
    setStep0Error('');
    if (!/^\d{12}$/.test(accountId.trim())) {
      setStep0Error('AWS Account ID must be exactly 12 digits.');
      return;
    }
    // Same account + region as the existing connection — keep its External ID.
    if (connectData && !detailsChanged) {
      setStep(1);
      return;
    }
    setStep0Loading(true);
    try {
      const previous = connectData;
      const data = await connectAWSAccount({ account_id: accountId.trim(), region });
      // Retire the superseded unfinished connection so it doesn't linger as a
      // duplicate "Pending" account. Best effort: the new connection is valid
      // even if this fails.
      if (previous) {
        await disconnectAWSAccount(previous.connection_id).catch(() => {});
      }
      setConnectData(data);
      // Pre-fill the expected Role ARN for the user's convenience
      setRoleArn(`arn:aws:iam::${accountId.trim()}:role/${data.role_name}`);
      setStep(1);
    } catch (err: unknown) {
      setStep0Error(err instanceof Error ? err.message : 'Failed to start connection.');
    } finally {
      setStep0Loading(false);
    }
  };

  // ── Step 2 → Step 3: call /api/cloud/aws/{id}/verify ─────────────────────
  const handleVerify = async () => {
    if (!connectData) return;
    setStep2Error('');
    if (!roleArn.trim().startsWith('arn:aws:iam::')) {
      setStep2Error('Role ARN must start with arn:aws:iam::');
      return;
    }
    setStep2Loading(true);
    try {
      const result = await verifyAWSConnection(connectData.connection_id, {
        role_arn: roleArn.trim(),
      });
      if (result.status === 'CONNECTED') {
        // Build a CloudAccountOut-shaped object to hand to the parent
        const account: CloudAccountOut = {
          id: connectData.connection_id,
          provider: 'AWS',
          account_id: connectData.account_id,
          role_arn: result.role_arn ?? roleArn.trim(),
          region: connectData.region,
          status: 'CONNECTED',
          connection_error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_verified_at: result.last_verified_at ?? new Date().toISOString(),
          discovery_ran_at: null,
          discovery_summary: null,
        };
        setConnectedAccount(account);
        setStep(3);
      } else {
        setStep2Error(result.message ?? 'Verification failed. Check the role ARN and try again.');
      }
    } catch (err: unknown) {
      setStep2Error(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setStep2Loading(false);
    }
  };

  // Download CFN template as JSON file
  const handleDownloadTemplate = () => {
    if (!connectData) return;
    const blob = new Blob(
      [JSON.stringify(connectData.cloudformation_template, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `infragenie-crossaccount-role-${connectData.account_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const STEPS = ['Account Details', 'Create IAM Role', 'Verify'];

  // Keep Tab / Shift+Tab cycling inside the dialog.
  const trapFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Footer actions for the current step — rendered in the pinned footer so they
  // never scroll out of view.
  let footer: React.ReactNode = null;
  if (step === 0) {
    footer = (
      <>
        <button onClick={onCancel} className="btn btn-secondary btn-lg sm:flex-1">
          Cancel
        </button>
        <button
          onClick={handleConnect}
          disabled={step0Loading || accountId.length !== 12}
          className="btn btn-primary btn-lg sm:flex-1"
        >
          {step0Loading ? (
            <><Loader2 size={16} className="animate-spin" /> Generating…</>
          ) : connectData && !detailsChanged ? (
            <>Continue <ChevronRight size={16} /></>
          ) : (
            <>Connect AWS Account <ChevronRight size={16} /></>
          )}
        </button>
      </>
    );
  } else if (step === 1 && connectData) {
    footer = (
      <>
        <button onClick={() => setStep(0)} className="btn btn-secondary btn-lg">
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={() => setStep(2)} className="btn btn-primary btn-lg sm:flex-1">
          Stack created — enter Role ARN <ChevronRight size={16} />
        </button>
      </>
    );
  } else if (step === 2 && connectData) {
    footer = (
      <>
        <button onClick={() => setStep(1)} className="btn btn-secondary btn-lg">
          <ChevronLeft size={16} /> Back
        </button>
        <button
          onClick={handleVerify}
          disabled={step2Loading || !roleArn.trim()}
          className="btn btn-primary btn-lg sm:flex-1"
        >
          {step2Loading ? (
            <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          ) : (
            <><RefreshCw size={16} /> Verify Connection</>
          )}
        </button>
      </>
    );
  } else if (step === 3 && connectedAccount) {
    footer = (
      <button onClick={() => onConnected(connectedAccount)} className="btn btn-primary btn-lg sm:flex-1">
        Done
      </button>
    );
  }

  const stepCard = 'rounded-[10px] border border-gray-200 bg-white p-4';
  const stepNum = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aws-connect-title"
      aria-describedby="aws-connect-desc"
      onKeyDown={trapFocus}
      className="flex h-full w-full flex-col overflow-hidden rounded-none border-gray-200 bg-white shadow-[var(--shadow-pop)] sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:w-[800px] sm:max-w-[calc(100vw-48px)] sm:rounded-2xl sm:border"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 id="aws-connect-title" className="text-xl font-semibold tracking-tight text-gray-900 sm:text-[22px] sm:leading-7">
            {resume ? 'Continue AWS Setup' : 'Connect AWS Account'}
          </h2>
          <p id="aws-connect-desc" className="mt-1 text-sm text-gray-500">
            {onResumedConnection
              ? <>Finish connecting account <span className="font-mono text-gray-700">{resume?.account_id}</span>. Your External ID is unchanged.</>
              : 'Securely link your AWS account using cross-account IAM role assumption.'}
          </p>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-icon -mr-2 -mt-1 shrink-0" aria-label="Close">
          <X size={20} />
        </button>
      </div>

      {/* Stepper */}
      <ol className="flex shrink-0 items-center gap-2 border-y border-gray-200 bg-gray-50 px-5 py-3 sm:gap-3 sm:px-6" aria-label="Progress">
        {STEPS.map((label, idx) => {
          const n = idx + 1;
          const current = step + 1;
          const done = current > n;
          const active = current === n;
          return (
            <li key={label} className={`flex min-w-0 items-center gap-2 sm:gap-3 ${active ? 'flex-1 sm:flex-none' : ''}`} aria-current={active ? 'step' : undefined}>
              <StepBadge step={n} current={current} />
              <span
                className={`truncate text-sm font-medium ${active ? 'block' : 'hidden sm:block'} ${
                  active ? 'text-primary' : done ? 'text-green-700' : 'text-gray-500'
                }`}
              >
                {label}
                {done && <span className="sr-only"> (completed)</span>}
              </span>
              {idx < STEPS.length - 1 && (
                <span className="hidden h-px w-6 shrink-0 bg-gray-300 sm:block lg:w-10" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      {/* Body — the only scrolling region */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        {/* ── STEP 0: Account Details ──────────────────────────────────────── */}
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-6 text-gray-600">
              Enter your AWS Account ID and preferred region. Infra Genie will generate a
              unique External ID and a CloudFormation template to create the cross-account
              IAM role in your account.
            </p>
            <div className="flex gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-5 text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                You will <strong>never</strong> be asked for your AWS root credentials,
                access keys, or secret keys. Infra Genie uses a cross-account IAM role.
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {/* Cloud Provider (AWS only for now) */}
              <div>
                <span id="aws-provider-label" className="label text-sm">Cloud Provider</span>
                <div
                  aria-labelledby="aws-provider-label"
                  className="flex h-11 items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 text-[15px] text-gray-700"
                >
                  <Cloud size={18} className="text-[#c2410c]" aria-hidden />
                  <span className="font-medium">Amazon Web Services (AWS)</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* AWS Account ID */}
                <div>
                  <label htmlFor="aws-account-id" className="label text-sm">
                    AWS Account ID
                  </label>
                  <input
                    id="aws-account-id"
                    autoFocus
                    inputMode="numeric"
                    type="text"
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value.replace(/\D/g, '').slice(0, 12));
                      setStep0Error('');
                    }}
                    placeholder="123456789012"
                    maxLength={12}
                    aria-describedby="aws-account-id-help"
                    aria-invalid={step0Error ? true : undefined}
                    className="input input-lg font-mono"
                  />
                  <p id="aws-account-id-help" className="mt-1.5 text-xs text-gray-500">
                    12-digit number found in the top-right corner of your AWS console.
                  </p>
                </div>

                {/* Region */}
                <div>
                  <label htmlFor="aws-region" className="label text-sm">
                    AWS Region
                  </label>
                  <select
                    id="aws-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="input input-lg cursor-pointer"
                  >
                    {AWS_REGIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {detailsChanged && (
              <div ref={replaceNoticeRef} className="flex gap-2.5 rounded-[10px] border border-blue-200 bg-info-bg px-3.5 py-2.5 text-sm leading-5 text-info" role="status">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Changing the account ID or region generates a new External ID and
                  CloudFormation template. The previous unfinished connection
                  ({connectData?.account_id}, {connectData?.region}) will be removed — don't deploy its old template.
                </span>
              </div>
            )}

            {step0Error && (
              <div className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">
                <XCircle size={16} className="shrink-0" />
                {step0Error}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 1: CloudFormation Setup ─────────────────────────────────── */}
        {step === 1 && connectData && (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-6 text-gray-600">
              Download the CloudFormation template and deploy it in your AWS account{' '}
              <strong>{connectData.account_id}</strong>. It creates the{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">
                InfraGenieExecutionRole
              </code>{' '}
              IAM role — everything is pre-configured, no fields to fill in.
            </p>

            {/* External ID info */}
            <div className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-gray-500">
                Your unique External ID (already baked into the template)
              </p>
              <div className="flex items-center">
                <code className="break-all font-mono text-sm text-primary">
                  {connectData.external_id}
                </code>
                <CopyButton text={connectData.external_id} />
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                This ID is hardcoded in the template's trust policy. It ensures only
                Infra Genie can assume the role.
              </p>
            </div>

            {/* Primary action — download first, then open console */}
            <ol className="flex flex-col gap-3">
              {/* Step A: Download */}
              <li className={`${stepCard} border-primary-200 ring-1 ring-primary-100`}>
                <div className="flex items-start gap-3">
                  <span className={`${stepNum} bg-primary`}>1</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      Download the CloudFormation template
                    </p>
                    <p className="mb-3 mt-0.5 text-[13px] text-gray-500">
                      A JSON file with all values pre-filled — no editing required.
                    </p>
                    <button onClick={handleDownloadTemplate} className="btn btn-primary max-w-full">
                      <Download size={16} />
                      <span className="truncate">Download infragenie-crossaccount-role.json</span>
                    </button>
                  </div>
                </div>
              </li>

              {/* Step B: Open CloudFormation */}
              <li className={stepCard}>
                <div className="flex items-start gap-3">
                  <span className={`${stepNum} bg-[#c2410c]`}>2</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      Deploy in your AWS account
                    </p>
                    <p className="mb-3 mt-0.5 text-[13px] leading-5 text-gray-500">
                      Open CloudFormation in <strong>{connectData.region}</strong>, upload the
                      downloaded file, give the stack a name (e.g.{' '}
                      <code className="rounded bg-gray-100 px-1 font-mono">
                        InfraGenie-CrossAccount
                      </code>
                      ), then click through and hit <strong>Submit</strong>.
                    </p>
                    <a
                      href={`https://${connectData.region}.console.aws.amazon.com/cloudformation/home?region=${connectData.region}#/stacks/create`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary max-w-full"
                    >
                      <ExternalLink size={16} />
                      <span className="truncate">Open CloudFormation ({connectData.region})</span>
                    </a>
                  </div>
                </div>
              </li>

              {/* Step C: Copy RoleArn */}
              <li className={stepCard}>
                <div className="flex items-start gap-3">
                  <span className={`${stepNum} bg-gray-600`}>3</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      After stack reaches CREATE_COMPLETE
                    </p>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      Go to your stack → <strong>Outputs</strong> tab → copy the{' '}
                      <strong>RoleArn</strong> value. You'll paste it on the next screen.
                    </p>
                  </div>
                </div>
              </li>
            </ol>

            {/* Testing-only notice */}
            <div className="flex gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-5 text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>
                <span className="font-semibold">Testing / prototype notice: </span>
                The template attaches <strong>AdministratorAccess</strong> to the IAM role.
                This is intentional for prototype testing only. Before production use,
                this will be replaced with a least-privilege custom policy.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 2: Verify Connection ────────────────────────────────────── */}
        {step === 2 && connectData && (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-6 text-gray-600">
              After the CloudFormation stack reaches <strong>CREATE_COMPLETE</strong>, copy
              the <strong>RoleArn</strong> from the stack Outputs tab and paste it below.
            </p>

            {/* Account confirmation */}
            <dl className="grid grid-cols-2 gap-3 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <div>
                <dt className="text-xs text-gray-500">AWS Account</dt>
                <dd className="mt-0.5 font-mono font-semibold text-gray-800">{connectData.account_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Region</dt>
                <dd className="mt-0.5 font-mono font-semibold text-gray-800">{connectData.region}</dd>
              </div>
            </dl>

            {/* Role ARN input */}
            <div>
              <label htmlFor="aws-role-arn" className="label text-sm">
                Role ARN (from CloudFormation Outputs)
              </label>
              <input
                id="aws-role-arn"
                type="text"
                value={roleArn}
                onChange={(e) => { setRoleArn(e.target.value); setStep2Error(''); }}
                placeholder={`arn:aws:iam::${connectData.account_id}:role/InfraGenieExecutionRole`}
                aria-describedby="aws-role-arn-help"
                aria-invalid={step2Error ? true : undefined}
                className="input input-lg font-mono text-sm"
              />
              <p id="aws-role-arn-help" className="mt-1.5 text-xs text-gray-500">
                Found in: CloudFormation → Your Stack → Outputs → RoleArn
              </p>
            </div>

            {step2Error && (
              <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">
                <XCircle size={16} className="mt-0.5 shrink-0" />
                <span>{step2Error}</span>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Connected ─────────────────────────────────────────────── */}
        {step === 3 && connectedAccount && (
          <div className="flex flex-col gap-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
                <CheckCircle2 size={30} className="text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">AWS Account Connected</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Infra Genie can now manage infrastructure in your AWS account.
                </p>
              </div>
            </div>

            <dl className="space-y-2 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm">
              {[
                ['Account ID', connectedAccount.account_id],
                ['Region',     connectedAccount.region],
                ['Role',       'InfraGenieExecutionRole'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="truncate font-mono font-semibold text-gray-800">{value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-gray-500">Status</dt>
                <dd><span className="badge badge-success"><CheckCircle2 size={12} /> Connected</span></dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Footer — pinned, never scrolls away */}
      {footer && (
        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-200 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:px-6">
          {footer}
        </div>
      )}
    </div>
  );
}
