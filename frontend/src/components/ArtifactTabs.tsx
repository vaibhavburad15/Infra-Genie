import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileCode2, Server, GitBranch, Shield, DollarSign, Activity, Layout, Container } from "lucide-react";

const TABS = [
  { key: "docker",        label: "Docker",        icon: Container },
  { key: "terraform",     label: "Terraform",     icon: Server },
  { key: "kubernetes",    label: "Kubernetes",    icon: Layout },
  { key: "cicd",          label: "CI/CD",         icon: GitBranch },
  { key: "architecture",  label: "Architecture",  icon: FileCode2 },
  { key: "monitoring",    label: "Monitoring",    icon: Activity },
  { key: "security",      label: "Security",      icon: Shield },
  { key: "cost_estimate", label: "Cost",          icon: DollarSign },
];

export default function ArtifactTabs({ plan }: { plan: Record<string, string> }) {
  const [active, setActive] = useState("docker");

  const content = plan[active] || "";

  return (
    <div className="card">
      <h3 className="font-semibold mb-4">Generated Artifacts</h3>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-800 pb-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active === key
                ? "bg-brand-700 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
            onClick={() => setActive(key)}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-gray-950 rounded-lg p-4 max-h-[500px] overflow-y-auto">
        {content ? (
          <div className="prose prose-invert prose-sm max-w-none text-sm">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-gray-500 text-sm italic">No content generated for this agent.</p>
        )}
      </div>
    </div>
  );
}
