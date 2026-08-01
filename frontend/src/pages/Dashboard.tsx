import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, FolderOpen, Trash2, RefreshCw, GitBranch, Upload } from "lucide-react";
import { projectsApi } from "../api";
import { useStore } from "../store";
import type { Project } from "../types";
import StatusBadge from "../components/StatusBadge";
import NewProjectModal from "../components/NewProjectModal";

export default function Dashboard() {
  const { projects, setProjects, upsertProject } = useStore();
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await projectsApi.list();
      setProjects(res.data);
    } catch {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    // Poll for status updates every 5s
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, []);

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm("Delete this project?")) return;
    try {
      await projectsApi.delete(id);
      setProjects(projects.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-gray-400 text-sm mt-1">Manage and deploy your infrastructure</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card text-center py-16">
          <FolderOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No projects yet. Create your first one!</p>
          <button className="btn-primary mt-4 inline-flex items-center gap-2" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={deleteProject} />
          ))}
        </div>
      )}

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreate={(p) => {
            upsertProject(p);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="card hover:border-brand-700 transition-colors block group relative"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {project.source_type === "github" ? (
            <GitBranch className="w-4 h-4 text-gray-400" />
          ) : (
            <Upload className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-medium text-white truncate max-w-[180px]">{project.name}</span>
        </div>
        <button
          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
          onClick={(e) => onDelete(project.id, e)}
          aria-label="Delete project"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {project.description && (
        <p className="text-sm text-gray-400 mb-3 line-clamp-2">{project.description}</p>
      )}

      <div className="flex items-center justify-between">
        <StatusBadge status={project.status} />
        <span className="text-xs text-gray-500">
          {new Date(project.created_at).toLocaleDateString()}
        </span>
      </div>

      {(project.status === "analyzing") && (
        <div className="mt-3 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full animate-pulse w-2/3" />
        </div>
      )}
    </Link>
  );
}
