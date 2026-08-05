import { useState } from 'react';
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
  dashboard: { title: 'Dashboard', subtitle: 'Infrastructure overview and real-time status' },
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

export default function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard');
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
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={meta.title} subtitle={meta.subtitle} />
        <main className="flex-1 overflow-hidden">{renderPage()}</main>
      </div>
      <AIAssistant />
    </div>
  );
}
