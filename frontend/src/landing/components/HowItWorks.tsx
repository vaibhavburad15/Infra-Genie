import { FolderGit2, Play, Radar, ScanSearch } from 'lucide-react';
import { Reveal, SectionHeading } from './Reveal';

const STEPS = [
  {
    n: '01',
    icon: FolderGit2,
    title: 'Ingest',
    body: 'Drop a ZIP archive or paste a GitHub repository URL. That is the entire setup.',
  },
  {
    n: '02',
    icon: ScanSearch,
    title: 'Analyze',
    body: 'Agents map your services, ports, dependencies and runtime requirements in parallel.',
  },
  {
    n: '03',
    icon: Play,
    title: 'Generate & approve',
    body: 'Review the Dockerfiles, manifests, Terraform and pipelines. Approve with one click.',
  },
  {
    n: '04',
    icon: Radar,
    title: 'Deploy & monitor',
    body: 'Infrastructure provisions, your app ships, and health, logs and costs stream into the dashboard.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" data-testid="how-it-works-section" className="relative py-24 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <SectionHeading
          chapter="CHAPTER 04"
          eyebrow="The Flow"
          title={
            <>
              Repository to running cluster in{' '}
              <span className="text-copper-400">four moves</span>
            </>
          }
        />

        <div className="relative mt-16">
          <div
            className="pointer-events-none absolute left-0 right-0 top-[52px] hidden h-px bg-gradient-to-r from-transparent via-copper-500/40 to-transparent lg:block"
            aria-hidden="true"
          />
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.12}>
                <div data-testid={`step-card-${s.n}`} className="group relative">
                  <div className="relative z-10 flex h-[104px] flex-col items-start gap-3">
                    <span className="font-mono text-xs tracking-[0.25em] text-slate-600">{s.n}</span>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-copper-500/30 bg-ink-900 text-copper-400 shadow-[0_0_30px_rgba(201,105,42,0.15)] transition-all duration-500 group-hover:scale-110 group-hover:border-copper-400 group-hover:shadow-[0_0_45px_rgba(201,105,42,0.35)]">
                      <s.icon size={22} />
                    </div>
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold text-slate-50">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
