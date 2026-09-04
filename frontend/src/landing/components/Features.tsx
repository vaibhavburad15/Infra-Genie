import { Activity, Bot, Boxes, Coins, FileCode2, ShieldCheck } from 'lucide-react';
import { Reveal, SectionHeading } from './Reveal';

const FEATURES = [
  {
    icon: Boxes,
    badge: 'IaC AUTOMATION',
    title: 'Full artifact generation',
    body: 'Dockerfiles, Docker Compose, Kubernetes manifests, Terraform modules and GitHub Actions workflows — synthesized from your actual code, not templates.',
    span: 'md:col-span-8',
  },
  {
    icon: Coins,
    badge: 'COST GUARDRAILS',
    title: 'Cost intelligence',
    body: 'Cloud spend estimated before you deploy, with concrete savings recommendations.',
    span: 'md:col-span-4',
  },
  {
    icon: ShieldCheck,
    badge: 'SECOPS AI',
    title: 'Security hardening',
    body: 'RBAC, network policies and container hardening generated alongside every deployment.',
    span: 'md:col-span-4',
  },
  {
    icon: Activity,
    badge: 'OBSERVABILITY',
    title: 'Monitoring, pre-wired',
    body: 'Prometheus configs and Grafana dashboard specs ship with your infrastructure from day one.',
    span: 'md:col-span-8',
  },
  {
    icon: FileCode2,
    badge: 'REVIEW FIRST',
    title: 'Human approval gate',
    body: 'Every generated artifact is reviewable before a single resource is provisioned.',
    span: 'md:col-span-4',
  },
  {
    icon: Bot,
    badge: 'AI ASSISTANT',
    title: 'Ask your infrastructure',
    body: 'A streaming chat assistant that answers questions about your stack, costs and failures.',
    span: 'md:col-span-8',
  },
];

export default function Features() {
  return (
    <section id="features" data-testid="features-section" className="relative overflow-hidden py-24 lg:py-36">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-navy-500/10 blur-[140px]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <SectionHeading
          eyebrow="The Answer"
          align="center"
          title={
            <>
              One platform for the{' '}
              <span className="bg-gradient-to-r from-copper-300 to-copper-500 bg-clip-text text-transparent">
                entire CloudOps lifecycle
              </span>
            </>
          }
          description="Analysis, generation, deployment, monitoring, security and cost — handled by a single intelligent system instead of six disconnected tools."
        />

        <div className="mt-16 grid gap-4 md:grid-cols-12">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={0.06 * i} className={f.span}>
              <div
                data-testid={`feature-card-${i}`}
                className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-800/50 p-7 transition-all duration-500 hover:-translate-y-1 hover:border-copper-500/30 hover:bg-ink-700/60 hover:shadow-[0_20px_60px_rgba(201,105,42,0.12)]"
              >
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-copper-500/0 blur-3xl transition-all duration-500 group-hover:bg-copper-500/15" />
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-copper-400 transition-transform duration-500 group-hover:scale-110">
                    <f.icon size={20} />
                  </div>
                  <span className="font-mono text-[10px] tracking-[0.2em] text-slate-500">{f.badge}</span>
                </div>
                <h3 className="mt-6 font-display text-xl font-bold text-slate-50">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
