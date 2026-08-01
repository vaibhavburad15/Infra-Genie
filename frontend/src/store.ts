/**
 * Zustand global store — auth state, current project, polling status.
 */
import { create } from "zustand";
import type { User, Project } from "./types";

interface AppStore {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;

  projects: Project[];
  setProjects: (projects: Project[]) => void;
  upsertProject: (project: Project) => void;

  selectedProjectId: string | null;
  setSelectedProject: (id: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  user: null,
  token: localStorage.getItem("token"),

  setAuth: (user, token) => {
    localStorage.setItem("token", token);
    set({ user, token });
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ user: null, token: null, projects: [], selectedProjectId: null });
  },

  projects: [],
  setProjects: (projects) => set({ projects }),
  upsertProject: (project) =>
    set((state) => {
      const exists = state.projects.find((p) => p.id === project.id);
      if (exists) {
        return { projects: state.projects.map((p) => (p.id === project.id ? project : p)) };
      }
      return { projects: [project, ...state.projects] };
    }),

  selectedProjectId: null,
  setSelectedProject: (id) => set({ selectedProjectId: id }),
}));
