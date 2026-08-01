import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Zap } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">InfraGenie</span>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-6 text-center">
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </h2>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                className="input"
                type="email"
                name="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handle}
                required
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  className="input"
                  type="text"
                  name="username"
                  placeholder="yourname"
                  value={form.username}
                  onChange={handle}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                className="input"
                type="password"
                name="password"
                placeholder="••••••••"
                value={form.password}
                onChange={handle}
                required
              />
            </div>

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-4">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button
              className="text-brand-400 hover:text-brand-300"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Register" : "Sign In"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
