import { useEffect, useState } from 'react';
import Lenis from 'lenis';
import Navbar from '@/landing/components/Navbar';
import Hero from '@/landing/components/Hero';
import Marquee from '@/landing/components/Marquee';
import Problem from '@/landing/components/Problem';
import Features from '@/landing/components/Features';
import Agents from '@/landing/components/Agents';
import ProductShowcase from '@/landing/components/ProductShowcase';
import HowItWorks from '@/landing/components/HowItWorks';
import Architecture from '@/landing/components/Architecture';
import FinalCTA from '@/landing/components/FinalCTA';
import Footer from '@/landing/components/Footer';

declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

export default function LandingPage() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('landing-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'dark';
  });

  const isLight = theme === 'light';

  useEffect(() => {
    localStorage.setItem('landing-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    window.__lenis = lenis;
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      window.__lenis = undefined;
    };
  }, []);

  return (
    <div className={`landing-page ${isLight ? 'landing-light' : 'landing-dark'} relative min-h-screen bg-ink-950 font-body text-slate-100 antialiased`}>
      <div className="noise-overlay" aria-hidden="true" />
      <Navbar theme={theme} onToggleTheme={() => setTheme(isLight ? 'dark' : 'light')} />
      <main>
        <Hero theme={theme} />
        <Marquee />
        <Problem />
        <Features />
        <Agents />
        <ProductShowcase />
        <HowItWorks />
        <Architecture />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
