import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const enums = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'CallOutcome'
    `);
    console.log('PostgreSQL CallOutcome values:', enums);
    
    // Also check existing CallSession rows
    const sessions = await prisma.callSession.findMany({
      take: 5,
      select: { id: true, outcome: true, summary: true }
    });
    console.log('Sample CallSessions:', sessions);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
