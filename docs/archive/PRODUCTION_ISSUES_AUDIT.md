# Production Issues Audit (Read-Only)

**Date:** 2025-12-27  
**Status:** READ-ONLY - No code changes made

---

## Issue A: Routing + /app Crash

### Root Cause
The `/app` route is defined in React Router, but nginx (serving the static build) doesn't have SPA fallback configuration. When a user directly navigates to `https://blossomv2.fly.dev/app`, nginx tries to serve `/app/index.html` (which doesn't exist) instead of falling back to `/index.html` and letting React Router handle the route.

### Evidence
- **Route Definition:** `src/routes/AppRouter.tsx:8-9`
  ```tsx
  <Route path="/" element={<LandingPage />} />
  <Route path="/app" element={<BlossomAppShell />} />
  ```
- **Router Setup:** `src/main.tsx:19-21` - Uses `BrowserRouter` (no basename)
- **Dockerfile:** `Dockerfile:38-45` - Uses nginx but no custom config
- **Missing Config:** No `nginx.conf` file exists in the repo

### Minimal Fix Options

**Option 1 (Recommended - Simplest):** Add nginx SPA fallback configuration
- **File:** Create `nginx.conf` at repo root
- **Content:**
  ```nginx
  server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
  ```
- **Update Dockerfile:** `Dockerfile:38-45` - Add `COPY nginx.conf /etc/nginx/conf.d/default.conf` before `EXPOSE 80`
- **Risk:** Low - Standard SPA pattern, no behavior change

**Option 2:** Client-side redirect in AppRouter
- **File:** `src/routes/AppRouter.tsx:5-12`
- **Change:** Add `<Navigate from="/app" to="/" replace />` or use `useEffect` to redirect
- **Risk:** Medium - Changes user-visible URL, may break bookmarks

**Option 3:** Add basename to BrowserRouter
- **File:** `src/main.tsx:19`
- **Change:** `<BrowserRouter basename="/app">` and update all routes
- **Risk:** High - Requires updating all route references, breaks `/` route

### Recommended Fix
**Option 1** - Add nginx.conf with `try_files` fallback. This is the standard solution for SPAs and requires no code changes.

---

## Issue B: Chat Bar Cut-Off / Layout Responsiveness

### Root Cause
Multiple viewport height issues compound on mobile devices:
1. `h-screen` uses `100vh` which doesn't account for mobile browser UI (address bar, toolbars)
2. `calc(100vh - 160px)` breaks when viewport height changes (browser UI show/hide)
3. No safe-area-inset padding for iOS notches/home indicators
4. Fixed footer input area has no bottom padding for safe areas

### Evidence
- **Root Container:** `src/layouts/BlossomAppShell.tsx:6`
  ```tsx
  <div className="h-screen w-screen overflow-hidden bg-slate-50">
  ```
  - Uses `h-screen` (100vh) - doesn't account for mobile browser UI

- **Chat Container:** `src/components/CopilotLayout.tsx:258`
  ```tsx
  <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" style={{ minHeight: 'calc(100vh - 160px)' }}>
  ```
  - Uses `calc(100vh - 160px)` - breaks when viewport height changes dynamically

- **Chat Component:** `src/components/Chat.tsx:2493`
  ```tsx
  <div className="flex flex-col h-full min-h-0 overflow-hidden relative">
  ```
  - Relies on parent height, which is based on broken calc

- **Input Footer:** `src/components/Chat.tsx:2654`
  ```tsx
  <div className="flex-shrink-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
  ```
  - No `pb-safe` or `padding-bottom` for safe-area-inset

- **No Safe-Area Usage:** No `env(safe-area-inset-*)` CSS variables found in codebase

### Minimal Fix Plan

**Fix 1: Replace 100vh with 100dvh (Dynamic Viewport Height)**
- **File:** `src/layouts/BlossomAppShell.tsx:6`
- **Change:** `h-screen` → `h-[100dvh]` (or add custom class)
- **Rationale:** `100dvh` accounts for mobile browser UI changes

**Fix 2: Remove calc() from inline style, use flexbox**
- **File:** `src/components/CopilotLayout.tsx:258`
- **Change:** Remove `style={{ minHeight: 'calc(100vh - 160px)' }}` - flexbox `flex-1` already handles this
- **Rationale:** The parent already uses flexbox, calc is redundant and breaks on mobile

**Fix 3: Add safe-area padding to input footer**
- **File:** `src/components/Chat.tsx:2654`
- **Change:** Add `pb-[env(safe-area-inset-bottom,0px)]` or `pb-safe` (if Tailwind safe-area plugin exists)
- **Rationale:** Prevents input from being hidden behind iOS home indicator

**Fix 4 (Optional): Add safe-area to root container**
- **File:** `src/layouts/BlossomAppShell.tsx:6`
- **Change:** Add `pt-[env(safe-area-inset-top,0px)]` if needed for notches

### Recommended Implementation Order
1. Fix 2 (remove calc) - Lowest risk, immediate improvement
2. Fix 1 (100dvh) - Standard modern solution
3. Fix 3 (safe-area padding) - iOS-specific but important

---

## Issue C: Guided Tour Skipping Step 2

### Root Cause
Step 2 of the onboarding tour targets `[data-coachmark="quick-actions"]`, but this attribute doesn't exist on any element. When the target selector isn't found, the tour automatically skips to the next step (line 58-61 in OnboardingCoachmarks.tsx).

### Evidence
- **Step 2 Definition:** `src/components/OnboardingCoachmarks.tsx:20-26`
  ```tsx
  {
    id: 'quick-actions',
    targetSelector: '[data-coachmark="quick-actions"]',
    title: 'Quick Actions',
    description: 'Start with suggested prompts or save your own favorites',
    position: 'top',
  },
  ```

- **Auto-Skip Logic:** `src/components/OnboardingCoachmarks.tsx:56-61`
  ```tsx
  const target = document.querySelector(coachmark.targetSelector) as HTMLElement;
  
  if (!target) {
    // Target not found, skip to next
    setCurrentStep(prev => prev + 1);
    return;
  }
  ```

- **Missing Attribute:** `src/components/Chat.tsx:2660` - The "Quick actions" button exists but has NO `data-coachmark` attribute:
  ```tsx
  <button
    type="button"
    onClick={() => setShowQuickStart(v => !v)}
    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-pink-50 transition-colors"
  >
    <span>Quick actions</span>
  ```

- **Existing Attributes Found:**
  - `src/components/CopilotLayout.tsx:144` - `data-coachmark="execution-mode"` ✅
  - `src/components/RightPanel.tsx:324` - `data-coachmark="positions-editor"` ✅
  - **Missing:** `data-coachmark="quick-actions"` ❌

### Additional Issues
- **Backdrop Click Advances:** `src/components/OnboardingCoachmarks.tsx:128` - Clicking backdrop calls `handleNext()`, which may cause rapid advancement if user accidentally clicks
- **No Delay Between Steps:** Steps advance immediately when target is found (100ms timeout is for DOM readiness, not user reading time)

### Minimal Fix Plan

**Fix 1: Add missing data-coachmark attribute (Required)**
- **File:** `src/components/Chat.tsx:2660`
- **Change:** Add `data-coachmark="quick-actions"` to the button element
- **Line:** After `type="button"` or in className string
- **Rationale:** Makes step 2 target findable

**Fix 2 (Optional): Prevent backdrop click from auto-advancing**
- **File:** `src/components/OnboardingCoachmarks.tsx:128`
- **Change:** Remove `onClick={handleNext}` from backdrop, or add confirmation
- **Rationale:** Prevents accidental step skipping

**Fix 3 (Optional): Add minimum display time per step**
- **File:** `src/components/OnboardingCoachmarks.tsx:55-96`
- **Change:** Add a minimum 2-3 second delay before allowing `handleNext()` to work
- **Rationale:** Ensures users have time to read each step

### Recommended Implementation
**Fix 1 is required** - Without it, step 2 will always be skipped. Fixes 2 and 3 are UX improvements but not blockers.

---

## Patch Scope Summary

### Files Requiring Changes

1. **nginx.conf** (NEW FILE)
   - Create nginx configuration for SPA fallback
   - ~10 lines

2. **Dockerfile** (MODIFY)
   - Add COPY command for nginx.conf
   - Line ~41 (after COPY dist, before EXPOSE)

3. **src/layouts/BlossomAppShell.tsx** (MODIFY)
   - Line 6: Change `h-screen` to `h-[100dvh]`
   - ~1 line change

4. **src/components/CopilotLayout.tsx** (MODIFY)
   - Line 258: Remove `style={{ minHeight: 'calc(100vh - 160px)' }}`
   - ~1 line change

5. **src/components/Chat.tsx** (MODIFY)
   - Line 2654: Add `pb-[env(safe-area-inset-bottom,0px)]` to input footer div
   - Line 2660: Add `data-coachmark="quick-actions"` to Quick actions button
   - ~2 line changes

6. **src/components/OnboardingCoachmarks.tsx** (OPTIONAL - UX improvement)
   - Line 128: Consider removing or guarding backdrop onClick
   - ~1 line change (optional)

**Total:** 5 files (4 required, 1 optional), ~15 lines changed + 1 new file

---

## Manual QA Checklist

### A) Routing + /app Fix
- [ ] Visit `https://blossomv2.fly.dev/app` directly (hard refresh)
- [ ] App loads without blank screen or 404
- [ ] React Router handles route correctly (shows BlossomAppShell)
- [ ] Browser back/forward buttons work
- [ ] Deep links to `/app` work when shared

### B) Chat Bar Cut-Off Fix
- [ ] Test on iOS Safari (iPhone 12+ with notch)
- [ ] Test on Android Chrome (with address bar)
- [ ] Chat input is fully visible and not cut off
- [ ] Input area has proper padding at bottom (no overlap with home indicator)
- [ ] Scrolling works smoothly when keyboard appears/disappears
- [ ] No horizontal scrolling or overflow issues
- [ ] Test in landscape orientation

### C) Guided Tour Fix
- [ ] Clear localStorage: `localStorage.removeItem('blossom.onboardingSeen')`
- [ ] Refresh page - tour should start automatically
- [ ] Step 1 (Execution Mode) appears and is targetable
- [ ] Step 2 (Quick Actions) appears and is targetable (NOT skipped)
- [ ] Step 3 (Positions Editor) appears and is targetable
- [ ] Clicking "Next" advances through all 3 steps sequentially
- [ ] "Don't show again" checkbox works and persists
- [ ] Tour doesn't auto-advance too quickly

### Cross-Platform Testing
- [ ] Desktop (Chrome, Firefox, Safari)
- [ ] Mobile iOS (Safari)
- [ ] Mobile Android (Chrome)
- [ ] Tablet (iPad, Android tablet)

---

## Risk Assessment

### Low Risk
- nginx.conf addition (standard SPA pattern)
- Adding data-coachmark attribute (presentation-only)
- Removing calc() from inline style (flexbox already handles it)

### Medium Risk
- Changing `h-screen` to `h-[100dvh]` (may need browser fallback for older browsers)
- Safe-area-inset padding (iOS-specific, may need fallback)

### Mitigation
- Test on multiple devices before production deploy
- Keep `h-screen` as fallback: `h-[100dvh] h-screen` (Tailwind supports this)
- Use CSS custom properties with fallbacks for safe-area

---

## Notes

- All fixes are minimal and surgical - no refactoring or UI redesign
- No changes to routing logic, session handling, or strategy state
- All fixes are presentation/layout only (except nginx config)
- The nginx fix is server-side and requires a redeploy to Fly.io


