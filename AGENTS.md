# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Architecture

`Octopus Cosy Manager` is a client-side JavaScript web app for reading and managing Octopus Cosy 6 heat pumps via GraphQL.

### Core Structure
- **`index.html`**: Native HTML dashboard and UI view containers.
- **`js/app.js`**: UI logic, view orchestration, and dashboard rendering.
  - **Live Auto-Refresh**: Uses `setInterval` (5s) to update `#live-performance-container` when the dashboard is visible.
  - **Lifecycle**: `showDashboard()` starts the refresh; `hideAllViews()` stops it.
- **`js/octopus.js`**: GraphQL client using two endpoints:
  - `api.octopus.energy/v1/graphql/` — auth only (`obtainKrakenToken`)
  - `api.backend.octopus.energy/v1/graphql` — all heat pump queries and mutations
  - Maps API `SettingActions` (`SET_TEMPERATURE`/`TURN_OFF`) to UI modes (`"HEAT"`/`"OFF"`).
  - Handles JWT authentication and auto-discovery of EUIDs.
- **`css/style.css`**: Styling framework.

## Key Behaviors & Conventions

- **No Backend**: The app is entirely client-side. All credentials must be stored in `localStorage`.
- **Vanilla implementation**: No external dependencies or build steps. Use ES6 modules.
- **Dashboard Mapping**: Detailed payload includes SCOP, Weather Compensation, Hardware Versions, and Flow Temperature limits.
- **Zone Telemetry**: Merges active sensor data (ADC/Zigbee) and heat demand states into configuration views.

## API Requirements

- **Auth**: JWT obtained via `obtainKrakenToken(input: { APIKey: $apiKey })`.
- **Days bitmask**: 7-character string (e.g., `"1111100"` for Mon–Fri).
- **Mutations**: Supports schedule updates, quick overrides, flow temp configuration, quieter mode, and controller reboots.
- **Schema**: Schema introspection is public.
