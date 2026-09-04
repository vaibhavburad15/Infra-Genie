import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, y = 32, className }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-90px' }}
      transition={{ duration: 0.85, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

interface SectionHeadingProps {
  chapter?: string;
  eyebrow: string;
  title: ReactNode;
  description?: string;
  align?: 'left' | 'center';
}

export function SectionHeading({ chapter, eyebrow, title, description, align = 'left' }: SectionHeadingProps) {
  const centered = align === 'center';
  return (
    <div className={centered ? 'mx-auto max-w-2xl text-center' : 'max-w-3xl'}>
      <Reveal>
        <div className={`flex items-center gap-3 ${centered ? 'justify-center' : ''}`}>
          {chapter && (
            <span className="font-mono text-xs tracking-[0.25em] text-copper-400/90">{chapter}</span>
          )}
          <span className="h-px w-8 bg-copper-500/50" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-slate-400">{eyebrow}</span>
        </div>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-5 font-display text-3xl font-bold leading-[1.08] tracking-tight text-slate-50 sm:text-4xl lg:text-5xl">
          {title}
        </h2>
      </Reveal>
      {description && (
        <Reveal delay={0.16}>
          <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">{description}</p>
        </Reveal>
      )}
    </div>
  );
}
