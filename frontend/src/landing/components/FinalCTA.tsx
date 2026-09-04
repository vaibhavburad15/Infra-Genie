import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';
import { REGISTER_URL } from '../config';

export default function FinalCTA() {
  return (
    <section data-testid="final-cta-section" className="relative py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-copper-500/25 bg-gradient-to-b from-ink-800 to-ink-950 px-6 py-20 text-center sm:px-12 lg:py-28">
            <div
              className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[700px] -translate-x-1/2 rounded-full bg-copper-500/15 blur-[120px]"
              aria-hidden="true"
            />
            <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />

            <div className="relative">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-copper-400/90">
                Stop configuring. Start shipping.
              </p>
              <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl">
                Ready to let the genie run{' '}
                <span className="bg-gradient-to-r from-copper-300 to-copper-500 bg-clip-text text-transparent">
                  your infrastructure?
                </span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-400">
                Connect a repository and watch ten AI agents produce deployment-ready cloud
                infrastructure — reviewed by you, deployed for you.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <a
                  data-testid="final-cta-register-button"
                  href={REGISTER_URL}
                  className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-copper-600 to-copper-500 px-8 py-4 font-display text-base font-bold text-white shadow-[0_12px_45px_rgba(201,105,42,0.45)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_16px_65px_rgba(201,105,42,0.65)]"
                >
                  Get Started
                  <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
