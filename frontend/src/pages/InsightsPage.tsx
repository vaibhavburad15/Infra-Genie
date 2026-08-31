import { Brain, Sparkles, Construction } from 'lucide-react';

export default function InsightsPage() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* AI Banner */}
      <div className="bg-gradient-to-r from-[#1e3a7a] to-[#24478f] rounded-2xl p-5 flex items-center gap-4 overflow-hidden relative">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #c9692a 0%, transparent 60%)' }} />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#c9692a]/20 border border-[#c9692a]/30 flex items-center justify-center">
            <Brain size={24} className="text-[#c9692a]" />
          </div>
          <div>
            <h2 className="text-white text-lg font-bold flex items-center gap-2">
              AI-Generated Insights <Sparkles size={15} className="text-[#c9692a]" />
            </h2>
            <p className="text-blue-200 text-sm">Create and analyze a project to generate insights.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Construction size={24} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">AI Insights coming soon</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs">
            Cost, performance, security, and reliability recommendations will be generated once your projects are analyzed and deployed.
          </p>
        </div>
      </div>
    </div>
  );
}
