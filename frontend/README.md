# Nexus SaaS Frontend (Incremental)

This folder contains a React + Tailwind + Radix(shadcn-style) + Framer Motion frontend that **consumes the existing backend**.

## Goals
- Incrementally evolve UX without breaking the existing production dashboard.
- Keep backend routes + socket events unchanged.

## Run
1. Start backend (port 3000)
2. In this folder:

```sh
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000`.

## Notes
- Phase 1 focuses on replacing prompt/confirm/alert with dialogs & toasts in the legacy dashboard (already done in `public/index.html`).
- This React app is a safe parallel path for the premium dashboard, keeping legacy intact.
