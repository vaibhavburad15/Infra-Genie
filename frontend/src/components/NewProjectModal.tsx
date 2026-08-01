import React, { useState } from "react";
import toast from "react-hot-toast";
import { X, Github, Upload } from "lucide-react";
import { projectsApi } from "../api";
import type { Project } from "../types";

interface Props {
  onClose: () => void;
  onCreate: (project: Project) => void;
}

export default function NewProjectModal({ onClose, onCreate }: Props) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    source_type: "upload" as "upload" | "github",
    github_url: "",
  });
  const [loading, setLoading] = useState(false);

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (form.source_type === "github" && !form.github_url.trim())
      return toast.error("GitHub URL is required");

    setLoading(true);
    try {
      const res = await projectsApi.create({
        name: form.name,
        description: form.description,
        source_type: form.source_type,
        github_url: form.source_type === "github" ? form.github_url : undefined,
      });
      onCreate(res.data);
      toast.success("Project created!");
    } catch {
      toast.error("Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button className="text-gray-400 hover:text-white" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Project Name</label>
            <input className="input" name="name" placeholder="my-awesome-app" value={form.name} onChange={handle} required />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
            <textarea className="input resize-none" name="description" rows={2} placeholder="Brief description..." value={form.description} onChange={handle} />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Source Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["upload", "github"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.source_type === type
                      ? "border-brand-500 bg-brand-900 text-brand-300"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                  }`}
                  onClick={() => setForm((f) => ({ ...f, source_type: type }))}
                >
                  {type === "upload" ? <Upload className="w-4 h-4" /> : <Github className="w-4 h-4" />}
                  {type === "upload" ? "Upload ZIP" : "GitHub URL"}
                </button>
              ))}
            </div>
          </div>

          {form.source_type === "github" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">GitHub URL</label>
              <input
                className="input"
                name="github_url"
                placeholder="https://github.com/user/repo"
                value={form.github_url}
                onChange={handle}
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
