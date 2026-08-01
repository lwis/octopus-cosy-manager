# Cosy 6 — heat pump control

A client-side web app for watching and controlling an **Octopus Cosy 6 heat pump** through the Octopus Energy GraphQL API.

## What it does

- **Right now** — a live diagram of the plant: outdoor air in, electricity in, heat out to each circuit. The two energy bars share one scale, so efficiency reads as length before it reads as a number. Refreshes every 5 seconds.
- **Circuits** — every enabled zone with its reading, target, mode, and whether it is calling for heat.
- **Flow policy** — the weather-compensation curve, with the pump's live operating point plotted on it. Drag the ends to change the policy; nothing is sent until you press Save. Fixed flow temperature is the same control in a different mode.
- **Zones** — sensor telemetry (temperature, humidity, voltage, signal), the weekly schedule, renaming, and choosing which sensor a zone follows.
- **Overrides** — heat now, boost, off, or back to schedule, with an optional end time.
- **Schedules** — day groups and time slots, edited as a grid.
- **Last 14 days** — daily electricity in, heat out, and efficiency.
- **Quieter mode**, and handing scheduling over to Octopus's optimiser.

Setup discovers accounts and heat pump EUIDs from your API key.

## Privacy

Everything runs in your browser. The API key is stored in `localStorage` and sent only to Octopus Energy endpoints. Fonts are served from this repo, so the page makes no third-party requests.

## Running locally

Serve the root directory with any static file server:

```bash
python3 -m http.server 8000   # or: npx http-server
```

### GitHub Pages

Point the deployment source at the `/(root)` folder.

## Project structure

- `index.html` — page shell and the setup form.
- `js/app.js` — views, rendering, the schematic and the curve, live refresh.
- `js/octopus.js` — Octopus Energy GraphQL client.
- `css/style.css` — design system: tokens, sheets, plates, forms.
- `fonts/` — self-hosted Archivo and IBM Plex Mono (latin subsets).
- `debug/preview.html` — runs the real UI against canned data from `debug/fixture.js`, no API key needed. Routes: `#schedule`, `#override`, `#history`, `#rename`, `#fixed`, `#idle`, `#setup`, `#measure`.

---
*Disclaimer: This project is not affiliated with or endorsed by Octopus Energy. Use at your own risk.*
