import { useState } from 'react';
import { Sparkles, Send, Settings, Activity, DollarSign, ShieldAlert, Cpu } from 'lucide-react';

const suggestions: { icon: any; text: string }[] = [
  { icon: Activity, text: 'Check current infrastructure health status' },
  { icon: DollarSign, text: 'Analyze cloud spend and cost optimization' },
  { icon: ShieldAlert, text: 'Run security vulnerability assessment' },
  { icon: Cpu, text: 'Recommend Kubernetes auto-scaling policy' },
];

const initialMessages: { role: string; text: string }[] = [
  {
    role: 'agent',
    text: 'Hello! I am InfraGenie AI Assistant. How can I assist you with your cloud infrastructure, deployments, or security today?',
  },
];

export default function AIAssistant({ isOpen = true }: { isOpen?: boolean }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(initialMessages);

  const send = () => {
    if (!input.trim()) return;
    const userText = input;
    setInput('');
    setMessages((m) => [
      ...m,
      { role: 'user', text: userText },
      { role: 'agent', text: 'Analyzing your infrastructure context. Checking cloud metrics and security policies...' },
    ]);
  };

  if (!isOpen) return null;

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col h-screen bg-white border-l border-slate-200/80 shadow-xs z-20 select-none">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0 h-16">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-[#c9692a]">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-slate-900 leading-snug">AI Assistant</h3>
            <p className="text-[11px] text-slate-400 leading-tight">InfraGenie Companion</p>
          </div>
        </div>
        <button
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          title="AI Settings"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 bg-slate-50/40">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {msg.role === 'agent' ? (
              <div className="flex gap-2.5 max-w-[90%]">
                <div className="w-6 h-6 rounded-lg bg-orange-100/70 border border-orange-200/50 flex items-center justify-center text-[#c9692a] flex-shrink-0 mt-0.5">
                  <Sparkles size={12} />
                </div>
                <div className="bg-white border border-slate-200/80 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-2xs">
                  <p className="text-slate-800 text-xs leading-relaxed whitespace-pre-line">{msg.text}</p>
                </div>
              </div>
            ) : (
              <div className="bg-[#c9692a] text-white rounded-2xl rounded-tr-xs px-3.5 py-2.5 max-w-[85%] shadow-2xs">
                <p className="text-xs leading-relaxed font-medium">{msg.text}</p>
              </div>
            )}
          </div>
        ))}

        {/* Suggested prompts */}
        {messages.length <= 1 && (
          <div className="space-y-2 mt-4 pt-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">Suggested Prompts</p>
            {suggestions.map((s, idx) => {
              const Icon = s.icon;
              return (
                <button
                  key={idx}
                  onClick={() =>
                    setMessages((m) => [
                      ...m,
                      { role: 'user', text: s.text },
                      { role: 'agent', text: 'Gathering real-time telemetry metrics from your active cloud workspace...' },
                    ])
                  }
                  className="w-full flex items-start gap-2.5 bg-white border border-slate-200/80 rounded-xl px-3 py-2.5 text-left hover:border-[#c9692a]/50 hover:bg-orange-50/30 transition-all duration-150 cursor-pointer shadow-2xs group"
                >
                  <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-orange-100 group-hover:text-[#c9692a] text-slate-500 transition-colors">
                    <Icon size={13} />
                  </div>
                  <p className="text-slate-700 text-xs leading-snug group-hover:text-slate-900">{s.text}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Input Section */}
      <div className="p-3.5 bg-white border-t border-slate-100">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-xl px-3 py-2 focus-within:border-[#c9692a] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#c9692a]/15 transition-all">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-slate-800 text-xs placeholder-slate-400 focus:outline-none"
          />
          <button
            onClick={send}
            className="w-7 h-7 rounded-lg bg-[#c9692a] hover:bg-[#b55820] flex items-center justify-center text-white shadow-2xs transition-colors cursor-pointer flex-shrink-0"
            title="Send message"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}

