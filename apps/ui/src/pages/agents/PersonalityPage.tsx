import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Idea } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import LazyBlockEditor from "@/components/editor/LazyBlockEditor";
import { Spinner } from "@/components/ui";

/**
 * Personality tab on the agent rail.
 *
 * Personality is HOW the agent thinks — an Idea, not a "system prompt".
 * Per `feedback_no_prompt_vocabulary.md` AEQI has four primitives, no
 * prompts; the runtime auto-injects identity-tagged ideas at
 * `session:start` (see `idea_assembly.rs`), so this surface is the
 * canonical place an operator teaches an agent its voice.
 *
 * The deterministic lookup key is the tag `personality:<agent_id>`
 * (created by every persona-spawn path — `ipc/blueprints.rs`,
 * `ipc/agents.rs`, `tools/agents.rs`). Legacy persona ideas authored
 * before the tag rolled out fall through to the `identity` tag pinned
 * to the same `agent_id`. First save creates the row; subsequent saves
 * patch the body in place. There is no fallback default — agents that
 * don't have a personality just don't get one in their assembly.
 */
export default function PersonalityPage({ agentId }: { agentId: string }) {
  const agent = useDaemonStore((s) => s.agents.find((a) => a.id === agentId));
  const personalityTag = `personality:${agentId}`;

  const [idea, setIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Latest editor JSON snapshot. The BlockEditor emits debounced JSON;
  // we hold the most recent string and persist it from `flushSave`.
  const latestContentRef = useRef<string | null>(null);
  // Track in-flight save so unmount doesn't double-fire.
  const inflightRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);

  // Fetch the agent's personality idea on mount / agent switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getIdeas({ agent_id: agentId, limit: 100 })
      .then((data) => {
        if (cancelled) return;
        const ideas = ((data.ideas as Idea[] | undefined) ?? []) as Idea[];
        // Primary: the deterministic personality:<id> tag.
        const tagged = ideas.find(
          (i) => i.agent_id === agentId && (i.tags ?? []).includes(personalityTag),
        );
        // Legacy fallback: an identity-tagged idea that's owned by this
        // agent (pre-personality-tag installs). On first save we'll
        // upgrade it by patching the personality tag onto the row.
        const legacy = ideas.find(
          (i) => i.agent_id === agentId && (i.tags ?? []).includes("identity"),
        );
        setIdea(tagged ?? legacy ?? null);
        latestContentRef.current = (tagged ?? legacy ?? null)?.content ?? null;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load personality");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, personalityTag]);

  // Persist current editor snapshot. Creates the idea on first save,
  // patches in place on subsequent saves. Auto-merges the personality
  // tag into legacy identity-only rows so the row matches the lookup
  // contract going forward.
  const flushSave = useCallback(async () => {
    const snapshot = latestContentRef.current;
    if (snapshot == null) return; // nothing to persist
    if (inflightRef.current) return;
    if (idea && snapshot === idea.content) return; // no-op

    inflightRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      if (!idea) {
        // First-save path — create a fresh personality idea owned by
        // this agent. Tag set mirrors `tools/mod.rs::persona_idea_tags`
        // so the runtime's session:start tag-policy assembly path
        // (which keys on `identity`) keeps working unchanged.
        const name = agent?.name ? `Persona — ${agent.name}` : "Personality";
        const tags = [personalityTag, "identity", "evergreen"];
        const res = await api.storeIdea({
          name,
          content: snapshot,
          tags,
          agent_id: agentId,
        });
        setIdea({
          id: res.id,
          name,
          content: snapshot,
          tags,
          agent_id: agentId,
        });
      } else {
        // Update path. Union the personality tag in if a legacy
        // identity-only row was the fallback match.
        const existingTags = idea.tags ?? [];
        const tagsNeedPatch = !existingTags.includes(personalityTag);
        const nextTags = tagsNeedPatch ? [personalityTag, ...existingTags] : existingTags;
        await api.updateIdea(idea.id, {
          content: snapshot,
          ...(tagsNeedPatch ? { tags: nextTags } : {}),
        });
        setIdea({ ...idea, content: snapshot, tags: nextTags });
      }
      setSaveState("saved");
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      inflightRef.current = false;
    }
  }, [agent?.name, agentId, idea, personalityTag]);

  // BlockEditor emits debounced JSON; we cache the latest snapshot and
  // persist on blur (next idle tick) so chunk-load flicker doesn't
  // cause spurious saves while the user is mid-typing.
  const handleEditorChange = useCallback(
    (json: string) => {
      latestContentRef.current = json;
      // Schedule a save after the editor's own debounce settles. The
      // editor already debounces ~400ms; this kicks the persist on the
      // next macrotask so the snapshot ref reads the freshly-flushed
      // value.
      void flushSave();
    },
    [flushSave],
  );

  // Flush on unmount / agent switch so a half-typed sentence doesn't
  // get lost.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (latestContentRef.current != null) {
        void flushSave().catch(() => {
          /* best-effort flush on unmount */
        });
      }
    };
    // flushSave changes when idea changes, but we want the unmount
    // path to use the latest closure — re-binding is fine.
  }, [flushSave]);

  const placeholder = useMemo(
    () =>
      agent?.name
        ? `How does ${agent.name} think? Voice, priorities, what they refuse to do…`
        : "How does this agent think? Voice, priorities, what they refuse to do…",
    [agent?.name],
  );

  if (loading) {
    return (
      <div className="page-content" style={{ display: "grid", placeItems: "center" }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className="page-content">
      <header className="agent-settings-heading-row">
        <div>
          <h2 className="agent-settings-heading">Personality</h2>
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
              marginTop: 4,
              maxWidth: 56 * 8,
            }}
          >
            Identity, voice, priorities. Read once at session start as the agent&rsquo;s grounding
            context.
          </p>
        </div>
        <span
          className={`agent-settings-save-pill${
            saveState === "saved" || saveState === "error" || saveState === "saving"
              ? " agent-settings-save-pill--visible"
              : ""
          }${saveState === "error" ? " agent-settings-save-pill--error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="agent-settings-save-pill-dot" aria-hidden="true" />
          {saveState === "saving"
            ? "Saving"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? (error ?? "Save failed")
                : ""}
        </span>
      </header>

      <div style={{ marginTop: "var(--space-4)" }}>
        {/* Keying on idea.id resets the editor when switching between
            agents whose ideas haven't been fetched yet — same trick the
            shared IdeaCanvas uses. */}
        <LazyBlockEditor
          key={idea?.id ?? `compose-${agentId}`}
          initialContent={idea?.content ?? null}
          onChange={handleEditorChange}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
