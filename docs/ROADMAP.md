# myCashflo — Development Roadmap

_Last updated: October 2026_

## Phase 0 — Repository Inspection ✅
- Inspected all existing files and Git status
- Confirmed Node v24 / npm 11 / Git 2.50 available
- Python 3.14.4 & Flutter 3.47.2 detected and configured
- All app directories mapped and scaffolded

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
- Shared types in `packages/shared-types`
- Docs: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`

## Phase 2 — Database and Backend ✅
- Full Prisma schema migrated to PostgreSQL (Tenant, User, Customer, Invoice, Payment, CollectionCase, FollowUpTask, CallSession, PaymentPromise, Notification, IntegrationConfig, AuditLog)
- Auth module: login, JWT, refresh tokens, bcrypt password hashing
- Tenant-aware guards (`JwtAuthGuard`, `@CurrentUser`) for all protected routes
- Customer CRUD endpoints (`/api/customers`)
- Invoice CRUD endpoints (`/api/invoices`)
- Collections management endpoints (`/api/collections`)
- Payments tracking endpoints (`/api/payments`)
- Reports and ageing analysis (`/api/reports`)
- Follow-up tasks CRUD (`/api/follow-ups`)
- Call session logging (`/api/calls`)
- Voice room token issuance (`/api/voice/token`)
- Dashboard KPI aggregation endpoint (`/api/dashboard`)
- Seed data with realistic multi-tenant demo records (`npm run db:seed`)
- Vitest unit tests and e2e tests passing

## Phase 3 — Web App + Backend Connection ✅
- Connected all pages to live REST endpoints
- Removed demo data labels and wired live DB state
- Added search, status filtering, and pagination across Customers, Invoices, Collections, Payments, Call History, and Follow-ups
- Added interactive Task Modal for creating and toggling follow-up tasks
- Added interactive Chotu AI Voice interface with live room token generation, live transcript simulation, and automatic session logging to Call History
- Verified zero build errors (`npm run build`)

## Phase 4 — Flutter Mobile App ✅
- Scaffolded Flutter app in `apps/mobile`
- Configured GoRouter navigation with stateful bottom navigation shell
- Screen implementations: Login, Dashboard, Customers, Invoices, Chotu AI Voice, Follow-ups
- Secure token storage via `shared_preferences` and custom `Dio` HTTP interceptor
- Clean code analysis: 0 issues on `flutter analyze`
- Unit tests passing (`flutter test`)

## Phase 5 — Chotu AI Voice Prototype ✅
- Python voice agent implemented in `services/voice-agent`
- LiveKit token endpoint in NestJS (`POST /api/voice/token`)
- Web microphone / audio conversation simulation in `apps/web`
- Flutter mobile voice interface in `apps/mobile`
- Zero-dependency interactive CLI simulation mode (`python agent.py --simulate`)
- Standalone unit tests passing (`python -m unittest test_agent.py`)

## Phase 6 — Collections Intelligence ✅
- Backend tools for AI (`get_customer_balance`, `get_overdue_invoices`, `get_customer_summary`, `create_follow_up_task`, `record_payment_promise`, `dispute_invoice`, `dispatch_reminder`)
- Human-in-the-loop confirmation before consequential AI actions (`ActionProposal` workflow: approval, rejection, and auto-execution)
- Multi-channel notification dispatch (WhatsApp, SMS, Email) with template rendering and automated ageing rules
- Tenant-scoped audit logs with strict row-level isolation and compliance metadata
- Interactive Collections Intelligence Web dashboard (`/intelligence`) with action review queue, dispatch bench, AI assistant, and audit trail
- Chotu AI Python Voice Agent integration with tool calling and verbal confirmation guard
- Mobile Dart data models and test suite updated


## Phase 7 — Integrations 🔜
- Payment link provider adapter (Razorpay / Stripe)
- WhatsApp notification adapter
- SIP telephony provider gateway
- Real outbound calls: DISABLED until explicit approval

## Phase 8 — Final Verification 🔜
- End-to-end multi-tenant isolation review
- Production deployment scripts and Docker Compose orchestration
