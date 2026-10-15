-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'PROCESSING', 'AVAILABLE', 'FAILED');

-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "recordingUrl" TEXT,
ADD COLUMN     "recordingStatus" "RecordingStatus",
ADD COLUMN     "recordingEgressId" TEXT;
