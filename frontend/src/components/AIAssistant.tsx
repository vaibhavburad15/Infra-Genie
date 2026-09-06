import { useState } from 'react';
import { Sparkles, Send, Settings, Activity, DollarSign, HelpCircle, FileText } from 'lucide-react';

const suggestions: { icon: any; text: string }[] = [];

const initialMessages: { role: string; text: string }[] = [];

export default function AIAssistant({ isOpen = true }: { isOpen?: boolean }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(initialMessages);

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [
      ...m,
      { role: 'user', text: input },
      { role: 'agent', text: 'Analyzing your request. Please wait a moment while I check the infrastructure...' },
    ]);
    setInput('');
  };

  if (!isOpen) return null;

  return (
    <aside className="w-72 flex-shrink-0 flex flex-col h-screen bg-[#0f1f4a] border-l border-[#1a2f68]">
      {/* Header */}
      <div className="px-5 py-5 border-b border-[#1a2f68]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#c9692a]" />
            <span className="text-white font-bold text-sm">AI Assistant</span>
          </div>
          <button className="text-[#7099d8] hover:text-[#c9692a] cursor-pointer transition-colors">
            <Settings size={14} />
          </button>
        </div>
        <p className="text-[#7099d8] text-xs">Your Infra genie Companion</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === 'user' ? 'flex justify-end' : ''}>
            {msg.role === 'agent' ? (
              <div className="bg-[#1a2f68] rounded-xl rounded-tl-sm px-4 py-3">
                <p className="text-[#d4e1f5] text-xs leading-relaxed whitespace-pre-line">{msg.text}</p>
              </div>
            ) : (
              <div className="bg-[#c9692a] rounded-xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                <p className="text-white text-xs leading-relaxed">{msg.text}</p>
              </div>
            )}
          </div>
        ))}

        {/* Suggested prompts */}
        {messages.length <= 1 && (
          <div className="space-y-2 mt-2">
            {suggestions.map((s, idx) => {
              const Icon = s.icon;
              return (
                <button
                  key={idx}
                  onClick={() => setMessages((m) => [...m, { role: 'user', text: s.text }, { role: 'agent', text: 'Sure! Let me pull that data for you...' }])}
                  className="w-full flex items-start gap-3 bg-[#162050] border border-[#1a2f68] rounded-xl px-3 py-3 text-left hover:border-[#c9692a]/40 transition-colors cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-lg bg-[#1e3a7a] flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-[#c9692a]/20 transition-colors">
                    <Icon size={12} className="text-[#7099d8] group-hover:text-[#c9692a] transition-colors" />
                  </div>
                  <p className="text-[#a8c1ea] text-xs leading-relaxed">{s.text}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 pb-5">
        <div className="flex items-center gap-2 bg-[#162050] border border-[#1a2f68] rounded-xl px-3 py-2.5 focus-within:border-[#c9692a] transition-colors">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-[#a8c1ea] text-xs placeholder-[#4a72c4] focus:outline-none"
          />
          <button
            onClick={send}
            className="w-7 h-7 rounded-lg bg-[#c9692a] flex items-center justify-center text-white hover:bg-[#b85820] transition-colors cursor-pointer flex-shrink-0"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}
