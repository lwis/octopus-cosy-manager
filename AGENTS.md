# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Architecture

`Cosy 6 — heat pump control` is a client-side JavaScript web app for reading and managing Octopus Cosy 6 heat pumps via GraphQL.

### Core Structure
- **`index.html`**: Page shell, setup form, view containers, toast host, and the shared `<dialog>`.
- **`js/app.js`**: Views, rendering, and mutations.
  - **Schematic**: `renderSchematicWide` / `renderSchematicCompact` draw the live SVG diagram. Both energy bars share one kW-per-pixel scale — do not scale them independently.
  - **Curve**: the weather-compensation editor. `curveState` holds `saved` and `draft`; dragging mutates `draft` and paints SVG attributes directly, and only `saveCurve()` calls the API.
  - **Live Auto-Refresh**: `setInterval` (5s) re-renders the schematic only, and leaves the curve alone while it is dirty or being dragged.
  - **Lifecycle**: `showDashboard()` starts the refresh; `hideAllViews()` stops it.
  - **Layout switch**: `isCompact()` (≤720px) selects the compact schematic and curve; a resize listener re-renders when the breakpoint is crossed.
- **`js/octopus.js`**: GraphQL client using two endpoints:
  - `api.octopus.energy/v1/graphql/` — auth only (`obtainKrakenToken`)
  - `api.backend.octopus.energy/v1/graphql` — all heat pump queries and mutations
  - Maps API `SettingActions` (`SET_TEMPERATURE`/`TURN_OFF`) to UI modes (`"HEAT"`/`"OFF"`).
  - Handles JWT authentication and auto-discovery of EUIDs.
- **`css/style.css`**: Design system.
- **`debug/preview.html` + `debug/fixture.js`**: the UI running on canned data. Use it to check rendering without an API key; hash routes jump to each view.

## Design rules

- The page is one plotted sheet: zinc ground with a CSS grid, flat `.sheet` panels, square corners, no shadows.
- Saturated colour means a circuit is moving heat. Circuit colours (`--heat`, `--water`, `--aux`) are set per element through `--circuit`; everything else is ink at an opacity.
- Type: Archivo (variable width, condensed uppercase for names and headings) for text, IBM Plex Mono with tabular figures for every number and label plate.
- Never invent readings the API does not return — the return leg of the loop is drawn unlabelled because the schema has no return temperature.
- Fonts are self-hosted in `fonts/`; do not add third-party requests, the privacy claim depends on it.

## Key Behaviors & Conventions

- **No Backend**: The app is entirely client-side. All credentials must be stored in `localStorage`.
- **Vanilla implementation**: No external dependencies or build steps. Use ES6 modules.
- **Escaping**: interpolate user- or API-supplied strings through `esc()`. Pass codes, not names, into inline handlers.
- **Feedback**: use `toast()`, `confirmAction()`, and `promptForText()`. No `alert`, `confirm`, or `prompt`.
- **Zone Telemetry**: merges active sensor data (ADC/Zigbee) and heat demand states into configuration views.

## API Requirements

- **Auth**: JWT obtained via `obtainKrakenToken(input: { APIKey: $apiKey })`.
- **Days bitmask**: 7-character string (e.g., `"1111100"` for Mon–Fri).
- **Mutations**: schedules, zone modes and overrides, flow temperature configuration, quieter mode, display names, primary sensor, smart control. The schema has no controller reboot mutation.
- **Schema**: introspection is public; a dump lives in `debug/out.json`.
