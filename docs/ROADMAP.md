# myCashflo — Development Roadmap

_Last updated: October 2026_

## Phase 0 — Repository Inspection ✅
- Inspected all existing files and Git status
- Confirmed Node v24 / npm 11 / Git 2.50 available
- Flutter and Python not in PATH (documented below)
- All app directories were empty — safe to scaffold

## Phase 1 — Project Foundation ✅
- NestJS API scaffolded in `services/api`
  - Dependencies: @nestjs/config, jwt, passport, swagger, bcrypt, prisma, class-validator
  - `main.ts`: Swagger at `/api/docs`, CORS, global ValidationPipe
  - `app.module.ts`: ConfigModule configured
  - Health check at `GET /api/health`
  - Prisma schema skeleton (Tenant, User)
  - `.env.example` with all required variables documented
- React/Vite web app scaffolded in `apps/web`
  - Tailwind CSS, React Router v6, TanStack Query v5, React Hook Form + Zod, axios
  - 11 pages: Login, Dashboard, Customers, Invoices, Collections, Payments, Chotu AI, Call History, Follow-Ups, Reports, Settings
  - Collapsible sidebar layout, auth context with localStorage persistence
  - RequireAuth route guard, Axios interceptors with 401 redirect
  - All pages have clear "🔧 Demo data" labels where real data is missing
- Shared types in `packages/shared-types`
- Docs: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`

## Phase 2 — Database and Backend 🔜
**Requires: PostgreSQL instance**

- Full Prisma schema: Customer, Invoice, Payment, CollectionCase, FollowUpTask, CallSession, PaymentPromise, Notification, AuditLog
- Initial migration
- Auth module: login, JWT, refresh tokens, bcrypt password hashing
- Tenant-aware guards for all protected routes
- Customer CRUD endpoints
- Invoice CRUD endpoints
- Dashboard metrics endpoint
- Seed data with realistic demo records
- Unit tests

## Phase 3 — Web App + Backend Connection 🔜
- Connect all pages to real REST endpoints
- Remove demo data labels when real data flows
- Add pagination, filtering, and search
- Charts and analytics in Reports page

## Phase 4 — Flutter Mobile App 🔜
**Requires: Flutter SDK installed (see below)**

- Flutter app in `apps/mobile`
- GoRouter navigation
- All screens: Login, Dashboard, Customers, Invoices, AI Voice, Follow-ups
- Secure token storage, Dio HTTP client
- `flutter analyze` and tests

## Phase 5 — Chotu AI Voice Prototype 🔜
**Requires: LiveKit Cloud account (free tier available), AI provider API key**

- Python voice agent in `services/voice-agent`
- LiveKit token endpoint in NestJS (`POST /api/voice/token`)
- Web microphone integration with LiveKit JS SDK
- Flutter microphone integration
- Mock mode for UI development without credentials
- Complete end-to-end voice collection conversation demo

## Phase 6 — Collections Intelligence 🔜
- Backend tools for AI: `get_customer_balance`, `get_overdue_invoices`, etc.
- Call summaries and history
- Confirmation before consequential AI actions
- Tenant-scoped audit logs

## Phase 7 — Integrations 🔜
- Payment link provider adapter (mock implementation first)
- WhatsApp notification adapter (mock implementation first)
- Future SIP telephony architecture documented
- Real outbound calls: DISABLED until explicit approval

## Phase 8 — Final Verification 🔜
- Full test run, security audit, tenant isolation review
- Final docs update with startup commands and status report

---

## Tool Installation Notes

### Flutter (for Phase 4)
Flutter is not currently in PATH. Install from:
https://docs.flutter.dev/get-started/install/windows/mobile

```powershell
# After installing: verify with
flutter --version
flutter doctor
```

### Python (for Phase 5 voice agent)
Python 3.10+ is required. Install from:
https://www.python.org/downloads/ (check "Add Python to PATH" during install)

```powershell
# After installing: verify with
python --version
```

### PostgreSQL (for Phase 2)
See `docs/DECISIONS.md` for full PostgreSQL setup on Windows.
