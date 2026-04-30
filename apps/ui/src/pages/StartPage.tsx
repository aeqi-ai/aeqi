import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
import { Events, useTrack } from "@/lib/analytics";

/**
 * `/start` — the catalog launcher (zero-state and "+ New company"
 * landing). Each tile in the picker navigates to `/start/<slug>` —
 * the setup surface where the operator confirms a name, stages role
 * overrides, and picks a plan before the actual spawn fires.
 *
 * Auth gate: anonymous visitors bounce to `/signup?next=/start`.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;

  useEffect(() => {
    document.title = "Start a company · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/start")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "start" });
  }, [isAuthed, navigate, track]);

  if (!isAuthed) return null;

  return (
    <div className="start-page">
      <header className="start-head">
        <h1 className="page-title">Start a company</h1>
        <p className="start-sub">
          Pick a Blueprint to begin. You'll confirm a name, your team, and your plan on the next
          screen.
        </p>
      </header>
      <BlueprintLaunchPicker mode="spawn-company" />
    </div>
  );
}
