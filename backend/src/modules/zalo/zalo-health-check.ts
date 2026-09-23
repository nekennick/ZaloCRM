/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Listener reconnects are handled by zca-js itself, so healthy sessions are
 * never force-closed by this monitor.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export function startZaloHealthCheck(): void {
  // Every 5 minutes: check all accounts with saved sessions
  cron.schedule('*/5 * * * *', async () => {
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: { sessionData: { not: Prisma.JsonNull } },
        select: { id: true, displayName: true, sessionData: true },
      });

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);
        if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
          const session = acc.sessionData as any;
          if (session?.imei) {
            logger.info(`[health-check] Reconnecting ${acc.displayName || acc.id}...`);
            zaloPool.reconnect(acc.id, session).catch((err) => {
              logger.warn(`[health-check] Reconnect failed for ${acc.id}:`, err);
            });
          }
        }
      }
    } catch (err) {
      logger.error('[health-check] Error during health check:', err);
    }
  });

  logger.info('[health-check] Zalo health check started (every 5 min)');
}
