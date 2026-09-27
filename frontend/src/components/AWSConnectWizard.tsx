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

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ChevronRight,
  Download,
  ExternalLink,
  Copy,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  connectAWSAccount,
  verifyAWSConnection,
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
      className="ml-2 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
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
      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
        done
          ? 'bg-green-500 border-green-500 text-white'
          : active
          ? 'bg-[#1e3a7a] border-[#1e3a7a] text-white'
          : 'bg-white border-slate-200 text-slate-400'
      }`}
    >
      {done ? <CheckCircle2 size={16} /> : step}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AWSConnectWizard({ onConnected, onCancel }: AWSConnectWizardProps) {
  const [step, setStep] = useState(0);

  // Step 0 state
  const [accountId, setAccountId] = useState('');
  const [region, setRegion] = useState('ap-south-1');
  const [step0Error, setStep0Error] = useState('');
  const [step0Loading, setStep0Loading] = useState(false);

  // Step 1 state (populated after connect API call)
  const [connectData, setConnectData] = useState<CloudAccountConnectResponse | null>(null);

  // Step 2 state
  const [roleArn, setRoleArn] = useState('');
  const [step2Error, setStep2Error] = useState('');
  const [step2Loading, setStep2Loading] = useState(false);

  // Step 3 state (populated after verify API call)
  const [connectedAccount, setConnectedAccount] = useState<CloudAccountOut | null>(null);

  // ── Step 0 → Step 1: call /api/cloud/aws/connect ──────────────────────────
  const handleConnect = async () => {
    setStep0Error('');
    if (!/^\d{12}$/.test(accountId.trim())) {
      setStep0Error('AWS Account ID must be exactly 12 digits.');
      return;
    }
    setStep0Loading(true);
    try {
      const data = await connectAWSAccount({ account_id: accountId.trim(), region });
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

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl mx-auto overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1e3a7a] to-[#2d52a8] px-6 py-5">
        <h2 className="text-white text-xl font-bold">Connect AWS Account</h2>
        <p className="text-blue-200 text-sm mt-1">
          Securely link your AWS account using cross-account IAM role assumption.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-0 px-6 py-4 bg-slate-50 border-b border-slate-100">
        {[
          { n: 1, label: 'Account Details' },
          { n: 2, label: 'Create IAM Role' },
          { n: 3, label: 'Verify' },
        ].map(({ n, label }, idx) => (
          <div key={n} className="flex items-center">
            <div className="flex items-center gap-2">
              <StepBadge step={n} current={step + 1} />
              <span
                className={`text-xs font-medium hidden sm:block ${
                  step + 1 === n ? 'text-[#1e3a7a]' : step + 1 > n ? 'text-green-600' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
            {idx < 2 && <ChevronRight size={16} className="text-slate-300 mx-3" />}
          </div>
        ))}
      </div>

      <div className="p-6">
        {/* ── STEP 0: Account Details ──────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <p className="text-slate-600 text-sm mb-4">
                Enter your AWS Account ID and preferred region. Infra Genie will generate a
                unique External ID and a CloudFormation template to create the cross-account
                IAM role in your account.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 text-sm text-amber-800 mb-5">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <span>
                  You will <strong>never</strong> be asked for your AWS root credentials,
                  access keys, or secret keys. Infra Genie uses a cross-account IAM role.
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Cloud Provider (AWS only for now) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Cloud Provider
                </label>
                <div className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 text-sm">
                  <span className="text-lg">☁️</span>
                  <span className="font-semibold">Amazon Web Services (AWS)</span>
                </div>
              </div>

              {/* AWS Account ID */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  AWS Account ID
                </label>
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value.replace(/\D/g, '').slice(0, 12));
                    setStep0Error('');
                  }}
                  placeholder="123456789012"
                  maxLength={12}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a7a]/30 focus:border-[#1e3a7a] transition-all font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">
                  12-digit number found in the top-right corner of your AWS console.
                </p>
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  AWS Region
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a7a]/30 focus:border-[#1e3a7a] bg-white transition-all"
                >
                  {AWS_REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {step0Error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-xl p-3">
                <XCircle size={15} className="shrink-0" />
                {step0Error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={step0Loading || accountId.length !== 12}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3a7a] text-white text-sm font-semibold hover:bg-[#2d52a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {step0Loading ? (
                  <><Loader2 size={15} className="animate-spin" /> Generating…</>
                ) : (
                  <>Connect AWS Account <ChevronRight size={15} /></>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1: CloudFormation Setup ─────────────────────────────────── */}
        {step === 1 && connectData && (
          <div className="space-y-5">
            <p className="text-slate-600 text-sm">
              Download the CloudFormation template and deploy it in your AWS account{' '}
              <strong>{connectData.account_id}</strong>. It creates the{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                InfraGenieExecutionRole
              </code>{' '}
              IAM role — everything is pre-configured, no fields to fill in.
            </p>

            {/* External ID info */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Your Unique External ID (already baked into the template)
              </p>
              <div className="flex items-center">
                <code className="text-sm font-mono text-[#1e3a7a] break-all">
                  {connectData.external_id}
                </code>
                <CopyButton text={connectData.external_id} />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                This ID is hardcoded in the template's trust policy. It ensures only
                Infra Genie can assume the role.
              </p>
            </div>

            {/* Primary action — download first, then open console */}
            <div className="space-y-3">
              {/* Step A: Download */}
              <div className="bg-white border-2 border-[#1e3a7a] rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#1e3a7a] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700 mb-1">
                      Download the CloudFormation template
                    </p>
                    <p className="text-xs text-slate-500 mb-3">
                      A JSON file with all values pre-filled — no editing required.
                    </p>
                    <button
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-2 px-4 py-2.5 bg-[#1e3a7a] text-white rounded-xl text-sm font-semibold hover:bg-[#2d52a8] transition-colors"
                    >
                      <Download size={15} />
                      Download infragenie-crossaccount-role.json
                    </button>
                  </div>
                </div>
              </div>

              {/* Step B: Open CloudFormation */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#FF9900] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700 mb-1">
                      Deploy in your AWS account
                    </p>
                    <p className="text-xs text-slate-500 mb-3">
                      Open CloudFormation in <strong>{connectData.region}</strong>, upload the
                      downloaded file, give the stack a name (e.g.{' '}
                      <code className="bg-slate-100 px-1 rounded font-mono">
                        InfraGenie-CrossAccount
                      </code>
                      ), then click through and hit <strong>Submit</strong>.
                    </p>
                    <a
                      href={`https://${connectData.region}.console.aws.amazon.com/cloudformation/home?region=${connectData.region}#/stacks/create`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FF9900] text-white rounded-xl text-sm font-semibold hover:bg-[#e68a00] transition-colors"
                    >
                      <ExternalLink size={15} />
                      Open CloudFormation ({connectData.region})
                    </a>
                  </div>
                </div>
              </div>

              {/* Step C: Copy RoleArn */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700 mb-1">
                      After stack reaches CREATE_COMPLETE
                    </p>
                    <p className="text-xs text-slate-500">
                      Go to your stack → <strong>Outputs</strong> tab → copy the{' '}
                      <strong>RoleArn</strong> value. You'll paste it on the next screen.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Testing-only notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <p className="font-semibold mb-1">⚠️ Testing / Prototype Notice</p>
              <p>
                The template attaches <strong>AdministratorAccess</strong> to the IAM role.
                This is intentional for prototype testing only. Before production use,
                this will be replaced with a least-privilege custom policy.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3a7a] text-white text-sm font-semibold hover:bg-[#2d52a8] transition-colors"
              >
                Stack created — enter Role ARN <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Verify Connection ────────────────────────────────────── */}
        {step === 2 && connectData && (
          <div className="space-y-5">
            <p className="text-slate-600 text-sm">
              After the CloudFormation stack reaches <strong>CREATE_COMPLETE</strong>, copy
              the <strong>RoleArn</strong> from the stack Outputs tab and paste it below.
            </p>

            <div className="space-y-4">
              {/* Account confirmation */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">AWS Account</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {connectData.account_id}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-500">Region</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {connectData.region}
                  </span>
                </div>
              </div>

              {/* Role ARN input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Role ARN (from CloudFormation Outputs)
                </label>
                <input
                  type="text"
                  value={roleArn}
                  onChange={(e) => { setRoleArn(e.target.value); setStep2Error(''); }}
                  placeholder={`arn:aws:iam::${connectData.account_id}:role/InfraGenieExecutionRole`}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a7a]/30 focus:border-[#1e3a7a] transition-all font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Found in: CloudFormation → Your Stack → Outputs → RoleArn
                </p>
              </div>
            </div>

            {step2Error && (
              <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-xl p-3">
                <XCircle size={15} className="shrink-0 mt-0.5" />
                <span>{step2Error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleVerify}
                disabled={step2Loading || !roleArn.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3a7a] text-white text-sm font-semibold hover:bg-[#2d52a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {step2Loading ? (
                  <><Loader2 size={15} className="animate-spin" /> Verifying…</>
                ) : (
                  <><RefreshCw size={15} /> Verify Connection</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Connected ─────────────────────────────────────────────── */}
        {step === 3 && connectedAccount && (
          <div className="space-y-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={36} className="text-green-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800">AWS Account Connected!</h3>
                <p className="text-slate-500 text-sm mt-1">
                  Infra Genie can now manage infrastructure in your AWS account.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-left space-y-2 text-sm">
              {[
                ['Account ID', connectedAccount.account_id],
                ['Region',     connectedAccount.region],
                ['Role',       'InfraGenieExecutionRole'],
                ['Status',     '🟢 Connected'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-semibold text-slate-800 font-mono">{value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => onConnected(connectedAccount)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#1e3a7a] text-white text-sm font-semibold hover:bg-[#2d52a8] transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
