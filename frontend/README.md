# RateShield Dashboard

React and TypeScript control-plane dashboard.

## Run with Docker Compose

From the repository root, configure `.env` from `.env.example`, then run:

```sh
docker compose up --build -d
```

The dashboard is served at <http://localhost:3000>. Nginx forwards `/api/` to the control plane and `/gateway/` to the gateway, so the built frontend uses same-origin requests.

## Local development

```sh
npm ci
npm run dev
```

The Vite development server listens on port 5173. Its `/api` proxy targets `http://localhost:8081` by default; set `VITE_API_BASE_URL` when the API is elsewhere.

## Checks

```sh
npm run build
npm run lint
```
