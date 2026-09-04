import { useEffect } from 'react';
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
    <div className="relative min-h-screen bg-ink-950 font-body text-slate-100 antialiased">
      <div className="noise-overlay" aria-hidden="true" />
      <Navbar />
      <main>
        <Hero />
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
