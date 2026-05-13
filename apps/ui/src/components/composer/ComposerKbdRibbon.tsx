export interface ComposerKbdRibbonProps {
  slashEnabled: boolean;
  hasIdeas: boolean;
  hasQuests: boolean;
  hasHistory: boolean;
}

export default function ComposerKbdRibbon({
  slashEnabled,
  hasIdeas,
  hasQuests,
  hasHistory,
}: ComposerKbdRibbonProps) {
  return (
    <div className="asv-composer-ribbon">
      {slashEnabled && (
        <span>
          <kbd>/</kbd>&nbsp;commands
        </span>
      )}
      {hasIdeas && (
        <span>
          <kbd>⌘P</kbd>&nbsp;ideas
        </span>
      )}
      {hasQuests && (
        <span>
          <kbd>⌘Q</kbd>&nbsp;quests
        </span>
      )}
      {hasHistory && (
        <span>
          <kbd>↑</kbd>&nbsp;history
        </span>
      )}
      <span>
        <kbd>⇧⏎</kbd>&nbsp;newline
      </span>
    </div>
  );
}
