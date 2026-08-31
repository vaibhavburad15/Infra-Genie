import { Bot, Construction, Terminal, Send, Settings } from 'lucide-react';
import { useState } from 'react';

export default function AgentsPage() {
  const [message, setMessage] = useState('');

  return (
    <div className="flex h-full overflow-hidden bg-[#f4f6fa]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-gray-800 text-lg font-bold">AI Agent Fleet</h2>
            <p className="text-gray-400 text-xs">0 active · 0 total agents</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Construction size={28} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">AI Agents coming soon</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs">
            Autonomous agents for CI/CD, security scanning, Terraform provisioning, and Kubernetes management will be available in a future release.
          </p>
        </div>
      </div>

      {/* Console panel */}
      <div className="w-80 border-l border-gray-100 flex flex-col flex-shrink-0 bg-white">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center">
              <Bot size={18} className="text-[#1e3a7a]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-gray-800 text-sm font-bold">No agent selected</h3>
              <span className="text-gray-400 text-xs">Select an agent to view details</span>
            </div>
            <button className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 cursor-pointer">
              <Settings size={13} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-gray-800 text-xs font-semibold">Agent Console</p>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-gray-300 text-xs text-center">No agent messages yet.</p>
          </div>
          <div className="p-3 border-t border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <Terminal size={13} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Send a command..."
                className="flex-1 bg-transparent text-gray-600 text-xs placeholder-gray-400 focus:outline-none"
                disabled
              />
              <button className="text-gray-300 flex-shrink-0 cursor-not-allowed" disabled>
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
