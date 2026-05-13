import type { QuestStatus } from "@/lib/types";

export default function StatusDot({ status }: { status: QuestStatus }) {
  return <span className={`quest-status-dot quest-status-dot--${status}`} />;
}
