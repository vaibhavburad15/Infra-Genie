import { useEffect, useState } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/context/useAuth';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import LandingPage from '@/pages/LandingPage';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import AIAssistant from '@/components/AIAssistant';
import DashboardPage from '@/pages/DashboardPage';
import ProjectsPage from '@/pages/ProjectsPage';
import PipelinesPage from '@/pages/PipelinesPage';
import DeploymentsPage from '@/pages/DeploymentsPage';
import AgentsPage from '@/pages/AgentsPage';
import MonitoringPage from '@/pages/MonitoringPage';
import InsightsPage from '@/pages/InsightsPage';
import InfrastructurePage from '@/pages/InfrastructurePage';
import SecurityPage from '@/pages/SecurityPage';
import CostPage from '@/pages/CostPage';
import AutomationPage from '@/pages/AutomationPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';

type Page = 'dashboard' | 'projects' | 'deployments' | 'agents' | 'monitoring' | 'insights' | 'infrastructure' | 'pipelines' | 'security' | 'cost' | 'automation' | 'reports' | 'settings';

const pageMeta: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: 'Overview', subtitle: 'Infrastructure overview and real-time status' },
  projects: { title: 'Projects', subtitle: 'Manage your cloud projects and services' },
  infrastructure: { title: 'Infrastructure', subtitle: 'Cloud resources and infrastructure management' },
  pipelines: { title: 'Pipelines', subtitle: 'CI/CD pipeline management and history' },
  deployments: { title: 'Deployments', subtitle: 'Deployment pipelines and history' },
  agents: { title: 'AI Agents', subtitle: 'Autonomous infrastructure management agents' },
  monitoring: { title: 'Monitoring', subtitle: 'Real-time metrics, health, and alerting' },
  security: { title: 'Security', subtitle: 'Vulnerability scanning and compliance' },
  cost: { title: 'Cost Intelligence', subtitle: 'Cloud spend analysis and optimization' },
  automation: { title: 'Automation', subtitle: 'Infrastructure automation rules' },
  insights: { title: 'AI Insights', subtitle: 'AI-powered recommendations and optimization' },
  reports: { title: 'Reports', subtitle: 'Generate and download infrastructure reports' },
  settings: { title: 'Settings', subtitle: 'Manage your account and preferences' },
};

function AuthGate() {
  const { user, isLoading } = useAuth();
  const getRouteFromPath = () => {
    const path = window.location.pathname;
    if (['/login', '/signin', '/sign-in'].includes(path)) return 'login';
    if (['/register', '/signup', '/sign-up'].includes(path)) return 'register';
    if (path === '/') return 'landing';
    return 'login';
  };
  const getAuthViewFromPath = () =>
    getRouteFromPath() === 'register'
      ? 'register'
      : 'login';
  const [publicRoute, setPublicRoute] = useState<'landing' | 'login' | 'register'>(getRouteFromPath);
  const [authView, setAuthView] = useState<'login' | 'register'>(getAuthViewFromPath);

  useEffect(() => {
    const syncPublicRoute = () => {
      const route = getRouteFromPath();
      setPublicRoute(route);
      if (route !== 'landing') setAuthView(route);
    };
    window.addEventListener('popstate', syncPublicRoute);
    return () => window.removeEventListener('popstate', syncPublicRoute);
  }, []);

  const showLogin = () => {
    window.history.pushState(null, '', '/login');
    setPublicRoute('login');
    setAuthView('login');
  };

  const showRegister = () => {
    window.history.pushState(null, '', '/register');
    setPublicRoute('register');
    setAuthView('register');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f4f6fa]">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!user) {
    if (publicRoute === 'landing') {
      return <LandingPage />;
    }

    return authView === 'login' ? (
      <LoginPage onSwitchToRegister={showRegister} />
    ) : (
      <RegisterPage onSwitchToLogin={showLogin} />
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(true);
  const meta = pageMeta[activePage];

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardPage />;
      case 'projects': return <ProjectsPage />;
      case 'pipelines': return <PipelinesPage />;
      case 'deployments': return <DeploymentsPage />;
      case 'agents': return <AgentsPage />;
      case 'monitoring': return <MonitoringPage />;
      case 'security': return <SecurityPage />;
      case 'cost': return <CostPage />;
      case 'automation': return <AutomationPage />;
      case 'insights': return <InsightsPage />;
      case 'reports': return <ReportsPage />;
      case 'settings': return <SettingsPage />;
      case 'infrastructure': return <InfrastructurePage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f6fa]">
      <Sidebar activePage={activePage} onNavigate={setActivePage} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          title={meta.title}
          subtitle={meta.subtitle}
          onNavigate={setActivePage}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          aiOpen={aiOpen}
          onToggleAI={() => setAiOpen((v) => !v)}
        />
        <main className="flex-1 overflow-hidden">{renderPage()}</main>
      </div>
      <AIAssistant isOpen={aiOpen} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

