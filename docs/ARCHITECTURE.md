# myCashflo — Architecture

## Overview

myCashflo is a multi-tenant SaaS platform for collections and receivables management.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                 │
│   React Web App (apps/web)        Flutter Mobile (apps/mobile)  │
│        Vite + TypeScript           Flutter + Dart               │
└──────────────────┬──────────────────────┬───────────────────────┘
                   │ REST over HTTPS       │ REST over HTTPS
                   ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS REST API (services/api)               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Auth/JWT   │  │ Customers  │  │ Invoices   │  │ Reports  │  │
│  └────────────┘  └────────────┘  └────────────┘  └──────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │Collections │  │ Payments   │  │ Voice Token│  │ CallLogs │  │
│  └────────────┘  └────────────┘  └────────────┘  └──────────┘  │
│                    Prisma ORM                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   PostgreSQL Database   │
              └─────────────────────────┘

                         │ LiveKit Token (issued by NestJS)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              LiveKit Server (Cloud or Self-hosted)              │
│                            │                                    │
│              ┌─────────────┴────────────┐                      │
│              │  Chotu AI Voice Agent   │                       │
│              │  services/voice-agent   │                       │
│              │  Python + LiveKit SDK   │                       │
│              └──────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
mycashflo/
  apps/
    web/              React + Vite + TypeScript (port 5173)
    mobile/          Flutter + Dart (Android & iOS)
  services/
    api/             NestJS + PostgreSQL + Prisma (port 3000)
    voice-agent/     Python LiveKit agent (Phase 5)
  packages/
    shared-types/    Shared TypeScript interfaces
  docs/              Architecture and technical documentation
```

## Multi-Tenancy

Every tenant-owned record has a `tenantId` foreign key. The NestJS API always scopes database queries to the authenticated user's `tenantId`. Tenant isolation is enforced at the service layer — no raw SQL that bypasses it.

## Authentication Flow

1. User POSTs `email+password` to `POST /api/auth/login`
2. NestJS validates credentials, returns a short-lived JWT access token + refresh token
3. Client stores `accessToken` in localStorage, sends it as `Authorization: Bearer <token>` on every request
4. On 401, client redirects to `/login`

## Voice Session Flow (Phase 5)

1. Authenticated user requests a LiveKit token from `POST /api/voice/token`
2. NestJS validates user+tenant, then calls the LiveKit server API to create a room token
3. Client uses the token to join a LiveKit room
4. The Python voice agent joins the same room and handles audio
5. AI provider (OpenAI/Groq) processes speech and returns spoken responses
6. Call summary stored in `CallSession` table on disconnect
