# Landscaper Design Doc (Short)

## Goal
Build a web app where a user uploads a top-down yard image and lays out reusable landscape elements by stamping, moving, resizing, and ordering them.

## MVP Scope
- Upload a background image for the plan canvas. This should only support images, and they must be less than 9MB (to be able to store it in localstorage).
- Create/edit element definitions in a right-side panel:
  - `name`
  - `shape` (chosen from a modal of available SVG shapes)
  - `color` (dropdown of starter colors)
  - `scale` (element-level size)
- Stamp elements onto the plan.
- Select and move any stamp.
- Update an element and reflect changes on all stamps of that element.
- Left toolbar tools:
  - Select
  - Undo / Redo
  - Selected-stamp actions: Bring to Front, Send to Back, Resize Element
- Resize behavior:
  - Resize mode shows edge handles on the selected stamp.
  - Dragging handles scales from center.
  - If no stamp exists for the element, create one at canvas center and enter resize mode.
- Zoom in/out editor area with shift + scroll wheel.
- Plan name shown in a small top-left panel; user can edit it.
- Keyboard shortcuts:
  - Undo: `Ctrl/Cmd+Z`
  - Redo: `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y`

## Proposed Tech
- App shell/state: React + TypeScript + Zustand.
- Canvas/editor area: `react-konva` (Konva on HTML5 canvas).
  - Rationale: built-in drag, transform handles, z-ordering, selection patterns, and smooth zoom/pan.
- Optional “fun” effects: small overlay layer (Konva particles or lightweight canvas emitter) for non-critical interactions like save success or stamp drop.

## Data Model (Initial)
- `Plan`
  - `id`, `name`
  - `backgroundImage` (data URL or local file reference)
  - `elements: Element[]`
  - `stamps: Stamp[]`
  - `viewport` (`zoom`, `panX`, `panY`)
- `Element`
  - `id`, `name`, `shapeId`, `color`, `scale`
- `Stamp`
  - `id`, `elementId`, `x`, `y`, `zIndex`
  - Stamp appearance is resolved from its `Element` so element edits propagate automatically.

## Save/Load (Localhost-Only for Now)
- Persistence is local-only while developing on `localhost`.
- Store plans in browser `localStorage` under an app key (for example `landscaper.plans.v1`).
- Support:
  - Create new plan
  - Rename existing plan
  - Save current plan snapshot
  - Load previously saved plan from local storage
- No backend sync/cloud storage in this phase.

## Phased Implementation Plan
1. Phase 1: App shell + state foundation
   - Build base layout (left toolbar, center canvas area, right panel, top-left plan name panel).
   - Set up Zustand store types for plan, elements, stamps, selection, and history scaffolding.
   - Done when UI regions render and state updates can be inspected in dev tools.
2. Phase 2: Background + element management
   - Add background upload/validation (images only, <9MB) and render in canvas.
   - Implement Element Panel and Element Detail Panel (create/edit/delete element with name/shape/color/scale).
   - Done when elements can be managed and persisted in in-memory app state.
3. Phase 3: Stamping + selection + transform basics
   - Implement stamping, selecting, dragging, z-order actions, and resize mode with handles.
   - Implement “create centered stamp if none exists” behavior when resize is requested.
   - Done when a user can place and fully manipulate stamps and element edits propagate to all related stamps.
4. Phase 4: Undo/redo + zoom + shortcuts
   - Implement undo/redo stack for all editing actions.
   - Add keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`) and zoom (`Shift+Scroll`).
   - Done when toolbar and keyboard interactions are behaviorally equivalent.
5. Phase 5: Local persistence + polish
   - Implement save/load/rename using `localStorage` (`landscaper.plans.v1`).
   - Add minimal UX polish (empty states, error toasts, optional lightweight particle feedback).
   - Done when plans survive reload on localhost and core flows are stable.

## Implementation Guardrails
- Keep `Element` as the source of truth for visual attributes (`shapeId`, `color`, `scale`); stamps only reference `elementId` plus placement/layer data.
- Every user-visible mutation (create/edit/delete element, stamp move/resize/order, background change, plan rename) must be an undoable command.
- Use a single canvas coordinate space; store positions/sizes in canvas units, never in screen pixels.
- Apply zoom/pan at the stage/viewport level only, not by rewriting stamp coordinates.
- Keep persistence schema versioned from day one (`landscaper.plans.v1`) so migrations are easy later.
- Prefer pure store actions with small payloads; UI components should dispatch actions, not perform data mutation logic inline.

## MVP Acceptance Checklist
- User can upload an image file under 9MB and see it as the plan background.
- User can create an element with `name`, `shape`, `color`, and `scale`.
- User can stamp that element multiple times and move each stamp independently.
- Editing one element updates all its existing stamps.
- User can select a stamp and run bring-to-front, send-to-back, and resize actions.
- Resize mode supports drag handles and center-based scaling behavior.
- If resize is requested before any stamp exists, the app creates one centered stamp and enters resize mode.
- Undo/redo works from toolbar and keyboard shortcuts.
- Zoom via `Shift+Scroll` works without breaking selection/drag behavior.
- Plan name is visible/editable in the top-left panel.
- Save/load/rename works across page refresh in localhost using local storage only.

## Practical Defaults (Until Real Assets Exist)
- Start with a placeholder shape set (`circle`, `square`, `triangle`, `shrub`) rendered as inline SVG paths.
- Start with a fixed color palette: `Green`, `Dark Green`, `Brown`, `Gray`, `Blue`.
- Include one seeded example element on first load to make the canvas immediately testable.

## Out of Scope (for now)
- Real plant catalog or external APIs.
- Multi-user collaboration.
- Production backend persistence/auth.
