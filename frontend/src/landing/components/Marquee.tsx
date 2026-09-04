const ITEMS = [
  'Docker Automation',
  'Kubernetes Manifests',
  'Terraform Multi-Cloud IaC',
  'GitHub Actions CI/CD',
  'Prometheus & Grafana Specs',
  'Zero-Trust Hardening',
  'Cloud Cost Intelligence',
  'AI Failure Analysis',
];

export default function Marquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <section
      data-testid="editorial-marquee"
      aria-label="Platform capabilities"
      className="relative overflow-hidden border-y border-white/[0.07] bg-ink-900/60 py-5"
    >
      <div className="marquee-track flex w-max items-center gap-10">
        {row.map((item, i) => (
          <span key={i} className="flex items-center gap-10">
            <span className="whitespace-nowrap font-display text-lg font-medium tracking-wide text-slate-400">
              {item}
            </span>
            <span className="h-1.5 w-1.5 rotate-45 bg-copper-500/70" aria-hidden="true" />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-ink-950 to-transparent" />
    </section>
  );
}
