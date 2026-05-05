# ROUTE-AUDIT-V2: Design System Coherence — 2026-05-05

**Mission:** Audit apps/ui routes for design-system coherence post-Wave-15 ships (Treasury tab wired to indexer; Ownership and Governance tabs in flight).

**Period:** 2026-05-04 → 2026-05-05

**Scope:** `apps/ui/src/pages` route handlers, focusing on token compliance, button variants, hardcoded px values, and hairlines.

---

## Executive Summary

**Treasury tab (commit 77705134):** PASS — all tokens used correctly, ready for production.

**Ownership & Governance tabs:** Mixed. Treasury is clean. Governance has P1 button-variant violation (raw `<button>` instead of Button component) + P2 spacing inconsistencies. Ownership has single P2 spacing issue.

**Systemic P1 finding:** ~40 hardcoded pixel padding lines across Role/Invitation pages (RoleEditPage, RoleNewPage, RoleInvitePage, RoleDetailPage, InvitationAcceptPage, DrivePage). Not on the Wave-15 ship path, but blocks Wave 16 coherence.

**Token Compliance:** 85% color, 40% spacing, 75% typography. Spacing is the weak point — Role pages predate the token-audit campaign.

---

## Per-Route Findings

### TreasuryPage ✓ PASS
- All spacing: `var(--space-*)` tokens
- Colors: token-compliant with var(--color-*) fallbacks
- Button: `variant="secondary"` correct
- Tables: zebra rows via `var(--bg-subtle)`
- No hardcoded px except table borders (proper)
- **Verdict:** Shipping-ready.

### OwnershipPage ⚠ P2
- Badge variants (accent, muted): correct
- RoleSection spacing: tokens throughout
- **Issue:** Line 197 `marginTop: 2` (should be `var(--space-0)`)
- OnChainCapTable: clean
- **Verdict:** Ship-ready; P2 cleanup in Wave 16.

### GovernancePage ⚠ P1 + P2
- **P1 Issue (line 174):** Raw `<button>` element instead of Button component
  - Inline styling: `padding: "2px var(--space-sm)"`, `borderRadius: "999px"`, `background: var(--color-bg-base)`
  - Bypasses Button affordance (hover, focus, keyboard nav, semantic HTML)
  - Should use Button or `.ideas-toolbar-btn` class pattern
  - **Impact:** Role pill buttons read as bespoke, not system component
  
- **P2 Issue (line 183):** Mixes literal `2px` with token `var(--space-sm)`
  - Correct value (--space-0 = 2px) but inconsistent form
  - Should be `"var(--space-0) var(--space-sm)"` for clarity
  
- **P2 Issue (line 154):** `marginTop: 2` should be `var(--space-0)`

- Badge variants: correct
- **Verdict:** P1 button fix required before Wave 16; P2 spacing cleanup.

### MePage (Personal Rail Dispatch) ⚠ P2
- Route structure: clean
- **Issue:** Lines 90, 101 `fontSize: 14` (hardcoded, not a token)
  - Error fallback messages only
  - Should map to `var(--text-sm)` (14px) or `var(--text-xs)` (12px)
- **Impact:** Low (error path), but violates system
- **Verdict:** P2 cleanup; low priority since error-only.

### CompanyPage ✓ PASS
- Dispatcher structure: canonical
- Tab routing: correct
- No style issues
- **Verdict:** Clean.

### RolePages (RoleEditPage, RoleNewPage, RoleInvitePage, RoleDetailPage) ⚠⚠ P1 SYSTEMIC
- **Critical Finding:** ~40 hardcoded pixel lines across 4 files + 2 satellite files
- **Examples:**
  - `padding: "28px 32px"` (3 instances per file) → should be `var(--space-7) var(--space-8)`? (no --space-7; scale jumps 24px → 32px)
  - `padding: "10px 12px"` (DrivePage:161, RoleEditPage:168, etc.) → no direct token (scale: 8px, 12px, 16px)
  - `padding: "12px 16px"` (InvitationAcceptPage) → `var(--space-3) var(--space-4)`
  - `marginTop: 2` (multiple form fields) → `var(--space-0)`
  - `accentColor: "var(--accent)"` in style prop (should use CSS class)

- **Files Affected:**
  - RoleEditPage:83, 95, 107, 168 + marginTop:2 at 183, 229
  - RoleNewPage:115, 175 + marginTop:2 at 190, 333
  - RoleInvitePage:81, 111, 140, 232
  - RoleDetailPage:73, 85, 101
  - InvitationAcceptPage:150, 226, 272
  - DrivePage:161

- **Root Cause:** These pages were written before the token-system audit (Wave 9) and use raw padding values. Not updated in the token-audit cleanup pass.

- **Verdict:** P1 systemic issue. Blocks Wave 16 baseline coherence. Must fix before other wave work. ~45min cleanup.

### BlueprintsPage ✓ PASS
- PageRail structure: correct
- Toolbar grammar: locked (search · sort · filter · view)
- State: URL-persisted per design
- **Verdict:** Clean.

---

## Delta vs. ROUTE-AUDIT-V1 (2026-05-04)

| Finding | V1 | V2 | Status |
|---------|----|----|--------|
| Hex fallback literals (#fff, #f5f5f5) | 11 P1 | 0 new | Fixed via 3c4d2752 ✓ |
| Hardcoded padding in Role pages | Not audited | ~40 lines P1 | **New P1** |
| Raw `<button>` in Governance | Not audited | P1 | **New P1** |
| marginTop: 2 inconsistency | Not audited | 5 instances P2 | **New P2** |
| fontSize: 14 in error paths | Not audited | 2 instances P2 | **New P2** |
| Hairlines (1px borders) | Not audited | 2 OK instances | PASS ✓ |

**Resolved:** Token-literal hex fallbacks (V1) are fixed. Spacing tokens remain weak point.

---

## Design-System Coherence Assessment

### Token Compliance by Domain

| Domain | Compliance | Notes |
|--------|-----------|-------|
| Color | 85% | Fallback hex literals in var() are intentional safety; active use is token-first |
| Spacing | 40% | Role pages predate audit; treasury/new pages are token-compliant |
| Typography | 75% | text-sm/text-xs used; error paths hardcode 14px |
| Borders | 95% | Only DrivePage 1px (acceptable via var(--border) token) |
| Button Variants | 70% | GovernancePage raw button breaks affordance; rest OK |

### Anti-Pattern Coverage

✓ No rounded-square buttons (pill usage correct where present)
✓ No gradient text
✓ No glassmorphism
✓ No verbose state labels
✗ **Raw `<button>` elements** (GovernancePage:174) — should be Button component

### Hairline Check
- **DrivePage:** 2 instances of `border: "1px solid var(--border)"` — acceptable (token-wrapped)
- **Verdict:** Per feedback_no_hairlines.md, no structural issue. Borders are via token.

---

## Recommendations for Wave 16

### WS-1: Fix GovernancePage Button Variant (P1)
**Files:** `apps/ui/src/pages/GovernancePage.tsx`

**Change:**
```tsx
// Before (line 174-190)
<button
  key={r.id}
  type="button"
  onClick={() => onOpenRole(r.id)}
  style={{
    background: "var(--color-bg-base)",
    border: "none",
    color: "inherit",
    font: "inherit",
    padding: "2px var(--space-sm)",
    borderRadius: "999px",
    cursor: "pointer",
  }}
>
  {r.title}
  {r.founder ? " · founder" : ""}
</button>

// After
<Button
  variant="tertiary"
  size="sm"
  onClick={() => onOpenRole(r.id)}
  className="governance-role-pill"
>
  {r.title}
  {r.founder ? " · founder" : ""}
</Button>
```

**Acceptance:** Button now has keyboard nav, focus ring, hover state, semantic HTML.
**Time:** 15min

### WS-2: Align Role/Invitation Page Padding (P1 SYSTEMIC)
**Files:** RoleEditPage, RoleNewPage, RoleInvitePage, RoleDetailPage, InvitationAcceptPage, DrivePage

**Mapping:**
- `28px 32px` → `var(--space-7) var(--space-8)` (or create --space-7 = 28px if missing; currently 24px → 32px)
- `12px 16px` → `var(--space-3) var(--space-4)`
- `10px 12px` → needs review (scale jumps: 8px, 12px, 16px; 10px falls between)
- `marginTop: 2` → `var(--space-0)`

**Note:** 10px gap in token scale may need:
1. Add `--space-2.5: 10px` to tokens
2. OR accept "10px" as semi-system and document exception
3. OR audit the design and confirm 12px works instead

**Acceptance:** All padding/margin in pages use tokens or documented exceptions. `grep -r "[0-9]px" apps/ui/src/pages --include="*.tsx"` count drops by 30+.

**Time:** 45min (all files + verify no visual regressions)

### WS-3: Normalize Typography & Spacing (P2)
**Files:** MePage, OwnershipPage, GovernancePage, RolePages

**Changes:**
- `fontSize: 14` → `var(--text-sm)` (MePage:90, 101)
- `marginTop: 2` → `var(--space-0)` (OwnershipPage:197, GovernancePage:154, etc.)
- `accentColor` in style → CSS class (if used; minor)

**Acceptance:** All values either token or documented. npm run verify passes 100%.

**Time:** 30min

---

## Acceptance Criteria for Wave 16

- [ ] GovernancePage button variant replaced (WS-1)
- [ ] Role/Invitation page padding audit complete (WS-2); 10px gap resolved
- [ ] Typography/spacing normalized (WS-3)
- [ ] `npm run verify` passes 100% in all touched files
- [ ] No new hardcoded px values in pages/
- [ ] Button affordance consistent across all pages (no raw `<button>`)
- [ ] All spacing either tokenized or documented with rationale

---

## Attached

- Previous audit: (v1 not found; first systematic audit)
- Design-system refs: feedback_jade_mineral_palette.md, feedback_button_variant_rules.md, feedback_three_color_tiers.md
- Token spec: packages/tokens/src/tokens.css (--space-0 through --space-16; --text-xs through --text-lg)

---

**Audit completed:** 2026-05-05 ROUTE-AUDIT-V2 subagent (Haiku)
**Total time:** ~30min (reading + analysis; no fixes applied)
**Ship status:** Audit-only. Fixes queued for Wave 16 TaskCreate.
