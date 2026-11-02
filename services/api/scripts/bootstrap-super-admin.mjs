#!/usr/bin/env node
/**
 * myCashFlo — Super Admin Explicit Bootstrap Script
 *
 * Safe, platform-owner controlled CLI command to provision or promote the initial
 * platform SUPER_ADMIN account.
 *
 * Usage:
 *   node scripts/bootstrap-super-admin.mjs --email superadmin@mycashflo.internal --name "Platform Super Admin" --password "StrongPassword123!"
 * Or via npm:
 *   npm run super-admin:bootstrap --prefix services/api -- --email superadmin@mycashflo.internal --password "StrongPassword123!"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BCRYPT_ROUNDS = 12;

/**
 * Fallback parser for .env files without external dependencies.
 */
export function parseAndApplyEnv(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reliably loads environment variables (especially DATABASE_URL) whether the script
 * is executed directly inside services/api or via --prefix services/api from the repo root.
 */
export function loadBootstrapEnv(customEnvPath) {
  if (customEnvPath) {
    if (fs.existsSync(customEnvPath)) {
      parseAndApplyEnv(customEnvPath);
      return { loaded: true, source: customEnvPath };
    }
    return { loaded: false, error: `File not found: ${customEnvPath}` };
  }

  if (process.env.DATABASE_URL) {
    return { loaded: true, source: 'process.env' };
  }

  // Candidate paths in order of priority:
  // 1. services/api/.env relative to this script directory (canonical)
  // 2. services/api/.env relative to cwd (when invoked from repository root)
  // 3. .env in current working directory
  const candidatePaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), 'services/api/.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        if (typeof process.loadEnvFile === 'function') {
          process.loadEnvFile(envPath);
        } else {
          parseAndApplyEnv(envPath);
        }
      } catch {
        parseAndApplyEnv(envPath);
      }

      if (process.env.DATABASE_URL) {
        return { loaded: true, source: envPath };
      }
    }
  }

  return { loaded: false, error: 'DATABASE_URL not found' };
}

// Pre-load environment variables before PrismaClient instantiation
loadBootstrapEnv();

let prismaInstance = null;
function getPrisma() {
  if (!prismaInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not defined in the environment or in services/api/.env');
    }
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      options[key] = value;
      if (value !== true) i++;
    }
  }
  return options;
}

export async function bootstrap() {
  const envStatus = loadBootstrapEnv();
  if (!process.env.DATABASE_URL) {
    console.error('❌ Configuration Error: DATABASE_URL is not defined in the environment or in services/api/.env.');
    console.error('   Please ensure a valid PostgreSQL connection string is configured in services/api/.env.');
    process.exit(1);
  }

  const args = parseArgs();
  const email = (args.email || process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const name = (args.name || process.env.SUPER_ADMIN_BOOTSTRAP_NAME || 'Platform Super Admin').trim();
  const password = args.password || process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD || '';
  const allowPromote = Boolean(args['allow-promote'] || process.env.SUPER_ADMIN_ALLOW_PROMOTE === 'true');
  const updatePassword = Boolean(args['update-password'] || process.env.SUPER_ADMIN_UPDATE_PASSWORD === 'true');

  if (!email || !email.includes('@')) {
    console.error('❌ Error: A valid --email is required.');
    console.error('Usage: npm run super-admin:bootstrap --prefix services/api -- --email <email> --password <password> [--name <name>] [--allow-promote] [--update-password]');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('❌ Error: A secure --password with at least 8 characters is required.');
    process.exit(1);
  }

  console.log(`🛡️  Initiating Super Admin provisioning for: ${email}`);

  let prisma;
  try {
    prisma = getPrisma();
  } catch (err) {
    console.error('❌ Database Initialization Error:', err.message);
    process.exit(1);
  }

  try {
    // 1. Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email },
      include: { tenant: true },
    });

    if (existingUser) {
      const targetTenantId = existingUser.tenantId;

      // Repeat execution: User is already a SUPER_ADMIN
      if (existingUser.role === 'SUPER_ADMIN') {
        if (!updatePassword) {
          console.log(`ℹ️   Account '${email}' is already a provisioned SUPER_ADMIN in tenant '${existingUser.tenant.name}' (${existingUser.tenant.slug}).`);
          console.log('    Repeat execution completed safely without modifying existing credentials.');
          console.log('    (To explicitly reset this account\'s password, re-run with --update-password)');
          process.exit(0);
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { passwordHash, name: name || existingUser.name },
        });

        await prisma.auditLog.create({
          data: {
            tenantId: targetTenantId,
            userId: existingUser.id,
            action: 'platform.super_admin_credentials_updated',
            entityType: 'User',
            entityId: existingUser.id,
            metadata: {
              email: existingUser.email,
              action: 'updated_super_admin_password',
              timestamp: new Date().toISOString(),
            },
          },
        });

        console.log(`✅ Successfully updated credentials for existing SUPER_ADMIN: ${email}`);
        process.exit(0);
      }

      // Existing user has another role (e.g. ADMIN, MANAGER, AGENT)
      if (!allowPromote) {
        console.error(`❌ Conflict Error: An account with email '${email}' already exists with role '${existingUser.role}' in tenant '${existingUser.tenant.name}' (${existingUser.tenant.slug}).`);
        console.error('   Refusing to accidentally promote or overwrite an existing tenant account without explicit confirmation.');
        console.error('   If you intend to elevate this existing user to platform SUPER_ADMIN, pass the --allow-promote flag.');
        process.exit(1);
      }

      console.log(`⚠️   Explicit promotion confirmed for existing user in tenant '${existingUser.tenant.name}' (${existingUser.tenant.slug})`);
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: 'SUPER_ADMIN',
          passwordHash,
          name: name || existingUser.name,
          isActive: true,
        },
      });

      // Audit log the promotion
      await prisma.auditLog.create({
        data: {
          tenantId: targetTenantId,
          userId: updated.id,
          action: 'platform.super_admin_bootstrapped',
          entityType: 'User',
          entityId: updated.id,
          metadata: {
            email: updated.email,
            action: 'promoted_existing_user',
            previousRole: existingUser.role,
            timestamp: new Date().toISOString(),
          },
        },
      });

      console.log(`✅ Successfully promoted existing user ${email} to SUPER_ADMIN!`);
      console.log(`   User ID:   ${updated.id}`);
      console.log(`   Tenant:    ${existingUser.tenant.name} (${existingUser.tenant.slug})`);
      console.log(`   Role:      SUPER_ADMIN`);
    } else {
      // 2. Provision dedicated platform tenant if needed
      let platformTenant = await prisma.tenant.findUnique({
        where: { slug: 'platform' },
      });

      if (!platformTenant) {
        platformTenant = await prisma.tenant.create({
          data: {
            name: 'Platform Administration',
            slug: 'platform',
          },
        });
        console.log(`✔  Created dedicated platform management tenant (${platformTenant.id})`);
      }

      const targetTenantId = platformTenant.id;
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const newUser = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'SUPER_ADMIN',
          isActive: true,
          tenantId: targetTenantId,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: targetTenantId,
          userId: newUser.id,
          action: 'platform.super_admin_bootstrapped',
          entityType: 'User',
          entityId: newUser.id,
          metadata: {
            email: newUser.email,
            action: 'created_new_super_admin',
            timestamp: new Date().toISOString(),
          },
        },
      });

      console.log(`✅ Successfully provisioned initial SUPER_ADMIN account: ${email}`);
      console.log(`   User ID:   ${newUser.id}`);
      console.log(`   Tenant:    ${platformTenant.name} (${platformTenant.slug})`);
      console.log(`   Role:      SUPER_ADMIN`);
    }

    console.log('🔒 Security Notice: Credentials successfully stored with bcrypt (12 rounds). Secrets are masked.');
  } catch (err) {
    console.error('❌ Bootstrap failed:', err.message);
    process.exit(1);
  } finally {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
    }
  }
}

// Auto-run only when invoked directly as CLI script
const isDirectRun = Boolean(
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
);

if (isDirectRun) {
  void bootstrap();
}
