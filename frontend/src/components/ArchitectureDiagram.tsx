/**
 * ArchitectureDiagram
 *
 * Renders the LLM-generated architecture graph using React Flow.
 * Nodes are auto-laid out left-to-right in topological tiers so the diagram
 * reads like a Terraform-plan resource graph.
 */

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchitectureGraph, ArchNode } from '@/api';

// ── Node type → visual config ─────────────────────────────────────────────────

const NODE_STYLES: Record<
  string,
  { bg: string; border: string; text: string; icon: string }
> = {
  gateway:    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: '🌐' },
  frontend:   { bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95', icon: '🖥️' },
  service:    { bg: '#dbeafe', border: '#2563eb', text: '#1e3a7a', icon: '⚙️' },
  database:   { bg: '#d1fae5', border: '#059669', text: '#064e3b', icon: '🗄️' },
  cache:      { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', icon: '⚡' },
  queue:      { bg: '#fce7f3', border: '#db2777', text: '#831843', icon: '📨' },
  storage:    { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e', icon: '🗃️' },
  cdn:        { bg: '#f0fdf4', border: '#16a34a', text: '#14532d', icon: '☁️' },
  auth:       { bg: '#fefce8', border: '#ca8a04', text: '#713f12', icon: '🔐' },
  monitoring: { bg: '#f3f4f6', border: '#6b7280', text: '#1f2937', icon: '📊' },
};

const DEFAULT_STYLE = { bg: '#f1f5f9', border: '#94a3b8', text: '#334155', icon: '📦' };

// ── Custom node renderer ──────────────────────────────────────────────────────

function ArchNodeComponent({ data }: { data: ArchNode & { style: typeof DEFAULT_STYLE } }) {
  const s = data.style;
  return (
    <div
      style={{
        background: s.bg,
        borderColor: s.border,
        color: s.text,
      }}
      className="rounded-xl border-2 px-3 py-2 min-w-[130px] max-w-[180px] shadow-sm"
    >
      <Handle type="target" position={Position.Left} style={{ background: s.border, width: 8, height: 8 }} />
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-base leading-none">{data.style.icon}</span>
        <span className="font-semibold text-[12px] leading-tight truncate">{data.label}</span>
      </div>
      {data.description && (
        <p className="text-[10px] leading-tight opacity-70 truncate">{data.description}</p>
      )}
      <span
        className="mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide"
        style={{ background: s.border + '22', color: s.border }}
      >
        {data.type}
      </span>
      <Handle type="source" position={Position.Right} style={{ background: s.border, width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { archNode: ArchNodeComponent };

// ── Layout helper: simple topo-tier layout ────────────────────────────────────

/**
 * Assigns x/y positions by running a BFS from "root" nodes (no incoming edges)
 * so each tier is one hop further from the entry points.
 */
function computeLayout(
  nodes: ArchNode[],
  edges: { source: string; target: string }[],
): Record<string, { x: number; y: number }> {
  const TIER_W = 220;
  const NODE_H = 90;
  const PAD_Y  = 24;

  // Build adjacency
  const inDegree: Record<string, number> = {};
  const outEdges: Record<string, string[]> = {};
  nodes.forEach(n => { inDegree[n.id] = 0; outEdges[n.id] = []; });
  edges.forEach(e => {
    if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    if (outEdges[e.source]) outEdges[e.source].push(e.target);
  });

  // BFS tiers
  const tier: Record<string, number> = {};
  const queue: string[] = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  if (queue.length === 0 && nodes.length > 0) queue.push(nodes[0].id); // fallback
  queue.forEach(id => { tier[id] = 0; });

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    for (const next of (outEdges[curr] || [])) {
      if (tier[next] === undefined) {
        tier[next] = tier[curr] + 1;
        queue.push(next);
      }
    }
  }
  // Assign remaining nodes (disconnected / cycles)
  nodes.forEach(n => { if (tier[n.id] === undefined) tier[n.id] = 0; });

  // Group by tier, assign y
  const tiers: Record<number, string[]> = {};
  nodes.forEach(n => {
    const t = tier[n.id];
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(n.id);
  });

  const positions: Record<string, { x: number; y: number }> = {};
  Object.entries(tiers).forEach(([t, ids]) => {
    const x = parseInt(t) * TIER_W + 40;
    const totalH = ids.length * NODE_H + (ids.length - 1) * PAD_Y;
    const startY = -totalH / 2;
    ids.forEach((id, i) => {
      positions[id] = { x, y: startY + i * (NODE_H + PAD_Y) };
    });
  });

  return positions;
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  graph: ArchitectureGraph;
}

export default function ArchitectureDiagram({ graph }: Props) {
  const positions = useMemo(
    () => computeLayout(graph.nodes, graph.edges),
    [graph],
  );

  const initialNodes: Node[] = useMemo(
    () =>
      graph.nodes.map(n => ({
        id: n.id,
        type: 'archNode',
        position: positions[n.id] || { x: 0, y: 0 },
        data: {
          ...n,
          style: NODE_STYLES[n.type] || DEFAULT_STYLE,
        },
      })),
    [graph.nodes, positions],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e, i) => ({
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        label: e.label,
        labelStyle: { fontSize: 10, fill: '#6b7280' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
        labelBgPadding: [4, 3] as [number, number],
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
        animated: false,
      })),
    [graph.edges],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges],
  );

  if (!graph.nodes.length) {
    return (
      <p className="text-gray-400 text-sm text-center py-8">
        No architecture graph data available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── React Flow canvas ── */}
      <div
        className="rounded-xl border border-gray-200 overflow-hidden"
        style={{ height: 420 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} className="!shadow-none !border !border-gray-200 !rounded-lg" />
          <MiniMap
            nodeColor={n => {
              const type = (n.data as unknown as ArchNode).type;
              return (NODE_STYLES[type] || DEFAULT_STYLE).border;
            }}
            maskColor="rgba(255,255,255,0.7)"
            className="!border !border-gray-200 !rounded-lg !shadow-none"
          />
        </ReactFlow>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(NODE_STYLES).map(([type, s]) => (
          <span
            key={type}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border"
            style={{ background: s.bg, borderColor: s.border, color: s.text }}
          >
            {s.icon} {type}
          </span>
        ))}
      </div>

      {/* ── Scalability notes ── */}
      {graph.notes && graph.notes.length > 0 && (
        <div className="bg-[#fdf3eb] border border-[#f0bc98] rounded-xl p-4">
          <p className="text-[#c9692a] text-[10px] uppercase font-semibold tracking-wider mb-2.5 flex items-center gap-1.5">
            ✦ Architecture Notes
          </p>
          <ul className="space-y-1.5">
            {graph.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700 leading-relaxed">
                <span className="text-[#c9692a] mt-0.5 flex-shrink-0">•</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
