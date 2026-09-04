import { CloudCog, GitBranch, Network, Package, Radar } from 'lucide-react';
import { Reveal, SectionHeading } from './Reveal';

const NODES = [
  {
    icon: GitBranch,
    title: 'Source',
    tag: 'INGEST',
    items: ['GitHub repository', 'ZIP archive upload'],
  },
  {
    icon: Network,
    title: 'Agent Mesh',
    tag: 'LANGGRAPH',
    items: ['10 parallel AI agents', 'Background job workers'],
  },
  {
    icon: Package,
    title: 'Synthesis',
    tag: 'ARTIFACTS',
    items: ['Docker · K8s · Terraform', 'CI/CD · Security · Cost'],
  },
  {
    icon: CloudCog,
    title: 'Cloud Targets',
    tag: 'DEPLOY',
    items: ['AWS — primary', 'Azure & GCP — roadmap'],
  },
  {
    icon: Radar,
    title: 'Observe',
    tag: 'MONITOR',
    items: ['Prometheus & Grafana', 'AI failure analysis'],
  },
];

export default function Architecture() {
  return (
    <section id="architecture" data-testid="architecture-section" className="relative overflow-hidden py-24 lg:py-36">
      <div className="pointer-events-none absolute right-0 top-1/3 h-[420px] w-[620px] rounded-full bg-copper-500/[0.07] blur-[130px]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <SectionHeading
          eyebrow="Under the Hood"
          align="center"
          title={
            <>
              A pipeline,{' '}
              <span className="bg-gradient-to-r from-copper-300 to-copper-500 bg-clip-text text-transparent">
                not a black box
              </span>
            </>
          }
          description="React + TypeScript on the front, FastAPI orchestrating background workers, a LangGraph multi-agent mesh in the middle, and PostgreSQL + Redis keeping state and queues honest."
        />

        <Reveal delay={0.15} className="mt-16">
          <div className="relative rounded-3xl border border-white/[0.07] bg-ink-900/50 p-6 backdrop-blur sm:p-10">
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 1200 260"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line x1="60" y1="130" x2="1140" y2="130" stroke="rgba(201,105,42,0.18)" strokeWidth="1" className="flow-line" />
            </svg>

            <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {NODES.map((n, i) => (
                <div
                  key={n.title}
                  data-testid={`arch-node-${i}`}
                  className="group relative rounded-2xl border border-white/[0.08] bg-ink-800/80 p-5 transition-all duration-500 hover:-translate-y-1 hover:border-copper-500/35"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-copper-400 transition-transform duration-500 group-hover:scale-110">
                      <n.icon size={18} />
                    </div>
                    <span className="font-mono text-[9px] tracking-[0.2em] text-slate-500">{n.tag}</span>
                  </div>
                  <h3 className="mt-4 font-display text-base font-bold text-slate-100">{n.title}</h3>
                  <ul className="mt-2 space-y-1">
                    {n.items.map((it) => (
                      <li key={it} className="text-xs leading-relaxed text-slate-400">
                        {it}
                      </li>
                    ))}
                  </ul>
                  {i < NODES.length - 1 && (
                    <span
                      className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-gradient-to-r from-copper-500/60 to-transparent lg:block"
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 border-t border-white/[0.06] pt-6">
              {['React', 'TypeScript', 'FastAPI', 'LangGraph', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes'].map(
                (t) => (
                  <span
                    key={t}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] tracking-wider text-slate-400"
                  >
                    {t}
                  </span>
                )
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
