import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EgressClient,
  EgressStatus,
  EncodedFileType,
  EncodedFileOutput,
  S3Upload,
} from 'livekit-server-sdk';

export type RecordingLookup =
  | { status: 'COMPLETE'; url: string }
  | { status: 'IN_PROGRESS' }
  | { status: 'FAILED'; error?: string }
  | { status: 'UNKNOWN' };

/**
 * Orchestrates LiveKit Egress room recording.
 *
 * Requires LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to be real values.
 * Optionally an S3 target can be configured via LIVEKIT_EGRESS_S3_* env vars;
 * otherwise LiveKit Cloud's project default storage is used.
 */
@Injectable()
export class RecorderService {
  private readonly logger = new Logger(RecorderService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    const key = this.config.get<string>('LIVEKIT_API_KEY');
    const secret = this.config.get<string>('LIVEKIT_API_SECRET');
    const url = this.config.get<string>('LIVEKIT_URL');
    const placeholder = (v?: string) => !v || v.startsWith('your_') || v === 'placeholder';
    return !placeholder(key) && !placeholder(secret) && !placeholder(url);
  }

  private client(): EgressClient {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('LiveKit recording is not configured on this server');
    }
    const host = this.config.get<string>('LIVEKIT_URL')!.replace(/^ws/, 'http');
    return new EgressClient(
      host,
      this.config.get<string>('LIVEKIT_API_KEY'),
      this.config.get<string>('LIVEKIT_API_SECRET'),
    );
  }

  private buildOutput(): EncodedFileOutput {
    const prefix = this.config.get<string>('LIVEKIT_EGRESS_PATH') ?? 'recordings';
    const bucket = this.config.get<string>('LIVEKIT_EGRESS_S3_BUCKET');

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: `${prefix}/{room_name}-{time}`,
    });

    if (bucket) {
      output.output = {
        case: 's3',
        value: new S3Upload({
          bucket,
          region: this.config.get<string>('LIVEKIT_EGRESS_S3_REGION') ?? '',
          accessKey: this.config.get<string>('LIVEKIT_EGRESS_S3_ACCESS_KEY') ?? '',
          secret: this.config.get<string>('LIVEKIT_EGRESS_S3_SECRET') ?? '',
          endpoint: this.config.get<string>('LIVEKIT_EGRESS_S3_ENDPOINT') ?? '',
          forcePathStyle: this.config.get<string>('LIVEKIT_EGRESS_S3_FORCE_PATH_STYLE') === 'true',
        }),
      };
    }

    return output;
  }

  /** Begin an audio-only room composite recording. Returns the egress job id. */
  async startRoomRecording(roomName: string): Promise<string> {
    const info = await this.client().startRoomCompositeEgress(roomName, this.buildOutput(), {
      audioOnly: true,
    });
    this.logger.log(`Started egress ${info.egressId} for room ${roomName}`);
    return info.egressId;
  }

  /** Stop an in-flight recording. Failures are logged, never thrown. */
  async stopRecording(egressId: string): Promise<void> {
    try {
      await this.client().stopEgress(egressId);
    } catch (err) {
      this.logger.warn(`Failed to stop egress ${egressId}: ${(err as Error).message}`);
    }
  }

  /** Look up the state (and output URL once finished) of a recording. */
  async getRecording(egressId: string): Promise<RecordingLookup> {
    const list = await this.client().listEgress({ egressId });
    const info = list[0];
    if (!info) return { status: 'UNKNOWN' };

    switch (info.status) {
      case EgressStatus.EGRESS_COMPLETE:
        return { status: 'COMPLETE', url: info.fileResults?.[0]?.location ?? '' };
      case EgressStatus.EGRESS_FAILED:
      case EgressStatus.EGRESS_ABORTED:
      case EgressStatus.EGRESS_LIMIT_REACHED:
        return { status: 'FAILED', error: info.error };
      default:
        return { status: 'IN_PROGRESS' };
    }
  }
}
