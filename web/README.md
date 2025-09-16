# RouteForge Web

Single-page React app for creating projects, releases, and routes, plus viewing route hit counts.

## Prereqs
- Node.js 18+ (or 20+ recommended)
- Backend running locally on http://localhost:8000

## Setup
```bash
cd web
npm install
```

## Run dev server
```bash
npm run dev
```
This starts Vite on http://localhost:5173 and proxies API calls to http://localhost:8000.

## Build
```bash
npm run build
npm run preview
```

## End-to-end tests
- Ensure the backend API is running locally (defaults to http://localhost:8000).
- In another terminal, start the web app (`npm run dev`) or point `UI_BASE_URL` to a deployed instance.
- Install Playwright browsers once:
  ```bash
  pnpm exec playwright install
  ```
- Run the happy-path E2E suite (headless by default):
  ```bash
  pnpm run test:e2e
  ```
- Override URLs if needed via env vars like `UI_BASE_URL` and `E2E_TARGET_URL`.

## Features
- Wizard: create project → create release → create route
- Routes table: shows slug, copy button, and live hit count (polls `/api/routes/:id/hits`)
- Minimal styles, error toasts, loading states

## Notes
- Uses only existing backend endpoints; no schema changes required.
- Redirect links point to `/r/{slug}`.

