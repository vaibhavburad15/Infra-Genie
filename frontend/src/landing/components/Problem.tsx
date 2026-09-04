import { ArrowRight, Compass, Layers, Wrench } from 'lucide-react';
import { Reveal, SectionHeading } from './Reveal';

const PAINS = [
  {
    icon: Layers,
    title: 'Fragmented toolchain',
    body: 'Docker for packaging, Terraform for provisioning, Kubernetes for orchestration, another tool for pipelines, another for logs. Nothing talks to anything.',
  },
  {
    icon: Compass,
    title: 'Brutal learning curve',
    body: 'Production-grade DevOps demands expertise across a dozen technologies — a wall for beginners and a tax on small teams.',
  },
  {
    icon: Wrench,
    title: 'Automation without intelligence',
    body: 'Existing tools execute tasks but never advise. No architecture guidance, no root-cause analysis, no cost or security recommendations.',
  },
];

export default function Problem() {
  return (
    <section id="problem" data-testid="problem-section" className="relative py-24 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <div className="grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              chapter="CHAPTER 01"
              eyebrow="The Problem"
              title={
                <>
                  Shipping software became a{' '}
                  <span className="text-copper-400">DevOps bottleneck.</span>
                </>
              }
              description="Modern deployment means juggling containers, clusters, IaC, pipelines, monitoring and security — manually. It is slow, error-prone, and it keeps great engineers away from building product."
            />
            <Reveal delay={0.24}>
              <div className="mt-10 flex items-center gap-4 rounded-2xl border border-copper-500/25 bg-copper-500/[0.07] p-5">
                <ArrowRight className="shrink-0 text-copper-400" size={20} />
                <p className="text-sm leading-relaxed text-slate-300">
                  Infra Genie replaces that drag with a single intelligent pipeline —{' '}
                  <span className="font-semibold text-white">code in, running cloud out.</span>
                </p>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <div className="space-y-4">
              {PAINS.map((p, i) => (
                <Reveal key={p.title} delay={0.1 + i * 0.1}>
                  <div
                    data-testid={`problem-card-${i}`}
                    className="group flex gap-5 rounded-2xl border border-white/[0.07] bg-ink-800/60 p-6 transition-all duration-300 hover:border-copper-500/30 hover:bg-ink-700/60"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-copper-400 transition-colors duration-300 group-hover:border-copper-500/40">
                      <p.icon size={20} />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-xs text-slate-600">0{i + 1}</span>
                        <h3 className="font-display text-lg font-bold text-slate-100">{p.title}</h3>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
