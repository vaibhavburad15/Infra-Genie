import { useState } from 'react';
import {
  Bot, Cpu, Terminal, CheckCircle2, Loader, Pause, Play, Settings, Plus,
  Zap, Brain, GitBranch, Cloud, Shield, DollarSign, Activity, MessageSquare, Send, Boxes,
} from 'lucide-react';

interface Agent {
  id: string; name: string; type: string; icon: React.ElementType;
  status: 'active' | 'idle' | 'paused'; tasksCompleted: number; successRate: number;
  load: number; description: string; lastAction: string; color: string;
}

const agents: Agent[] = [];

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  active: { dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Active' },
  idle: { dot: 'bg-gray-300', text: 'text-gray-500', bg: 'bg-gray-100', label: 'Idle' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Paused' },
};

const chatMessages: { role: string; agent?: string; text: string; time: string }[] = [];

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState('');
  const [message, setMessage] = useState('');
  const activeAgent = agents.find((a) => a.id === selectedAgent) || null;
  const AgentIcon = (activeAgent && activeAgent.icon) || Boxes;
  const sc = activeAgent ? statusConfig[activeAgent.status] : statusConfig['idle'];

  return (
    <div className="flex h-full overflow-hidden bg-[#f4f6fa]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="text-gray-800 text-lg font-bold">AI Agent Fleet</h2><p className="text-gray-400 text-xs">{agents.filter((a) => a.status === 'active').length} active, {agents.length} total</p></div>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer"><Plus size={14} /> Configure Agent</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const Icon = agent.icon;
            const cfg = statusConfig[agent.status];
            const isSelected = selectedAgent === agent.id;
            return (
              <div key={agent.id} onClick={() => setSelectedAgent(agent.id)}
                className={`bg-white rounded-2xl border p-4 cursor-pointer transition-all ${isSelected ? 'border-[#c9692a] shadow-md' : 'border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${agent.color}15`, color: agent.color }}><Icon size={18} /></div>
                    <div><h3 className="text-gray-800 text-sm font-bold leading-tight">{agent.name}</h3><p className="text-gray-400 text-xs">{agent.type}</p></div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}><span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}</span>
                </div>
                <p className="text-gray-500 text-xs leading-relaxed mb-3 min-h-[32px]">{agent.description}</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 rounded-lg bg-gray-50"><p className="text-gray-800 text-sm font-bold">{agent.tasksCompleted.toLocaleString()}</p><p className="text-gray-400 text-[10px]">Tasks</p></div>
                  <div className="text-center p-2 rounded-lg bg-gray-50"><p className="text-emerald-600 text-sm font-bold">{agent.successRate}%</p><p className="text-gray-400 text-[10px]">Success</p></div>
                  <div className="text-center p-2 rounded-lg bg-gray-50"><p className={`text-sm font-bold ${agent.load > 75 ? 'text-[#c9692a]' : 'text-gray-800'}`}>{agent.load}%</p><p className="text-gray-400 text-[10px]">Load</p></div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3"><div className={`h-full rounded-full transition-all ${agent.load > 75 ? 'bg-[#c9692a]' : 'bg-[#1e3a7a]'}`} style={{ width: `${agent.load}%` }} /></div>
                <div className="flex items-center justify-between">
                  <p className="text-gray-400 text-xs truncate flex-1 mr-2">{agent.lastAction}</p>
                  <button onClick={(e) => e.stopPropagation()} className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 hover:text-[#c9692a] cursor-pointer flex-shrink-0 transition-colors">
                    {agent.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agent detail panel */}
      <div className="w-80 border-l border-gray-100 flex flex-col flex-shrink-0 bg-white">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${activeAgent?.color || '#ddd'}15`, color: activeAgent?.color || '#333' }}><AgentIcon size={18} /></div>
            <div className="flex-1 min-w-0"><h3 className="text-gray-800 text-sm font-bold truncate">{activeAgent?.name || 'No agent selected'}</h3><span className={`inline-flex items-center gap-1 text-xs ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}</span></div>
            <button className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 hover:text-[#c9692a] cursor-pointer"><Settings size={13} /></button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded-lg bg-gray-50"><Activity size={12} className="text-[#c9692a] mx-auto mb-1" /><p className="text-gray-800 text-xs font-bold">{activeAgent?.load ?? 0}%</p><p className="text-gray-400 text-[9px]">Load</p></div>
            <div className="text-center p-2 rounded-lg bg-gray-50"><Zap size={12} className="text-[#c9692a] mx-auto mb-1" /><p className="text-gray-800 text-xs font-bold">{activeAgent?.successRate ?? 0}%</p><p className="text-gray-400 text-[9px]">Success</p></div>
            <div className="text-center p-2 rounded-lg bg-gray-50"><Brain size={12} className="text-[#c9692a] mx-auto mb-1" /><p className="text-gray-800 text-xs font-bold">{activeAgent?.tasksCompleted ? activeAgent.tasksCompleted.toLocaleString() : '0'}</p><p className="text-gray-400 text-[9px]">Tasks</p></div>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100"><p className="text-gray-800 text-xs font-semibold flex items-center gap-2"><MessageSquare size={13} className="text-[#c9692a]" />Agent Console</p></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%]">
                  {msg.role === 'agent' && <p className="text-[#c9692a] text-[10px] font-semibold mb-1">{msg.agent}</p>}
                  <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed ${msg.role === 'user' ? 'bg-[#c9692a] text-white rounded-tr-sm' : 'bg-gray-100 text-gray-700 rounded-tl-sm'}`}>{msg.text}</div>
                  <p className={`text-gray-300 text-[9px] mt-1 ${msg.role === 'user' ? 'text-right' : ''}`}>{msg.time}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-[#c9692a] transition-colors">
              <Terminal size={13} className="text-gray-400 flex-shrink-0" />
              <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Send a command..." className="flex-1 bg-transparent text-gray-600 text-xs placeholder-gray-400 focus:outline-none" />
              <button className="text-[#c9692a] hover:text-[#b85820] cursor-pointer flex-shrink-0"><Send size={13} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
