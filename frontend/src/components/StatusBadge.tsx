import React from "react";
import type { ProjectStatus, DeploymentStatus } from "../types";

type Status = ProjectStatus | DeploymentStatus;

const config: Record<string, { label: string; classes: string }> = {
  pending:           { label: "Pending",            classes: "bg-gray-700 text-gray-300" },
  analyzing:         { label: "Analyzing",           classes: "bg-blue-900 text-blue-300" },
  ready:             { label: "Ready",               classes: "bg-green-900 text-green-300" },
  deploying:         { label: "Deploying",           classes: "bg-yellow-900 text-yellow-300" },
  deployed:          { label: "Deployed",            classes: "bg-green-800 text-green-200" },
  failed:            { label: "Failed",              classes: "bg-red-900 text-red-300" },
  running:           { label: "Running",             classes: "bg-blue-900 text-blue-300" },
  success:           { label: "Success",             classes: "bg-green-800 text-green-200" },
  awaiting_approval: { label: "Awaiting Approval",   classes: "bg-yellow-900 text-yellow-300" },
};

export default function StatusBadge({ status, large }: { status: Status; large?: boolean }) {
  const { label, classes } = config[status] || { label: status, classes: "bg-gray-700 text-gray-300" };
  return (
    <span className={`badge ${classes} ${large ? "text-sm px-3 py-1" : ""}`}>
      {status === "analyzing" || status === "running" ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      ) : null}
      {label}
    </span>
  );
}
