# myCashflo

> AI-powered accounts receivable and collections platform.

## Applications & Services

| App / Service | Technology | Default Port / Target | Status |
|---|---|---|---|
| `services/api` | NestJS + PostgreSQL + Prisma | `http://localhost:3000/api` | ✅ Operational |
| `apps/web` | React 19 + Vite + TypeScript + Tailwind CSS | `http://localhost:5173` | ✅ Operational |
| `apps/mobile` | Flutter 3.x + Dart + GoRouter + Dio | Android, iOS, Windows, Web | ✅ Operational |
| `services/voice-agent` | Python 3.10+ + LiveKit | CLI / WebRTC Agent | ✅ Operational |

---

## Demo Credentials

The database has been seeded with demo tenant data:

- **Admin Account**: `admin@democorp.in`
- **Password**: `Admin@1234`
- **Agent Account**: `agent@democorp.in`
- **Password**: `Agent@1234`

---

## How to Run

### 1. Run the Backend API (NestJS)

Ensure PostgreSQL is running locally (or via your cloud `DATABASE_URL` in `services/api/.env`):

```powershell
cd services/api
npm install
npm run start:dev
```

- **API Base URL**: [http://localhost:3000/api](http://localhost:3000/api)
- **Interactive Swagger Docs**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

### 2. Run the React Web App

In a separate terminal:

```powershell
cd apps/web
npm install
npm run dev
```

- **Web App**: [http://localhost:5173](http://localhost:5173)
- Vite automatically proxies `/api` calls to `http://localhost:3000`.

---

### 3. Run the Flutter Mobile App

In a separate terminal:

```powershell
cd apps/mobile
flutter pub get
flutter run
```

You can choose your target device (Chrome, Windows desktop, Android emulator, or iOS simulator).

To run specifically on Chrome or Windows:
```powershell
flutter run -d chrome
# or
flutter run -d windows
```

---

### 4. Run the Chotu AI Voice Agent

In a separate terminal:

#### Interactive CLI Simulation (No extra setup needed)
```powershell
cd services/voice-agent
python agent.py --simulate
```

#### Production LiveKit Mode
```powershell
cd services/voice-agent
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env with your LiveKit and OpenAI API credentials
python agent.py
```

---

## Running Automated Tests

```powershell
# API tests (Vitest + e2e)
cd services/api
npm run test
npm run test:e2e
# Live E2E verification against running API & database
node test/verify-phase6-live.mjs

# Web build & typecheck
cd apps/web
npm run build

# Flutter analysis & tests
cd apps/mobile
flutter analyze
flutter test

# Python agent tests
cd services/voice-agent
python -m unittest test_agent.py

```

---

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Development Roadmap](docs/ROADMAP.md)
- [Technical Decisions](docs/DECISIONS.md)

## Security

- Never commit `.env` files or API secrets.
- Multi-tenant row-level isolation is enforced on every query via `tenantId`.
- Access tokens expire periodically with refresh token rotation.
