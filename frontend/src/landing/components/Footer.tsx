import { LOGIN_URL, REGISTER_URL } from '../config';
import { scrollToId } from '../lib/scroll';

const NAV = [
  { label: 'Features', id: 'features' },
  { label: 'Agent Mesh', id: 'agents' },
  { label: 'Product', id: 'product' },
  { label: 'How It Works', id: 'how-it-works' },
  { label: 'Architecture', id: 'architecture' },
];

export default function Footer() {
  return (
    <footer data-testid="footer-section" className="border-t border-white/[0.07] bg-ink-950">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
                <img src="/logo.png" alt="Infra Genie logo" className="h-full w-full object-contain" />
              </span>
              <span className="font-display text-xl font-bold tracking-tight text-slate-50">
                Infra<span className="text-copper-400"> Genie</span>
              </span>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-slate-400">
              From source code to production infrastructure — analyzed, generated, deployed and
              monitored by ten specialized AI agents.
            </p>
            <div
              data-testid="footer-status-pill"
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5"
            >
              <span className="status-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[11px] tracking-wider text-slate-400">ALL AGENTS OPERATIONAL</span>
            </div>
          </div>

          <div className="lg:col-span-3">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Product</h3>
            <ul className="mt-5 space-y-3">
              {NAV.map((n) => (
                <li key={n.id}>
                  <button
                    data-testid={`footer-link-${n.id}`}
                    onClick={() => scrollToId(n.id)}
                    className="text-sm text-slate-400 transition-colors hover:text-copper-300"
                  >
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-4">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Platform</h3>
            <ul className="mt-5 space-y-3">
              <li>
                <a data-testid="footer-login-link" href={LOGIN_URL} className="text-sm text-slate-400 transition-colors hover:text-copper-300">
                  Log in
                </a>
              </li>
              <li>
                <a data-testid="footer-register-link" href={REGISTER_URL} className="text-sm text-slate-400 transition-colors hover:text-copper-300">
                  Create an account
                </a>
              </li>
            </ul>
            <p className="mt-8 text-xs leading-relaxed text-slate-600">
              AI-generated infrastructure should always be reviewed before production use. Validate
              plans, policies and costs before applying.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row">
          <p className="text-xs text-slate-600">© 2026 Infra Genie. All rights reserved.</p>
          <p className="font-mono text-[11px] tracking-wider text-slate-600">
            CODE → CLOUD · ON AUTOPILOT
          </p>
        </div>
      </div>
    </footer>
  );
}
