# 08 — Motion & Interaction

> Goal: the app should feel like a native iOS app — fluid, physical, interruptible, connected. Every navigation, tap, sheet, list and scroll has motion that explains *where things come from and go to*. And it must stay 60 fps on a ₹8k Android.
> All motion lives in `packages/ui/motion`. Components import presets; **no ad-hoc durations or easings** anywhere else (lint rule bans numeric `transition` literals outside `packages/ui/motion`).

## 1. Principles
1. **Physical, not decorative** — springs with zero/low bounce for navigation; bounce only for celebration moments (success, Ameen).
2. **Interruptible** — every animation can be grabbed or reversed mid-flight and continues from current position/velocity (Motion springs + MotionValues).
3. **Connected** — elements travel between screens where possible (shared elements, tab indicators, sliding highlights); things never just "appear".
4. **Fast** — navigation completes visually in ≤ 400 ms; taps respond within 1 frame (pressed state on `pointerdown`).
5. **Cheap** — animate only `transform` and `opacity` (and `clip-path`/SVG `pathLength` for small elements). Never animate `width/height/top/left/margin/box-shadow/filter: blur` on large elements.
6. **Respectful** — `prefers-reduced-motion` and a "lite motion" mode for low-end devices are first-class.

## 2. Tokens (`packages/ui/motion/tokens.ts`)
Motion spring API with `visualDuration` + `bounce` (closest to SwiftUI's `response`/`dampingFraction`). Verify current Motion API names in Phase 0.

| Token | Definition | Use |
|---|---|---|
| `spring.snappy` | `{ type:'spring', visualDuration:0.25, bounce:0 }` | press feedback, toggles, chips, tab indicator, small state changes |
| `spring.smooth` | `{ type:'spring', visualDuration:0.38, bounce:0 }` | stack push/pop, sheets, modals, segmented thumb |
| `spring.gentle` | `{ type:'spring', visualDuration:0.55, bounce:0 }` | shared-element morphs, progress bars, large layout changes |
| `spring.bouncy` | `{ type:'spring', visualDuration:0.45, bounce:0.28 }` | success check, Ameen, follow confirmation, FAB release |
| `tween.fade` | `{ duration:0.18, ease:[0.2,0,0,1] }` | crossfades, reduced-motion replacement |
| `tween.quick` | `{ duration:0.12, ease:'easeOut' }` | tab content swap, tooltip |
| `css.ios` | `cubic-bezier(0.32, 0.72, 0, 1)` 400ms | CSS-only transitions (banners, skeleton→content) |
| `stagger.list` | 30 ms per item, max 8 items, then 0 | first-load list entrance |
| `press.scale` | buttons 0.96, cards/rows 0.98, FAB 0.92 | pressed state |
| `gesture.edgeWidth` | 24 px | swipe-back hit area |
| `gesture.dismissVelocity` | 500 px/s | swipe/drag commit threshold |
| `gesture.dismissDistance` | 35% of width/height | commit threshold |

## 3. Navigation system (custom stack navigator on top of TanStack Router)
Implement `StackNavigator` in `apps/app/src/app/navigation` (shared with admin via `packages/ui/navigation`):
- Each tab owns a stack of screens; screens are keyed by route match; the previous screen stays mounted (`inert`, `aria-hidden`) beneath the top screen during and after transitions (max depth kept mounted: 3; deeper ones unmount and restore scroll position from cache).
- Integrates with browser history: push = `history.push`; Android hardware back / browser back → pop animation. If a `popstate` arrives while no gesture is active and the platform already animated (iOS standalone native swipe), skip our animation to avoid double motion.

### 3.1 Push / pop (iOS style)
| Element | Push (A → B) | Pop (B → A) |
|---|---|---|
| Incoming/top screen B | `x: 100% → 0` (`spring.smooth`), soft left-edge shadow | `x: 0 → 100%` |
| Underlying screen A | `x: 0 → -28%`, dim overlay `opacity 0 → 0.06` | `x: -28% → 0`, dim `→ 0` |
| Nav bar title | B title fades in + slides from `x: 30%`; A title fades out + slides to `x: -30%` | reverse |
RTL (Urdu): all x values mirrored (push from the left).

### 3.2 Interactive swipe-back
- Pointer down within `edgeWidth` of the leading edge on a pushed screen → screen follows the finger 1:1 (MotionValue), A's parallax and dim are derived from progress.
- Release: commit if velocity > `dismissVelocity` or progress > `dismissDistance`, else spring back; uses release velocity.
- Disabled when the screen has a horizontal scroller under the finger, a video scrubber, or a sheet is open.
- iOS standalone: test whether the OS provides its own back swipe; if yes, disable ours (record result in DECISIONS during Phase 0).

### 3.3 Tabs
- Tab switch: content crossfade `tween.quick` (no slide — native tab bars don't slide). Each tab keeps its stack and scroll position.
- Active tab icon: outline → fill crossfade + `scale 0.9 → 1` (`spring.snappy`); label color transition.
- Re-tap active tab: pop to root with pop animation, then smooth-scroll to top.
- **ScanFab**: press `scale 0.92`, release `spring.bouncy`; opens Scan modal (3.4).

### 3.4 Modals (Scan, Qibla, full-screen viewers)
- Present: modal `y: 100% → 0` (`spring.smooth`); underlying app `scale 1 → 0.94`, `border-radius 0 → 16px` (via clip on a wrapper), dim overlay `→ 0.3` (**disabled in lite motion**).
- Dismiss: drag down from the top 120px or the grabber; rubber-band resistance when dragging up; commit by velocity/distance; reverse animation.

### 3.5 Shared elements (progressive enhancement)
- Masjid card thumb/tile (Home, My Masjids) → Masjid Detail hero; Campaign card cover → Campaign hero; Video thumbnail → player.
- Implement with Motion `layoutId` across the stack transition (outgoing screen remains mounted during push). Morph uses `spring.gentle`; the rest of the incoming screen fades/slides with `spring.smooth`.
- If the source element is off-screen or lite motion is on → normal push.
- Must not cause layout thrash: measure once, animate transforms only. Verify on the throttled perf test (§8).

### 3.6 Deep link / cold start
- App launch: splash (manifest background `#F8F8F5`, icon) → shell fades in `tween.fade` with Home content staggered (first launch of session only).

## 4. Scroll
- **Large title collapse** (Home, My Masjids, Updates, Settings): scroll-linked via `useScroll` on the screen container: large title `scale 1 → 0.85` + `opacity 1 → 0` over 0–44px; inline title fades in from 30–56px; hairline under nav bar fades in; nav bar background goes from transparent canvas to surface with `e2` shadow. No JS work on every scroll frame beyond MotionValue transforms.
- **Hero parallax** (Masjid Detail, Campaign): hero `y = scroll * 0.4`, `scale` 1.0 → 1.15 on overscroll (pull-down), scrim strengthens as the sheet covers the hero; inline nav title (masjid name) fades in when hero is ~80% hidden.
- **Overscroll**: `overscroll-behavior-y: contain` on screen scrollers (prevents browser pull-to-refresh/navigation); custom **pull-to-refresh**: content translates with rubber-band (`distance^0.7`), mint circle with spinner reveals and rotates proportional to pull; release past 72px → haptic + refresh; spinner keeps spinning until data settles, then content springs back.
- Momentum scrolling is native (never JS-scroll lists).
- Horizontal carousels (Home masjid cards, chips): CSS `scroll-snap` with native momentum; pagination dots follow `scrollLeft` (active dot width 6 → 18 px via `scaleX` on a pill).
- Long lists (Updates > 50 items): TanStack Virtual; entrance animations disabled for virtualized rows except first load.

## 5. Component & interaction specs

### 5.1 Press feedback (everything tappable)
`pointerdown` → scale to `press.scale` + background darken (CSS var) with `spring.snappy`; `pointerup/cancel` → back. Cancel on scroll start (≥ 8 px movement). Long-press (500 ms) where supported shows context sheet.

### 5.2 Tabs indicator, segmented control, chips
- UnderlineTabs indicator slides with `layoutId` (`spring.snappy`); tab panels slide horizontally (`x: ±24px` + fade, `tween.quick`) in the direction of the tab change (mirrored in RTL). Panels also swipeable horizontally (drag with resistance at ends).
- SegmentedControl thumb slides (`spring.smooth`), text colors crossfade.
- ChipGroup: active fill crossfades; the active chip scrolls into view smoothly; list below re-sorts with `AnimatePresence` + `layout` on items (`spring.smooth`), removed items fade/scale 0.98, new items fade in.

### 5.3 Sheets
- Open: `y: 100% → snap` (`spring.smooth`), backdrop `0 → 1` opacity.
- Drag: follows finger; above top snap → rubber band; release → nearest snap by velocity projection; below threshold → dismiss.
- Content inside sheet that scrolls: dragging down when scrolled to top moves the sheet (scroll-lock handoff).
- Keyboard open (admin forms): sheet lifts with `visualViewport` resize, animated.

### 5.4 Lists & cards
- First load: stagger (`stagger.list`) — `opacity 0 → 1`, `y 8 → 0`. Never on back navigation, refetch, or cached render.
- Skeleton → content: crossfade 200 ms, heights reserved (no layout jump; CLS ≤ 0.05).
- New item arriving (version change while viewing): slides in at top with `layout` push-down of siblings (`spring.smooth`) + brief mint highlight fading over 1.2 s.
- Image load: thumbhash blurred placeholder → real image `opacity 0 → 1` 250 ms (`css.ios`), no scale pop.

### 5.5 Prayer-specific
- **Countdown**: re-render at most once per minute (aligned to minute boundary), digits roll vertically (old digit `y → -100%`, new from `100%`) with `spring.snappy`; under 10 min the text color transitions to primary-700 and a soft pulse dot appears (disabled in reduced motion).
- **PrayerStrip highlight**: when the next prayer changes, the mint highlight slides to the new cell (`layoutId`, `spring.gentle`).
- **Date stepper** (Prayer Timings): table content slides `x: ±40px` + fade in the stepping direction; the date pill text rolls.
- Hijri/Gregorian date change at midnight/Maghrib: crossfade.

### 5.6 Ameen
Tap → button `scale 0.92 → 1.06 → 1` (`spring.bouncy`), hands icon lifts `y -3px` and returns, a mint ripple expands from the tap point (`scale 0 → 2.4`, opacity `0.35 → 0`, 500 ms), count rolls up by one, button switches to filled "Ameen ✓" state; Android haptic 15 ms. Optimistic; on failure, quietly retries later (count stays).

### 5.7 Donations
- Progress bar fills from 0 to value when it first enters the viewport (`spring.gentle`, IntersectionObserver), from old to new value on update.
- Amount count-up over 700 ms (`easeOut`), tabular digits, Indian grouping preserved at every frame.
- Donate Now press → button morphs to loading spinner (width locked) → toast "Opening your UPI app…" slides from top.
- QR sheet: QR fades/scales in `0.96 → 1` after sheet settles; "Copied" check micro-animation on VPA copy.

### 5.8 Follow / Scan
- Scanner window corner brackets breathe (scale 1 ↔ 1.03, 1.6 s, ease-in-out loop; off in reduced motion); scan line sweeps.
- On detect: brackets snap inward to the QR bounds and turn green (`spring.snappy`) → preview sheet rises.
- Follow success: `SuccessCheck` (circle `pathLength 0 → 1` 350 ms, then check `pathLength 0 → 1` 250 ms, whole icon `spring.bouncy` scale), then push to Masjid Detail.

### 5.9 Qibla compass
- Heading updates arrive at sensor rate; never set React state per event. Pipe into a MotionValue through a low-pass filter (exponential smoothing α≈0.15, configurable) with **shortest-angle** interpolation (handle 359°→0° wrap) and render via `rotate` transform in rAF.
- Alignment within ±3°: ring color transitions to primary-500, glow pulse (opacity 0.4 ↔ 0, 1.2 s), haptic once per entry into the aligned zone (debounced 1.5 s).
- Calibration figure-8 animation: SVG path with a dot moving along it (loop).

### 5.10 Feedback surfaces
- Toast: from top `y: -120% → 0` (`spring.snappy`), auto-dismiss 3 s, swipe up to dismiss.
- Offline banner: height reserved via transform (slides from under the status bar); content below translates with it (not reflow).
- Update-available toast: same as toast, persistent until action.
- Errors in forms: field shake (`x: 0 → -6 → 6 → -3 → 0`, 300 ms) + error text fades in; screen readers notified via `aria-live`.

### 5.11 Onboarding
- Pages swipe horizontally (drag with velocity) with illustration parallax (illustrations move 0.5× page speed).
- Language change: content crossfades 200 ms to hide the LTR↔RTL layout flip.
- Welcome mosque illustration: line draw-in (`pathLength`) 1.2 s once.

### 5.12 Admin app
- Same navigation system. Step flows (Notice, Dua, Campaign, Video): steps slide horizontally with progress dots morphing.
- Publish: button → loading → `SuccessCheck` full-screen moment (0.9 s) with "Published" text, then returns to Home with the relevant tile showing a brief mint pulse.
- Upload progress: circular progress ring animates smoothly between reported values (spring), not jumpy.
- TimeWheel: native momentum + snap to rows; selected row scales 1.0, others 0.92 with opacity falloff (CSS transforms based on scroll position; no per-frame React renders).
- NumberPad: key press scale + ripple; amount text width animates with `layout`.

## 6. Reduced motion & lite motion
**`prefers-reduced-motion: reduce`** (read via Motion's `useReducedMotion` and a CSS media query):
- All translations/scales of screens, sheets, modals → `tween.fade` crossfades.
- No parallax, no shimmer (static skeleton), no count-ups (show final values), no breathing/pulses, no ripple; success check appears without drawing.
- Compass still rotates (functional) but without glow pulse.

**Lite motion** (auto when `navigator.hardwareConcurrency <= 4` **and** (`navigator.deviceMemory <= 3` or unknown) **or** after detecting ≥ 3 dropped-frame bursts in a session; user can't see this switch):
- Disable shared-element morphs, modal background scale, hero parallax scale, list stagger.
- Keep push/pop, sheets, tabs, press feedback (cheap transforms).

## 7. Haptics (`packages/ui/motion/haptics.ts`)
`selection` 8 ms · `impactLight` 12 ms · `success` [15, 40, 15] · `warning` [30, 60, 30]. Android via `navigator.vibrate` (feature-detected). Haptics are independent of reduced motion and are controlled by a Settings toggle "Vibration" (default on). iOS: no-op (the web has no haptics API there).

## 8. Performance verification (required in CI from Phase 2 onward)
- Playwright perf spec runs on Chromium with `CPU throttling 4×` and records a trace for: Home → Masjid Detail push, pop via swipe simulation, tab switch, sheet open/drag/close, Updates scroll (fling), Qibla rotation (synthetic events at 60 Hz).
- Assertions: no long tasks > 50 ms during transitions; frames dropped < 5% (from trace frame events); no layout (`Layout` events) triggered by animation frames except at start.
- Manual: owner checks on a real low-end Android (owner guide).

## 9. Implementation notes
- Use `LazyMotion` with `domAnimation` (and load `domMax` lazily only where `layout`/`layoutId`/drag are needed — the stack navigator chunk).
- Use `m.*` components, `useMotionValue`, `useTransform`, `useSpring`, `animate()`; avoid re-rendering React trees during gestures.
- Set `will-change: transform` only during active transitions/gestures; remove after.
- Promote screens to their own layer during transitions (`transform: translateZ(0)` via motion), and ensure screen roots have `contain: layout paint`.
- Respect safe areas during transitions (no jump of the tab bar).
- Pointer events: use `touch-action: pan-y` on horizontally-draggable areas, `pan-x` on vertical sheets' handles; avoid passive listener warnings.
