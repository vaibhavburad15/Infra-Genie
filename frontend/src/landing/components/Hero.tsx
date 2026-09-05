import { lazy, Suspense } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronDown, GitBranch } from 'lucide-react';
import TerminalWidget from './TerminalWidget';
import { REGISTER_URL, navigateToRegister } from '../config';
import { scrollToId } from '../lib/scroll';

const HeroScene = lazy(() => import('./HeroScene'));

const HEADLINE = [
  { text: 'Push code.', accent: false },
  { text: 'Get production', accent: false },
  { text: 'infrastructure.', accent: true },
];

const STACK_CHIPS = ['Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'AWS', 'Prometheus'];

function MaskedLine({ text, accent, index }: { text: string; accent: boolean; index: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="block overflow-hidden pb-1">
      <motion.span
        className={`block font-display font-extrabold leading-[1.02] tracking-tight ${
          accent
            ? 'bg-gradient-to-r from-copper-300 via-copper-400 to-copper-500 bg-clip-text text-transparent'
            : 'text-slate-50'
        }`}
        initial={{ y: reduce ? 0 : '112%', opacity: reduce ? 0 : 1 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, delay: 0.35 + index * 0.14, ease: [0.22, 1, 0.36, 1] }}
      >
        {text}
      </motion.span>
    </span>
  );
}

export default function Hero({ theme }: { theme: 'dark' | 'light' }) {
  const reduce = useReducedMotion();
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section data-testid="hero-section" className="relative flex min-h-screen items-center overflow-hidden">
      <Suspense fallback={<div className="absolute inset-0 bg-ink-950" />}>
        <HeroScene theme={theme} />
      </Suspense>
      <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-28 pt-36 sm:px-6 lg:px-12 lg:pt-40">
        <div className="max-w-3xl">
          

          <h1 className="mt-7 text-5xl sm:text-6xl lg:text-[5.4rem]">
            {HEADLINE.map((l, i) => (
              <MaskedLine key={l.text} text={l.text} accent={l.accent} index={i} />
            ))}
          </h1>

          <motion.p {...fade(0.85)} className="mt-7 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Upload a ZIP or connect a GitHub repo. Ten specialized AI agents read your stack and
            write the Dockerfiles, Kubernetes manifests, Terraform and CI/CD pipelines it needs —
            then deploy, monitor and optimize it.
          </motion.p>

          <motion.div {...fade(1)} className="mt-9 flex flex-wrap items-center gap-4">
            <a
              data-testid="hero-cta-primary"
              href={REGISTER_URL}
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-copper-600 to-copper-500 px-7 py-4 font-display text-base font-bold text-white shadow-[0_12px_45px_rgba(201,105,42,0.4)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_16px_60px_rgba(201,105,42,0.6)]"
            >
              Deploy Your First Repo
              <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <button
              data-testid="hero-cta-secondary"
              onClick={() => scrollToId('architecture')}
              className="rounded-xl border border-white/15 bg-white/[0.03] px-7 py-4 font-display text-base font-bold text-slate-200 backdrop-blur transition-all duration-300 hover:border-copper-500/50 hover:bg-white/[0.06] hover:text-white"
            >
              Explore the Architecture
            </button>
          </motion.div>

          <motion.div {...fade(1.15)} className="mt-12">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Generates production artifacts for
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STACK_CHIPS.map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300"
                >
                  {s === 'GitHub Actions' && <GitBranch size={11} className="text-slate-400" />}
                  {s}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.3 }}
        className="absolute bottom-24 right-12 z-10 hidden xl:block"
      >
        <TerminalWidget />
      </motion.div>

      <motion.button
        data-testid="hero-scroll-indicator"
        onClick={() => scrollToId('problem')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1 }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-slate-500 transition-colors hover:text-copper-300"
        aria-label="Scroll to content"
      >
        <ChevronDown size={22} className="animate-bounce" />
      </motion.button>
    </section>
  );
}



