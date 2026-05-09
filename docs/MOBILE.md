# Mobile contract

Mindshift is **desktop-first** and intentionally not a fully mobile-
optimised app. The library + capture flow are mobile-first-class so
users can save things on the go; everything else is a power-user
workspace that earns its complexity at desktop sizes.

## What is first-class on mobile

| Surface | Why |
|---|---|
| Library (browse, filter, search, open card) | Daily-use surface — read summaries, look things up, browse what you saved |
| Tags sidebar (as a drawer) | Tag filtering is core to library navigation |
| Card detail (summary, transcript, notes, in-card chat) | Once you find a card you should be able to consume it |
| `/share-target` PWA flow | Capture from the OS share sheet — the whole reason mobile matters |
| Public profile / tag / card pages | Sharing-out is read-only and naturally fits a phone |

## What gets a "best on desktop" hint

| Page | Reason |
|---|---|
| `/graph` | Force-graph needs canvas space + mouse/trackpad |
| `/chat` (full workspace) | Conversation history sidebar + message thread don't compose on a phone |
| `/review` | Heatmap + session list + answer panel are designed for side-by-side |
| `/podcasts` | Voice picker, script editor, cover art preview need width |

These pages still **render and work** on mobile — we just add a small
amber banner on `<md` viewports with a one-line reason. No redirect,
no functional gating: the user can keep using them if they want.

## Implementation primitives

- Tailwind `md:` breakpoint = 768 px is the cutoff for "phone vs.
  tablet/desktop". Sidebars use `hidden md:flex` (always-on at md+),
  drawers are gated by component-level state under `md:hidden`.
- `@media (hover: none)` in `styles.css` lifts every hidden-on-hover
  affordance to 50% opacity on touch input.
- `<MobileDesktopHint reasonKey="mobileHint.X" />` is the shared
  banner component. New complex pages should add one when their
  feature is desktop-shaped.
- Right-side panes (e.g. library chat pane) use `hidden lg:flex` —
  on phones the inline equivalent (e.g. chat tab inside CardDetail)
  takes over.

## Things we explicitly chose **not** to do

- A reduced "/m/*" mobile-only routing. Users hitting `/graph` from
  a desktop bookmark on their phone shouldn't get a different URL
  scheme; the hint banner is enough.
- Native iOS / Android builds. The PWA solves capture; everything
  else is a desktop product anyway.
- Bottom-sheet replacements for every modal. Existing modals are
  already centered + readable on a phone; rewriting them as sheets
  would be a lot of work for no real win.

## Re-visiting the contract

If a future feature blurs the line (e.g. a quick-quiz mode that
should work on the bus), reopen this doc and decide deliberately —
don't drift into "make everything mobile" by accident.
