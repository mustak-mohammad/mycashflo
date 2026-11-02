import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const outcomesToAdd = ['WILL_PAY_LATER', 'UNABLE_TO_PAY', 'PAYMENT_CLAIMED'];
    for (const val of outcomesToAdd) {
      await prisma.$executeRawUnsafe(`ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS '${val}'`);
      console.log(`Added ${val} to CallOutcome enum`);
    }

    const enums = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'CallOutcome'
    `);
    console.log('Updated PostgreSQL CallOutcome values:', enums);
  } catch (err) {
    console.error('Error updating enum:', err);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
