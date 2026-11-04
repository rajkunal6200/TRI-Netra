# Trinetra

Trinetra is a browser based surveillance dashboard with deterministic simulation scenarios, local face detection, optional Gemini analysis, incident logging, and phone camera streaming.

## Requirements

- Node.js 20 or newer
- npm
- A modern browser with camera permissions for webcam use

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Open the URL printed by the server (normally `http://localhost:3000`). Simulation scenarios and incident management work without a Gemini key. For live AI analysis, add a valid `GEMINI_API_KEY` to `.env`; without one, live feeds use the bundled local face detector and unmatched faces are marked for manual review.

## Project structure

```text
frontend/             React application and Vite entry page
  src/                Components, screens, data, and browser utilities
backend/              Express API and server-side services
  index.ts            Application server entrypoint
  models/             Local face and hand detection models
  scripts/            Camera and maintenance scripts
  services/           Server-side face analysis
  .local/             Private runtime history and admin sessions
shared/               Types and utilities used by both sides
dist/                 Generated production build
```

The development admin login is `admin` / `admin123`. Change that password in the Admin dialog before using the app outside a local development session.

## Production build

Set a unique `ADMIN_PASSWORD` (at least 8 characters) in the production environment. Optionally set `GEMINI_API_KEY` for Gemini analysis, then run:

```sh
npm run build
npm start
```

The server listens on port `3000` by default; set `PORT` to change it. The first successful admin password change is stored as a salted hash in `backend/.local/admin-password.json`. Keep that file private and back it up with the deployment configuration.

Authorized-person location sightings and daily camera transitions are saved in `backend/.local/tracking.json` so history survives server restarts. Keep this file private; set `TRINETRA_TRACKING_FILE` to choose a different storage path.

The authorized personnel directory and enrolled face templates are saved in `backend/.local/personnel.json`. New registrations, directory edits, and removals are synchronized to this file and restored when the server starts. Keep it private; set `TRINETRA_PERSONNEL_FILE` to choose a different storage path.

Biometric-breach and identity-review incidents are saved in `backend/.local/unauthorized-incidents.json`, with photos in the adjacent `unauthorized-evidence/` directory. The app does not expire incidents or photos by age or count; records are removed only by an explicit incident delete or **Clear Logs** action. Keep this data directory on persistent storage; set `TRINETRA_UNAUTHORIZED_INCIDENTS_FILE` to choose a different database file.

## Camera sources

- **Simulation:** Runs the bundled scenarios without a camera or API key.
- **Webcam:** Requires a browser camera permission. Browsers generally allow camera access on `localhost` or an HTTPS origin.
- **Upload:** Accepts JPG and PNG snapshots up to 10 MB.
- **Phone stream:** Open the pairing link on the phone and grant camera permission. Non-local deployments need HTTPS for browser camera access.
- **IP stream:** Configure a direct image or snapshot URL supported by the camera. Video stream formats vary by camera vendor.
- **Bluetooth:** Browser Bluetooth provides device metadata, not camera video. Connect an image source separately to analyze frames.

Lockdown mode, sirens, incident logs, and dispatch requests are local dashboard actions. This app does not control physical access systems or contact an external response team.
