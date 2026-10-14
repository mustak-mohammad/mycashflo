
# myCashflo

> AI-powered accounts receivable and collections platform.

## Applications

| App | Technology | Default Port |
|---|---|---|
| `apps/web` | React + Vite + TypeScript + Tailwind CSS | 5173 |
| `apps/mobile` | Flutter + Dart (Phase 4) | — |
| `services/api` | NestJS + PostgreSQL + Prisma | 3000 |
| `services/voice-agent` | Python + LiveKit (Phase 5) | — |

## Quick Start

### Step 1 — Clone and install deps

```powershell
# From the repo root
cd services/api && npm install
cd ../../apps/web && npm install
```

### Step 2 — Configure the API

```powershell
cd services/api
Copy-Item .env.example .env
# Edit .env: fill in DATABASE_URL and JWT secrets
# See docs/DECISIONS.md for PostgreSQL setup on Windows
```

### Step 3 — Run in development

```powershell
# Terminal 1 — NestJS API
cd services/api
npm run start:dev
# API: http://localhost:3000/api
# Swagger: http://localhost:3000/api/docs
# Health: http://localhost:3000/api/health

# Terminal 2 — React Web App
cd apps/web
npm run dev
# Web: http://localhost:5173
```

> **Note:** Phase 2 database setup (PostgreSQL + Prisma migration) is required before the API can serve real data.
> Until then, the web app runs in demo mode with clearly labelled seed data.

## Project Status

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phase-by-phase status.

| Phase | Status |
|---|---|
| Phase 0 — Repository Inspection | ✅ Complete |
| Phase 1 — Project Foundation | ✅ Complete |
| Phase 2 — Database and Backend | 🔜 Pending (needs PostgreSQL) |
| Phase 3 — Web App + Backend Connection | 🔜 Pending |
| Phase 4 — Flutter Mobile App | 🔜 Pending (needs Flutter SDK) |
| Phase 5 — Chotu AI Voice Prototype | 🔜 Pending (needs LiveKit + AI key) |
| Phase 6 — Collections Intelligence | 🔜 Pending |
| Phase 7 — Integrations | 🔜 Pending |
| Phase 8 — Final Verification | 🔜 Pending |

## Prerequisites

| Tool | Required for | Install link |
|---|---|---|
| Node.js 20+ | API and Web | https://nodejs.org |
| PostgreSQL 15+ | Phase 2 | https://postgresql.org/download/windows |
| Flutter SDK 3.x | Phase 4 | https://flutter.dev/docs/get-started/install/windows |
| Python 3.10+ | Phase 5 | https://python.org/downloads |
| LiveKit account | Phase 5 | https://cloud.livekit.io (free tier) |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Technical Decisions](docs/DECISIONS.md)

## Security

- Never commit `.env` files, API keys, credentials, or private signing keys.
- The `.gitignore` excludes all `.env` files (except `.env.example`).
- All tenant data is isolated at the database query level.
- Voice tokens are issued server-side and expire after a short window.
