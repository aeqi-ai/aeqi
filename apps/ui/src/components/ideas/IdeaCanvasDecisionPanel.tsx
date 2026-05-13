import { Button, Textarea } from "../ui";
import type { DecisionState } from "../IdeaCanvas";

export interface IdeaCanvasDecisionPanelProps {
  decisionState: DecisionState;
  decisionError: string | null;
  showRejectPanel: boolean;
  setShowRejectPanel: (next: boolean | ((prev: boolean) => boolean)) => void;
  rejectRationale: string;
  setRejectRationale: (s: string) => void;
  onPromote: () => void | Promise<unknown>;
  onReject: () => void | Promise<unknown>;
}

export default function IdeaCanvasDecisionPanel({
  decisionState,
  decisionError,
  showRejectPanel,
  setShowRejectPanel,
  rejectRationale,
  setRejectRationale,
  onPromote,
  onReject,
}: IdeaCanvasDecisionPanelProps) {
  return (
    <div className="ideas-canvas-decision-bar">
      <div className="ideas-canvas-decision-head">
        <span className="ideas-canvas-decision-kind">Candidate skill</span>
        <div className="ideas-canvas-decision-actions">
          <Button
            variant="primary"
            size="sm"
            loading={decisionState === "saving" && !showRejectPanel}
            onClick={onPromote}
          >
            Promote
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={decisionState === "saving"}
            onClick={() => setShowRejectPanel((v) => !v)}
            aria-expanded={showRejectPanel}
          >
            Reject
          </Button>
        </div>
      </div>
      {showRejectPanel && (
        <div className="ideas-canvas-reject-panel">
          <Textarea
            bare
            className="ideas-canvas-reject-textarea"
            placeholder="Why reject? This gets appended to the idea body."
            value={rejectRationale}
            onChange={(e) => setRejectRationale(e.target.value)}
            autoFocus
          />
          <div className="ideas-canvas-decision-actions">
            <Button
              variant="danger"
              size="sm"
              loading={decisionState === "saving"}
              disabled={!rejectRationale.trim()}
              onClick={onReject}
            >
              Confirm rejection
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowRejectPanel(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {decisionError && <span className="ideas-canvas-error">{decisionError}</span>}
    </div>
  );
}
