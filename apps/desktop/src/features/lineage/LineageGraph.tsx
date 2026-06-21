import type { GraphNode } from '@zclaudia/shared';
import type { LayoutModel, LayoutNode } from './layout';
import { glyphFor } from './nodeGlyphs';

interface Props {
  model: LayoutModel;
  onNodeClick: (node: GraphNode) => void;
  laneColorOf?: (sessionId: string) => string;
}

const isJumpable = (n: GraphNode) => n.jump.messageId != null;

function NodeShape({ ln }: { ln: LayoutNode }) {
  const { shape, ring, dimmed } = glyphFor(ln.node);
  const fill = dimmed ? 'transparent' : 'currentColor';
  const op = dimmed ? 0.5 : 1;
  return (
    <g opacity={op}>
      {ring && <circle cx={ln.x} cy={ln.y} r={9} fill="none" stroke="currentColor" strokeOpacity={0.5} />}
      {shape === 'square' && <rect x={ln.x - 6} y={ln.y - 6} width={12} height={12} rx={3} fill={fill} stroke="currentColor" />}
      {shape === 'tag' && <path d={`M${ln.x - 6} ${ln.y - 6} h10 l5 6 -5 6 h-10 z`} fill={fill} stroke="currentColor" />}
      {shape === 'leaf' && <circle cx={ln.x} cy={ln.y} r={6.5} fill="currentColor" stroke="hsl(var(--background))" strokeWidth={2.5} />}
      {shape === 'tip' && <circle cx={ln.x} cy={ln.y} r={5} fill="none" stroke="currentColor" />}
      {shape === 'branch' && (<g><circle cx={ln.x} cy={ln.y} r={6} fill="currentColor" /><circle cx={ln.x} cy={ln.y} r={2} fill="hsl(var(--background))" /></g>)}
      {shape === 'dot' && <circle cx={ln.x} cy={ln.y} r={5.5} fill={fill} stroke="currentColor" />}
    </g>
  );
}

export function LineageGraph({ model, onNodeClick, laneColorOf }: Props) {
  return (
    <svg viewBox={`0 0 ${model.width} ${model.height}`} width="100%" role="img" aria-label="Session lineage graph">
      {model.edges.map((e) => (
        <g key={e.id} opacity={e.dimmed ? 0.45 : 1}>
          <path
            d={e.kind === 'fork'
              ? `M${e.fromX} ${e.fromY} C ${e.fromX + 40} ${e.fromY}, ${e.toX - 40} ${e.toY}, ${e.toX} ${e.toY}`
              : `M${e.fromX} ${e.fromY} L ${e.toX} ${e.toY}`}
            fill="none" stroke="hsl(var(--border))" strokeWidth={e.kind === 'fork' ? 1.5 : 2}
            strokeDasharray={e.kind === 'fork' ? '5 3' : undefined}
          />
          {e.kind === 'message' && e.messageCount > 0 && (
            <text x={(e.fromX + e.toX) / 2 + 8} y={(e.fromY + e.toY) / 2} fontSize={9} fill="hsl(var(--muted-foreground))">{e.messageCount}</text>
          )}
        </g>
      ))}
      {model.badges.map((b) => (
        <text key={`b:${b.branchNodeId}`} x={b.x + 12} y={b.y - 8} fontSize={9} fill="hsl(var(--muted-foreground))">+{b.count} tip</text>
      ))}
      {model.nodes.map((ln) => {
        const jumpable = isJumpable(ln.node);
        const color = laneColorOf ? laneColorOf(ln.sessionId) : 'hsl(var(--primary))';
        return (
          <g key={ln.nodeId} data-testid={`lineage-node-${ln.nodeId}`} style={{ color, cursor: jumpable ? 'pointer' : 'default' }}
             onClick={jumpable ? () => onNodeClick(ln.node) : undefined}>
            <NodeShape ln={ln} />
          </g>
        );
      })}
      {model.laneLabels.map((l) => (
        <text key={`l:${l.sessionId}`} x={l.x} y={16} fontSize={10} textAnchor="middle"
              fill="hsl(var(--muted-foreground))" opacity={l.archived ? 0.5 : 1}>{l.name ?? l.sessionId.slice(0, 6)}</text>
      ))}
    </svg>
  );
}
