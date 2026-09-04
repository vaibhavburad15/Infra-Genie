import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

const LINES = [
  { t: 'stack-detector', m: 'node.js · express · postgres detected', c: 'text-navy-300' },
  { t: 'docker-architect', m: 'multi-stage Dockerfile generated', c: 'text-slate-300' },
  { t: 'k8s-synthesizer', m: '4 manifests · hpa enabled', c: 'text-slate-300' },
  { t: 'terraform-generator', m: 'vpc + eks module planned', c: 'text-slate-300' },
  { t: 'cicd-engine', m: 'deploy.yml · 3 stages wired', c: 'text-slate-300' },
  { t: 'security-hardener', m: '2 findings · non-root enforced', c: 'text-copper-300' },
  { t: 'cost-estimator', m: '~$214/mo · 31% savings found', c: 'text-copper-300' },
  { t: 'orchestrator', m: 'ready for your review ✓', c: 'text-emerald-400' },
];

export default function TerminalWidget() {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? LINES.length : 0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setCount((c) => (c >= LINES.length + 2 ? 0 : c + 1));
    }, 850);
    return () => clearInterval(id);
  }, [reduce]);

  const visible = LINES.slice(0, Math.min(count, LINES.length));

  return (
    <div
      data-testid="hero-terminal-widget"
      className="w-[340px] rounded-2xl border border-white/10 bg-ink-900/80 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 font-mono text-[10px] tracking-widest text-slate-500">AGENT MESH — LIVE</span>
      </div>
      <div className="h-[212px] space-y-2 overflow-hidden px-4 py-3 font-mono text-[11px] leading-relaxed">
        {visible.map((l) => (
          <p key={l.t} className="flex gap-2">
            <span className="shrink-0 text-copper-400/80">▸ {l.t}</span>
            <span className={l.c}>{l.m}</span>
          </p>
        ))}
        <p className="flex items-center gap-1 text-slate-500">
          <span className="text-copper-400">▸</span>
          <span className="terminal-cursor inline-block h-3.5 w-1.5 bg-copper-400" />
        </p>
      </div>
    </div>
  );
}
