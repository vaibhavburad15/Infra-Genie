import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import logo from "../assets/logo.png";
import { authApi } from "../api";
import { useStore } from "../store";

export default function Auth() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handle = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let res;
      if (mode === "login") {
        res = await authApi.login(form.email, form.password);
      } else {
        res = await authApi.register(form.email, form.username, form.password);
      }
      setAuth(res.data.user, res.data.access_token);
      toast.success(`Welcome, ${res.data.user.username}!`);
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Authentication failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07111f] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center">
        <div className="grid w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0c1d31] shadow-2xl shadow-black/35 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative flex min-h-[320px] flex-col justify-center border-b border-white/10 bg-white p-8 sm:p-10 lg:min-h-[640px] lg:border-b-0 lg:border-r">
            <div className="absolute inset-y-10 left-0 w-1.5 rounded-r-full bg-brand-500" />
            <img src={logo} alt="InfraGenie" className="w-full max-w-xl object-contain" />
            <div className="mt-10 max-w-lg border-t border-[#d9e0e8] pt-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand-600">CloudOps & DevOps Automation</p>
              <h1 className="mt-3 text-3xl font-bold leading-tight text-[#0d2f52] sm:text-4xl">
                Infrastructure intelligence for faster deployments.
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Plan, automate, and manage infrastructure workflows with a clean control surface built for teams.
              </p>
            </div>
          </section>

          <section className="flex items-center justify-center bg-[#07111f] p-6 sm:p-10">
            <div className="w-full max-w-md">
              <div className="mb-8">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-400">
                  {mode === "login" ? "Welcome back" : "Get started"}
                </p>
                <h2 className="mt-3 text-3xl font-bold text-white">
                  {mode === "login" ? "Sign in to your account" : "Create your account"}
                </h2>
              </div>

              <form onSubmit={submit} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Email</label>
                  <input
                    className="h-12 w-full rounded-lg border border-slate-600/80 bg-[#13263d] px-4 text-base text-white placeholder-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/30"
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={handle}
                    autoComplete="email"
                    required
                  />
                </div>

                {mode === "register" && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">Username</label>
                    <input
                      className="h-12 w-full rounded-lg border border-slate-600/80 bg-[#13263d] px-4 text-base text-white placeholder-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/30"
                      type="text"
                      name="username"
                      placeholder="yourname"
                      value={form.username}
                      onChange={handle}
                      autoComplete="username"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Password</label>
                  <input
                    className="h-12 w-full rounded-lg border border-slate-600/80 bg-[#13263d] px-4 text-base text-white placeholder-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/30"
                    type="password"
                    name="password"
                    placeholder="Password"
                    value={form.password}
                    onChange={handle}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="mt-2 h-12 w-full rounded-lg bg-brand-500 px-4 text-base font-semibold text-white shadow-lg shadow-brand-950/30 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-400">
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                <button
                  className="font-semibold text-brand-400 transition-colors hover:text-brand-300"
                  onClick={() => setMode(mode === "login" ? "register" : "login")}
                >
                  {mode === "login" ? "Register" : "Sign In"}
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
