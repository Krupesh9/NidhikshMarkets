import { LockedOverlay } from './LockedOverlay';
import { ChatSample } from './LockedSamples';

/** Full-page lock for /research on Free: a static sample conversation under the glass overlay. No threads are loaded. */
export function ResearchLocked() {
  return (
    <div className="rounded-lg border border-border bg-panel">
      <LockedOverlay
        feature="ai"
        title="The AI research assistant is a Pro feature"
        includes="Ask questions across filings, transcripts, estimates and news — every number cited, with charts and tables, saved threads and notes. Unlimited on Pro."
        sample={<ChatSample />}
        minHeight={520}
      />
    </div>
  );
}
