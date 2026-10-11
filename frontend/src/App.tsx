import { useEffect, useRef, useState } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/context/useAuth';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import LandingPage from '@/pages/LandingPage';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import DashboardPage from '@/pages/DashboardPage';
import ProjectsPage from '@/pages/ProjectsPage';
import PipelinesPage from '@/pages/PipelinesPage';
import DeploymentsPage from '@/pages/DeploymentsPage';
import DeploymentReviewPage from '@/pages/DeploymentReviewPage';
import AgentsPage from '@/pages/AgentsPage';
import MonitoringPage from '@/pages/MonitoringPage';
import InsightsPage from '@/pages/InsightsPage';
import SecurityPage from '@/pages/SecurityPage';
import CostPage from '@/pages/CostPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import CloudAccountsPage from '@/pages/CloudAccountsPage';

type Page = 'dashboard' | 'projects' | 'deployments' | 'agents' | 'monitoring' | 'insights' | 'pipelines' | 'security' | 'cost' | 'reports' | 'settings' | 'cloud-accounts';

/** Sub-page state for pages that need a selected-item context (e.g. review a deployment). */
interface SubPageState {
  page: 'deployment-review';
  deploymentId: string;
  projectName?: string;
}

const pageMeta: Record<Page, { title: string }> = {
  dashboard: { title: 'Overview' },
  projects: { title: 'Projects' },
  pipelines: { title: 'Pipelines' },
  deployments: { title: 'Deployments' },
  agents: { title: 'AI Agents' },
  monitoring: { title: 'Monitoring' },
  security: { title: 'Security' },
  cost: { title: 'Cost Intelligence' },
  insights: { title: 'AI Insights' },
  reports: { title: 'Reports' },
  settings: { title: 'Settings' },
  'cloud-accounts': { title: 'Cloud Accounts' },
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
      <div className="flex h-screen w-full items-center justify-center bg-canvas">
        <p className="text-sm text-gray-500">Loading…</p>
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
  const [subPage, setSubPage] = useState<SubPageState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  /** Navigate to the deployment review sub-page. */
  const openDeploymentReview = (deploymentId: string, projectName?: string) => {
    setSubPage({ page: 'deployment-review', deploymentId, projectName });
    setActivePage('deployments');
  };

  /** Close sub-page and return to the parent page. */
  const closeSubPage = () => setSubPage(null);

  // Clear sub-page whenever the user navigates to a different top-level page.
  const handleNavigate = (page: Page) => {
    setSubPage(null);
    setActivePage(page);
    setMobileNavOpen(false);
  };

  // Each page starts at the top of the shared scroll region.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activePage, subPage]);

  const crumbs = subPage
    ? [pageMeta.deployments.title, 'Review Deployment']
    : [pageMeta[activePage].title];

  const renderPage = () => {
    // Sub-page takes priority over the normal page render.
    if (subPage?.page === 'deployment-review') {
      return (
        <DeploymentReviewPage
          deploymentId={subPage.deploymentId}
          projectName={subPage.projectName}
          onBack={closeSubPage}
        />
      );
    }

    switch (activePage) {
      case 'dashboard': return <DashboardPage />;
      case 'projects': return <ProjectsPage />;
      case 'pipelines': return <PipelinesPage />;
      case 'deployments':
        return (
          <DeploymentsPage
            onReviewDeployment={openDeploymentReview}
          />
        );
      case 'agents': return <AgentsPage />;
      case 'monitoring': return <MonitoringPage />;
      case 'security': return <SecurityPage />;
      case 'cost': return <CostPage />;
      case 'insights': return <InsightsPage />;
      case 'reports': return <ReportsPage />;
      case 'settings': return <SettingsPage />;
      case 'cloud-accounts': return <CloudAccountsPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-gray-800">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          crumbs={crumbs}
          onNavigate={handleNavigate}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        {/* The single, intentional scroll region for page content. */}
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {renderPage()}
        </main>
      </div>
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

