# Octopus Cosy Manager

A secure, client-side web application to monitor and manage your **Octopus Cosy 6 heat pump** directly via the Octopus Energy GraphQL API.

## Features

- **Auto-Discovery Setup** — Enter your Octopus API Key to automatically discover associated accounts and Heat Pump EUIDs.
- **Real-Time Dashboard** — **Auto-refreshing (5s)** live metrics including COP, Power Input, Heat Output, and Outdoor Temperature.
- **Advanced System Control**:
  - **Zone Management**: View real-time sensor data (temp, humidity, voltage) and active heat demand.
  - **Schedule Editor**: Modify weekly schedules for Heating, Hot Water, and Auxiliary zones.
  - **Quick Overrides**: Apply temporary mode, setpoint, or action overrides with optional end times.
  - **System Configuration**: Toggle Quieter Mode, reboot the controller, and configure Flow Temperature (Fixed or Weather Compensation).
- **Performance History** — View daily performance metrics (COP, Energy In/Out) for the last 14 days.
- **Privacy & Security** — Runs entirely in your browser. API keys are stored in `localStorage` and only communicate with official Octopus Energy endpoints.

## Setup & Deployment

### Running Locally
Serve the root directory with any static file server:
```bash
# Python
python3 -m http.server 8000
# Node.js
npx http-server
```

### GitHub Pages
This repository is optimized for GitHub Pages. Simply point the deployment source to the `/(root)` folder in your repository settings.

## Project Structure
- `index.html` — Main UI and dashboard templates.
- `js/app.js` — UI logic, state management, and auto-refresh orchestration.
- `js/octopus.js` — Octopus Energy GraphQL API client.
- `css/style.css` — Styling and layout.

---
*Disclaimer: This project is not affiliated with or endorsed by Octopus Energy. Use at your own risk.*
