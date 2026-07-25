import { useState } from 'react';
import { Archive, ChevronRight } from 'lucide-react';
import type { CompactionMarker } from '@zclaudia/shared';
import { SECTION_LABEL } from '../../components/ui/typography';

interface CompactionMarkerCardProps {
  marker: CompactionMarker;
}

/**
 * Inline timeline card surfacing a session compaction event.
 *
 * Rendered when MessageList encounters a synthetic system message whose
 * `metadata.compactionMarker` is set (the server injects these into the
 * messages list from the session_compactions table). The card is collapsed
 * by default and shows a one-line summary in the header; expanding reveals
 * the LLM-generated summary, any custom instructions the user passed via
 * `/compact <instructions>`, and (when available) the lists of files read /
 * modified during the compacted history.
 */
export function CompactionMarkerCard({ marker }: CompactionMarkerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sourceLabel = marker.source === 'manual' ? 'Manually compacted' : 'Auto-compacted';
  const tokenLabel = `${marker.tokensBefore.toLocaleString()} tokens`;
  const hasInstructions = marker.source === 'manual' && Boolean(marker.customInstructions);
  const hasReadFiles = marker.readFiles.length > 0;
  const hasModifiedFiles = marker.modifiedFiles.length > 0;

  return (
    <div
      data-testid="compaction-marker-card"
      data-compaction-id={marker.compactionId}
      data-source={marker.source}
      className="my-3 rounded-lg border border-border/60 bg-secondary/30 text-xs"
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls={`compaction-body-${marker.compactionId}`}
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Archive size={14} strokeWidth={1.5} className="flex-shrink-0" />
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className={SECTION_LABEL}>{sourceLabel}</span>
        <span className="text-muted-foreground/70">— {tokenLabel}</span>
      </button>

      {expanded && (
        <div
          id={`compaction-body-${marker.compactionId}`}
          className="px-3 pb-3 pt-1 border-t border-border/40 space-y-2"
        >
          {hasInstructions && (
            <div>
              <div className={`${SECTION_LABEL} mb-1`}>Custom instructions</div>
              <div className="px-2 py-1.5 rounded bg-background/60 italic text-foreground/90 whitespace-pre-wrap">
                {marker.customInstructions}
              </div>
            </div>
          )}

          <div>
            <div className={`${SECTION_LABEL} mb-1`}>Summary</div>
            <pre className="px-2 py-1.5 rounded bg-background/60 whitespace-pre-wrap break-words text-foreground/90 font-sans leading-relaxed">
              {marker.summary}
            </pre>
          </div>

          {(hasReadFiles || hasModifiedFiles) && (
            <details className="rounded bg-background/60 px-2 py-1">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                File activity ({marker.readFiles.length} read, {marker.modifiedFiles.length}{' '}
                modified)
              </summary>
              <div className="mt-2 space-y-2">
                {hasReadFiles && (
                  <div>
                    <div className={`${SECTION_LABEL} mb-0.5`}>Read</div>
                    <ul className="list-disc list-inside text-foreground/80">
                      {marker.readFiles.map(path => (
                        <li key={`r-${path}`} className="font-mono break-all">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {hasModifiedFiles && (
                  <div>
                    <div className={`${SECTION_LABEL} mb-0.5`}>Modified</div>
                    <ul className="list-disc list-inside text-foreground/80">
                      {marker.modifiedFiles.map(path => (
                        <li key={`m-${path}`} className="font-mono break-all">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
