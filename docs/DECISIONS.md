# myCashflo — PostgreSQL Setup (Windows) and Technical Decisions

## PostgreSQL Setup on Windows

### Option A — Local Installation (Recommended for development)

1. **Download PostgreSQL**
   Go to https://www.postgresql.org/download/windows/ and download the latest installer (PostgreSQL 16 or 17).

2. **Run the installer**
   - Accept defaults or customize the installation directory.
   - Set a strong password for the `postgres` superuser — **remember this password**.
   - Leave the default port as `5432`.
   - Complete the Stack Builder step optionally (you can skip it).

3. **Verify the installation (in PowerShell)**
   ```powershell
   psql --version
   # Should print: psql (PostgreSQL) 16.x
   ```
   If `psql` is not found, add PostgreSQL `bin` folder to your PATH:
   ```
   C:\Program Files\PostgreSQL\16\bin
   ```
   Then restart PowerShell.

4. **Create the database**
   ```powershell
   # Log in as the postgres superuser
   psql -U postgres

   # Inside the psql prompt:
   CREATE DATABASE mycashflo;
   \q
   ```

5. **Set your DATABASE_URL in services/api/.env**
   ```
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/mycashflo
   ```

### Option B — Free Cloud Database (No installation required)

**Neon** provides a free PostgreSQL tier with 512 MB storage and a connection string you can paste directly.

1. Go to https://neon.tech and sign up (free, no credit card required).
2. Create a project → create a database named `mycashflo`.
3. Copy the connection string from the Neon dashboard.
4. Paste it into `services/api/.env` as `DATABASE_URL`.

The connection string will look like:
```
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/mycashflo?sslmode=require
```

---

## Technical Decisions

### 1 — ESM + Vitest for NestJS (not Jest)

**Decision:** The NestJS CLI selected ESM modules and Vitest instead of CommonJS + Jest.

**Reason:** The CLI offered this as the modern default. Vitest is significantly faster than Jest and natively supports ES modules. This avoids the `ts-jest` transform configuration overhead.

**Impact:** All imports must use `.js` file extensions in TypeScript source (this is an ESM requirement), which the NestJS CLI handles automatically.

---

### 2 — @nestjs/observe removed

**Decision:** Removed the `@nestjs/observe` module that the CLI added by default.

**Reason:** The module required an `APP_KEY` and `APP_SECRET` from the observe.nestjs.com paid service, which would cause a startup error without credentials. It is not needed for Phase 1.

**Impact:** No distributed tracing in Phase 1. Can be re-added later with an actual credentials if desired.

---

### 3 — Tailwind CSS v4 (@tailwindcss/vite plugin)

**Decision:** Used the new Tailwind CSS v4 style with the official Vite plugin instead of the legacy PostCSS configuration.

**Reason:** Tailwind v4 integrates directly into Vite without a `tailwind.config.js` file, significantly simplifying the setup. The `@import "tailwindcss"` in `index.css` replaces the three-directive setup from v3.

**Impact:** No `tailwind.config.js` needed. If a custom `theme.extend` is required, it goes inside a `@layer` or `@theme` block in `index.css`.

---

### 4 — localhost vs localStorage for auth tokens

**Decision:** Access tokens stored in `localStorage` during Phase 1 development.

**Reason:** Simplest approach for a development prototype. The alternative (httpOnly cookies) requires SSR or a more complex configuration.

**Impact:** In production, switch to secure httpOnly cookies with SameSite=Strict. This is planned for Phase 2. The Axios interceptor already reads from the standard `mcf_access_token` key, making the switch transparent to page components.

---

### 5 — Mock data clearly labelled

**Decision:** All pages show a "🔧 Demo data" notice while the backend is not connected.

**Reason:** Prevents confusion about whether features are working. Satisfies the project rule: never claim a feature works unless it is implemented and tested.

---

### 6 — PostgreSQL preferred over SQLite

**Decision:** PostgreSQL (not SQLite) even in development.

**Reason:** myCashflo uses multi-tenant row-level isolation features and requires precise decimal handling for monetary values (DECIMAL(19,4)). SQLite does not support Prisma migrations for some of the features we need, and switching databases between dev and production introduces hard-to-find bugs.
