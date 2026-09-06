import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Menu, Moon, Sun, X } from 'lucide-react';
import { LOGIN_URL, REGISTER_URL, navigateToLogin, navigateToRegister } from '../config';
import { scrollToId } from '../lib/scroll';

const links = [
  { label: 'Features', id: 'features' },
  { label: 'Agent Mesh', id: 'agents' },
  { label: 'Product', id: 'product' },
  { label: 'How It Works', id: 'how-it-works' },
  { label: 'Architecture', id: 'architecture' },
];

interface NavbarProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export default function Navbar({ theme, onToggleTheme }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    scrollToId(id);
  };

  return (
    <header
      data-testid="navbar-header"
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-12">
        <button
          data-testid="navbar-logo"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="group flex items-center gap-3"
          aria-label="Infra Genie home"
        >
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-[0_0_24px_rgba(201,105,42,0.25)] transition-shadow group-hover:shadow-[0_0_32px_rgba(201,105,42,0.45)]">
            <img src="/favicon.png" alt="Infra Genie logo" className="h-full w-full object-contain" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-slate-50">
            Infra<span className="text-copper-400"> Genie</span>
          </span>
        </button>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {links.map((l) => (
            <button
              key={l.id}
              data-testid={`nav-link-${l.id}`}
              onClick={() => go(l.id)}
              className="group relative text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
            >
              {l.label}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-copper-400 transition-all duration-300 group-hover:w-full" />
            </button>
          ))}
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <button
            data-testid="theme-toggle"
            type="button"
            onClick={onToggleTheme}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-copper-300 transition-all duration-300 hover:border-copper-500/50 hover:bg-white/[0.08] hover:text-white cursor-pointer"
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <a
            data-testid="nav-login-link"
            href={LOGIN_URL}
            className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
          >
            Log in
          </a>
          <a
            data-testid="nav-cta-launch"
            href={REGISTER_URL}
            className="group flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-copper-600 to-copper-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(201,105,42,0.35)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(201,105,42,0.55)]"
          >
            Launch Platform
            <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <button
            data-testid="mobile-theme-toggle"
            type="button"
            onClick={onToggleTheme}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-copper-300 transition-colors hover:border-copper-500/50"
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            data-testid="mobile-nav-toggle"
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            data-testid="mobile-nav-drawer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-b border-white/[0.07] bg-ink-950/95 backdrop-blur-xl lg:hidden"
            aria-label="Mobile"
          >
            <div className="space-y-1 px-6 py-6">
              {links.map((l) => (
                <button
                  key={l.id}
                  data-testid={`mobile-nav-link-${l.id}`}
                  onClick={() => go(l.id)}
                  className="block w-full rounded-lg px-3 py-3 text-left font-display text-lg font-medium text-slate-200 transition-colors hover:bg-white/[0.05]"
                >
                  {l.label}
                </button>
              ))}
              <div className="flex gap-3 pt-4">
                <a
                  data-testid="mobile-nav-login"
                  href={LOGIN_URL}
                  className="flex-1 rounded-xl border border-white/15 px-4 py-3 text-center text-sm font-medium text-slate-200"
                >
                  Log in
                </a>
                <a
                  data-testid="mobile-nav-cta"
                  href={REGISTER_URL}
                  className="flex-1 rounded-xl bg-gradient-to-r from-copper-600 to-copper-500 px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Launch Platform
                </a>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

