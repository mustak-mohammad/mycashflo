# ==============================================================================
# Production Dockerfile for myCashFlo API (NestJS + Prisma)
# Optimized for Railway deployment with multi-stage build & persistent storage
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build stage
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl required for Prisma query engine on Alpine Linux
RUN apk add --no-cache openssl

# Copy package manifests from services/api
COPY services/api/package*.json ./

# Install all dependencies (including devDependencies needed for Nest CLI & Prisma CLI)
RUN npm ci

# Copy Prisma schema and generate Prisma Client
COPY services/api/prisma ./prisma
RUN npx prisma generate

# Copy NestJS configuration and TypeScript sources
COPY services/api/nest-cli.json services/api/tsconfig*.json ./
COPY services/api/src ./src

# Compile NestJS production bundle into /app/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production runtime stage
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install openssl runtime for Prisma on Alpine Linux
RUN apk add --no-cache openssl

# Install production-only dependencies
COPY services/api/package*.json ./
RUN npm ci --omit=dev

# Copy generated Prisma Client & engine from builder stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY services/api/prisma ./prisma

# Copy compiled application code from builder stage
COPY --from=builder /app/dist ./dist

# Create uploads directory for persistent storage (volume mount target: /app/uploads)
RUN mkdir -p /app/uploads/recordings

# Expose default HTTP port
EXPOSE 3000

# Start NestJS production server
CMD ["node", "dist/main.js"]
