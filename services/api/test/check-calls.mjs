import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const calls = await prisma.callSession.findMany({
    select: {
      id: true,
      livekitRoom: true,
      recordingStatus: true,
      recordingUrl: true,
      recordingEgressId: true,
      outcome: true,
      startedAt: true,
      duration: true,
      transcript: true,
    },
  });
  console.log('Total calls:', calls.length);
  for (const c of calls) {
    console.log({
      id: c.id,
      outcome: c.outcome,
      duration: c.duration,
      recordingStatus: c.recordingStatus,
      recordingUrl: c.recordingUrl,
      recordingEgressId: c.recordingEgressId,
      hasTranscript: Boolean(c.transcript),
    });
  }
  await prisma.$disconnect();
}

main().catch(console.error);
