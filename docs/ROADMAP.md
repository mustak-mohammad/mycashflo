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


## Phase 7 — Integrations ✅
- Payment link provider adapters implemented (`RazorpayAdapter` for Indian domestic/UPI and `StripeAdapter` for global cards/multi-currency)
- Secure payment webhook reconciliation (`POST /api/payments/webhook/:provider`) verifying HMAC-SHA256 signatures, automatically updating invoice balances, setting statuses (`PAID` / `PARTIALLY_PAID`), creating `Payment` records, and updating customer balances
- Meta WhatsApp Business Cloud API messaging adapter (`WhatsAppCloudAdapter`) integrated into notification dispatch with webhook challenge handshake and status event receivers
- SIP Telephony Gateway provider adapter (`SipTelephonyAdapter`) with strict safety guard (`OUTBOUND_CALLS_ENABLED` flag check, defaulting to disabled simulation mode to prevent unintended PSTN carrier charges)
- Tenant-isolated integration configuration management (`GET /api/integrations`, `PUT /api/integrations/:provider`, `POST /api/integrations/:provider/test`) with automatic secret masking
- Web application updates:
  - Interactive Provider Integrations Bench on Settings & Compliance page (`/settings`)
  - 1-click Pay Link generation modal on Invoices page (`/invoices`) with instant URL copying and status chips
  - Active integration indicators and payment links on Payments page (`/payments`)
- Mobile data models (`PaymentLinkItem`, `TelephonyCallSession`) and test suite updated with 100% test pass
- Live end-to-end verification script (`test/verify-phase7-live.mjs`) passing 23/23 tests

## Phase 8 — Final Completion & Enterprise Stabilization ✅
- **Automated Reminders Engine & Scheduler (`services/api/src/reminders`)**:
  - Scan & preview engine evaluating outstanding invoices with stage classification (`DUE_SOON`, `DUE_TODAY`, `OVERDUE_GRACE`, `OVERDUE_ESCALATED`, `OVERDUE_LEGAL_NOTICE`).
  - Strict suppression rules for zero-balance, fully paid, void, opted-out, and `NO_CONTACT` customer accounts.
  - Periodic scheduler (`RemindersScheduler`) with quiet-hours observance, customer frequency capping (`maxDailyPerCustomer`), and minimum reminder intervals (`minDaysBetweenReminders`).
  - Scoped controlled test-send safety mechanism (`REMINDERS_TEST_EMAIL_DELIVERY_ENABLED`) enforcing dedicated test scope and recipient allowlisting.
  - Interactive Web management view (`/reminders` and `Settings > Reminders`) with live stats, template previews, run history, and accurate dry-run UI terminology (`Simulated: N (0 live messages sent)`).
- **Workspace Onboarding & Company Setup (`services/api/src/onboarding`)**:
  - Interactive setup wizard for legal entity profiles, billing preferences, credit periods, and CSV batch customer/invoice imports.
  - Dynamic preview and validation for customer imports with duplicate detection and address validation.
- **System Verification & Zero-Regression Test Battery**:
  - 227/227 API unit/integration tests passing across 21 suites (`npm test`).
  - 39/39 Python Chotu AI Voice Agent tests passing (`python -m unittest test_agent.py`).
  - 8/8 Flutter Mobile tests passing with 0 analyzer issues (`flutter test`, `flutter analyze`).
  - Native Android Release APK built successfully (`build/app/outputs/flutter-apk/app-release.apk`, 50.2MB).
  - Flutter Web build compiled cleanly (`build/web`).
  - 33/33 Priority Final Completion Validation assertions passing (`scratch/validate_final_flows.mjs`).
  - 43/43 live end-to-end API integration checks passing (`verify-full-application.mjs`).
  - 25/25 RBAC & Call Recordings verification checks passing (`verify-rbac-and-recordings.mjs`).
  - Web production build passing with 0 TypeScript/Vite errors (`npm run build`).
  - Multi-tenant data isolation verified across all query paths with 0 data leakage.

## Phase 9 — Admin & Collection Agent Role-Based Access Control (RBAC) & Call Recordings ✅
- **Role-Based Access Control (`RolesGuard`, `@Roles`)**:
  - Server-side role enforcement on every sensitive NestJS controller (`UsersController`, `PaymentsController`, `RemindersController`, `IntegrationsController`, `InvoicesController`, `CustomersController`, `CollectionsController`, `AuditLogsController`).
  - Admin capabilities: Manage organization team members, change user roles, configure payment gateways & provider credentials, adjust reminder settings, inspect tenant compliance audit logs, execute financial adjustments and verify payment claims.
  - Collection Agent boundaries: Scoped to assigned customers and collection cases. Blocked from managing users, accessing integration credentials, modifying tenant settings, or initiating financial adjustments.
- **Payment Claims Workflow (`AWAITING_VERIFICATION`)**:
  - Agent can record customer payment claims (`POST /api/payments/claim`) with payment method, UTR/reference, transaction notes, and proof image/document URL.
  - Financial safety: Registering a claim creates a `Payment` with status `PENDING` without reducing invoice outstanding balance, without changing customer balance, and without marking invoices `PAID`.
  - Supervisor verification: Authorized administrators verify claims via `POST /api/payments/:id/verify`, which settles invoice balances, updates customer ledgers, and logs compliance audit events.
- **Voice Recordings Pipeline & Download Option**:
  - Upload audio recordings (`POST /api/calls/:id/recording/upload`) with status `AVAILABLE` and secure local disk persistence (`uploads/recordings/<tenantId>/<callId>.webm`).
  - Streaming audio endpoint (`GET /api/calls/:id/recording/stream`) supporting HTTP 206 Partial Content Range playback.
  - Dedicated download endpoint (`GET /api/calls/:id/recording/download`) with `Content-Disposition: attachment; filename="recording-..."`.
  - Dual authentication: Supports both standard `Authorization: Bearer <token>` and `?token=<token>` query parameter for direct browser anchor downloads and `<audio>` controls.
  - Web UI: Call History (`/calls`) displays interactive `▶️ Play` audio player and `📥 Audio` one-click download buttons on each completed recording row.
- **Frontend Permission Experience (`RequireRole`, `AppLayout`, `TeamUsersView`)**:
  - Dynamic navigation rendering based on authenticated role (`ADMIN`, `MANAGER`, `AGENT`). Restricted tabs (Intelligence, Reminders, Settings) hidden for Agents.
  - Route guard (`RequireRole`) rendering structured 403 Forbidden Access Denied screens if restricted URLs are accessed directly.
  - Team & Roles management bench embedded in Settings (`Settings > Team & Roles`) for Admin user provisioning and role assignment.

## Phase 10 — Application-Wide Chotu AI Chatbot Implementation ✅
- **Floating Chatbot Widget (`apps/web/src/components/chat/FloatingChatWidget.tsx`)**:
  - Floating Chotu launcher button at bottom-right corner (`fixed bottom-6 right-6 z-50`) across all authenticated web application pages.
  - Mounted centrally in `AppLayout.tsx`, guaranteeing universal access on all authenticated routes while hidden on public login/auth pages.
  - State persistence across client-side page navigation: active conversation history, message thread, and open/minimized state persist seamlessly when switching between pages.
  - Supports open, minimize to compact pill badge (`Chotu AI ● Active`), restore, and close behaviors.
  - Empty-state welcome screen with role-aware suggested prompt chips (Admin vs Collection Agent).
  - Safe lightweight markdown formatter with zero `dangerouslySetInnerHTML` for complete XSS immunity.
  - Loading typing indicator, disabled submit controls during requests, input character limit (1000 chars), and error banners with retry action.
  - Contextual route navigation buttons (e.g. "Open INVOICES →", "Open PAYMENTS →") when assistant suggests relevant platform pages.
- **Secure Chat API (`POST /api/chotu/chat` in `services/api/src/chotu`)**:
  - Dedicated NestJS module (`ChotuModule`), controller (`ChotuController`), and service (`ChotuService`).
  - Strict input validation via `ChotuChatRequestDto` with `@Transform` trimming, length restrictions (1-1000 characters), and sanitized DTO responses (`ChotuChatResponseDto`).
  - Protected with `JwtAuthGuard` and `RolesGuard`, rejecting unauthenticated requests with 401.
- **Application-Aware Deterministic Intelligence**:
  - Receivables and invoice overviews computed in real-time from verified database balances.
  - Overdue invoice listings with exact outstanding amounts, due dates, and days overdue calculations.
  - Customer 360° account summaries, status indications (Active vs Inactive / Outreach Suppressed), and recent payment histories.
  - Payment records identification distinguishing real verified transactions from simulated sandbox transactions (`providerRef` markers).
  - Collections performance tracking: open collection cases, pending follow-up tasks due today, and recent voice call outcomes.
  - Role-aware platform navigation guidance for Dashboards, Customers, Invoices, Payments, Collections, Reminders, Reports, and Settings.
- **Tenant Isolation & RBAC Scoping**:
  - Every customer, invoice, payment, and collection query is strictly scoped to `user.tenantId` (zero cross-tenant data leakage).
  - Collection Agents are restricted to their assigned customer accounts and cases (`case.assignedTo === user.userId` or `task.assignedTo === user.userId`). Inquiries about unassigned accounts return structured access restricted notices without leaking unassigned customer financials.
  - Inquiries about administrative settings (user management, integrations) are role-aware: explained in full to Admins, while politely explaining role limitations to Collection Agents.
- **Read-Only Safety Guards & Mutation Interception**:
  - Conversational assistant only; strictly zero database mutations or financial updates.
  - Automatically intercepts and refuses attempts to settle invoices, mark invoices paid, change balances, create customers, alter settings, or dispatch live customer outreach (WhatsApp, email, SMS, phone calls).
  - Directs users to authorized UI workflows (e.g., Payments page for recording collections or submitting agent claims).
- **Comprehensive Verification & Regression Suite**:
  - 11/11 unit tests passing in `services/api/src/chotu/chotu.service.spec.ts`.
  - 15/15 live integration tests passing in `services/api/test/verify-chotu-chat.mjs`.
  - 238/238 full backend unit & integration tests passing across 22 test files (`npm test`).
  - Web production build passing with 0 TypeScript/Vite errors (`npm run build`).
  - Live interactive browser UAT completed and verified via browser recording (`chotu_chatbot_flow_1792755460055.webp`).

## Phase 11 — Autonomous Chotu AI Testing with Synthetic Customers ✅
- **Dedicated Synthetic Fixtures & Isolation**:
  - Dynamically provisioned dedicated synthetic tenant (`tenant_synth_<timestamp>`) with zero coupling to real financial data.
  - Synthetic customers created strictly with non-deliverable contact details (`.test` TLD, `+91999990000x` phone prefix).
  - Comprehensive invoice states: overdue (5 days), overdue (2 days), upcoming due-soon (+2 days), DND (`DND:NO_CONTACT`), inactive customer accounts, unverified payment claims (UTR proof submitted), and fully settled/paid (outstanding: 0).
  - Complete automated database teardown ensuring zero residual synthetic data in the database.
- **Autonomous Scheduler & Multi-Stage Escalation**:
  - Daily overdue and due-soon scanning logic verified across multi-stage classification (`DUE_SOON`, `DUE_TODAY`, `OVERDUE_STAGE_1`, `OVERDUE_STAGE_2`, `OVERDUE_STAGE_3`).
  - Weekly follow-up progression (+7 days) automatically escalates invoices to higher collection urgency (e.g., `OVERDUE_STAGE_1` -> `OVERDUE_STAGE_2`).
  - Strict frequency capping: `maxDailyPerCustomer = 1` enforces single daily contact across multiple customer invoices.
  - Persistent idempotency: repeated daily scans are suppressed with `ALREADY_SENT_FOR_STAGE_TODAY` based on deterministic compound keys (`rem_${tenantId}_${invoiceId}_${stage}_${localDate}`).
  - Contact suppression: settled invoices (balance 0 / `PAID`), customers marked `DND:NO_CONTACT`, and inactive accounts are 100% suppressed from outreach queues.
  - Independent payment verification: unverified customer claims leave underlying invoice balances intact without premature settlement.
- **Chotu AI Factual Decision Verification**:
  - Reminder messages generated strictly from verified database records: exact invoice numbers, Rupee formatting (`₹`), and days overdue calculations.
  - Zero hallucinated commitments, fabricated discounts, legal threats, or hostile debt collection language.
- **Controlled Real Email Test**:
  - Outbound email safety guard verified: dispatches to unauthorized external recipients (`unauthorized-external@client-domain.in`) are strictly intercepted and blocked.
  - Single controlled test dispatch executed to explicitly configured owner test recipient: `mustakmohammad396@gmail.com`.
  - Provider response: `PROVIDER_ACCEPTED` (Resend Message ID: `01a1689e-8fa6-7888-908d-f0bed70f9334`).
- **Controlled Real WhatsApp Test**:
  - WhatsApp safety guard verified: dispatches to synthetic customer phone numbers (`+919999900001`) are strictly intercepted and blocked.
  - Single controlled test dispatch executed to explicitly configured owner test recipient: `919618954429`.
  - Provider response: `PROVIDER_ACCEPTED` (Meta WhatsApp Message ID: `wamid.HBgMOTE5NjE4OTU0NDI5FQIAERgSNUIwNkVDNDM2RjIwNDY4MEZCAA==`, status: `SENT`).
- **Delivery Status Lifecycle Modeling**:
  - Explicit distinction between `SIMULATED` (dry-run, no network dispatch), `PROVIDER_ACCEPTED` / `SENT` (provider accepted payload; awaiting delivery), `DELIVERED` (carrier delivery receipt confirmed via webhook), and `FAILED`.
- **Verification Matrix**:
  - 25/25 checks passed in `services/api/test/verify-autonomous-chotu-reminders.mjs`.
  - 15/15 checks passed in `services/api/test/verify-scheduled-live-test.mjs` (Controlled Scheduled Automation Run).
  - 241/241 backend regression tests passed across 22 test files (`npm test`).
  - Web production build passing with 0 errors (`npm run build`).
  - Global automation flags remain safely disabled (`AUTOMATED_REMINDERS_ENABLED=false`, `EMAIL_DELIVERY_ENABLED=false`, `ENABLE_OUTBOUND_CALLS=false`, `REMINDERS_TEST_MODE=false`).
- **Controlled Scheduled Live Reminder Activation (`REMINDERS_TEST_MODE=true`)**:
  - Server-side test-delivery boundary allowlist verified across scheduler, central notification dispatch hub, and outbound provider adapters.
  - End-to-end scheduled run executed via `RemindersScheduler.runScheduledScan()` without bypassing normal scheduling loops.
  - Single controlled test message dispatched to owner-controlled recipient (`mustakmohammad396@gmail.com`) with verified Resend Message ID: `01a168bd-17a9-7aaf-9971-575ce481aa74` (`status: SENT / PROVIDER_ACCEPTED`).
  - Webhook delivery confirmation verified transitioning status to `DELIVERED`.
  - Second scheduler scan executed: verified 100% duplicate suppression via persistent idempotency (`ALREADY_SENT_FOR_STAGE_TODAY`).
  - Immediate teardown and rollback to safe defaults (`REMINDERS_TEST_MODE=false`).
