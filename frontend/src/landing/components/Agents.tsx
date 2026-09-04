import { Reveal, SectionHeading } from './Reveal';

const AGENTS = [
  { n: '01', name: 'Stack Detector', role: 'Language, framework & dependency analysis' },
  { n: '02', name: 'Discovery Agent', role: 'Services, ports & component mapping' },
  { n: '03', name: 'Docker Architect', role: 'Dockerfiles & Compose configurations' },
  { n: '04', name: 'Terraform Generator', role: 'Cloud infrastructure as code' },
  { n: '05', name: 'K8s Synthesizer', role: 'Production Kubernetes manifests' },
  { n: '06', name: 'CI/CD Engine', role: 'GitHub Actions pipelines' },
  { n: '07', name: 'Architecture Advisor', role: 'Scalability & resilience design' },
  { n: '08', name: 'Observability Injector', role: 'Prometheus & Grafana specs' },
  { n: '09', name: 'Security Hardener', role: 'RBAC, policies & risk findings' },
  { n: '10', name: 'Cost Optimizer', role: 'Spend estimates & savings' },
];

export default function Agents() {
  return (
    <section id="agents" data-testid="agents-section" className="relative py-24 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <SectionHeading
          chapter="CHAPTER 02"
          eyebrow="The Agent Mesh"
          title={
            <>
              Not one prompt.{' '}
              <span className="text-copper-400">Ten specialists,</span> one orchestration.
            </>
          }
          description="A LangGraph pipeline coordinates ten domain-expert agents that analyze your project in parallel — each owning one infrastructure concern, all converging on a single reviewed deployment plan."
        />

        <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {AGENTS.map((a, i) => (
            <Reveal key={a.n} delay={0.05 * (i % 5)}>
              <div
                data-testid={`agent-card-${a.n}`}
                className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-800/50 p-5 transition-all duration-500 hover:border-copper-500/40 hover:bg-ink-700/70"
              >
                <span className="pointer-events-none absolute -bottom-4 -right-2 font-display text-[72px] font-extrabold leading-none text-white/[0.04] transition-colors duration-500 group-hover:text-copper-500/10">
                  {a.n}
                </span>
                <span className="font-mono text-[11px] tracking-[0.2em] text-copper-400/80">{a.n}</span>
                <h3 className="mt-3 font-display text-base font-bold text-slate-100">{a.name}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{a.role}</p>
                <span className="mt-4 block h-px w-full bg-gradient-to-r from-copper-500/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
