import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SystemInfoDto, systemInfoKeys } from './system-info.dto';

@Injectable()
export class SystemInfoService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(payload: SystemInfoDto) {
    const receivedAt = new Date();
    const collectedAt = new Date(payload.collectedAt);
    const age = receivedAt.getTime() - collectedAt.getTime();
    if (!Number.isFinite(age) || age < -300_000 || age > 86_400_000) {
      throw new BadRequestException('System information timestamp outside accepted window');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize snapshots with deletion and each other; the token alone selects ownership.
      const servers = await tx.$queryRaw<{ id: string; status: string; retiredAt: Date | null }[]>`
        SELECT "id", "status", "retiredAt" FROM "Server" WHERE "agentToken" = ${payload.agentToken} FOR UPDATE
      `;
      const server = servers[0];
      if (!server) throw new UnauthorizedException('Unknown agent token');
      if (server.retiredAt || ['DELETING', 'ERROR'].includes(server.status)) return { ok: true, ignored: true };
      const previous = await tx.serverSystemInfo.findUnique({ where: { serverId: server.id } });
      if (previous && previous.collectedAt >= collectedAt) return { ok: true, ignored: true };

      const fields = { ...((previous?.fields ?? {}) as Prisma.JsonObject) };
      const missingFields: string[] = [];
      for (const key of systemInfoKeys) {
        const raw = payload.values[key];
        const value = typeof raw === 'string' ? raw.trim() : raw;
        if (value == null || value === '') {
          missingFields.push(key);
        } else {
          // Preserve the timestamp of old values when an individual collector fails.
          fields[key] = { value, collectedAt: collectedAt.toISOString() };
        }
      }
      const data = {
        schemaVersion: payload.schemaVersion, agentVersion: payload.agentVersion,
        fields: fields as Prisma.InputJsonObject, missingFields, collectedAt, receivedAt,
      };
      await tx.serverSystemInfo.upsert({
        where: { serverId: server.id }, create: { serverId: server.id, ...data }, update: data,
      });
      return { ok: true };
    });
  }
}
