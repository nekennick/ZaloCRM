/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
}

const GITHUB_REPOSITORY = 'nekennick/ZaloCRM';
const GITHUB_COMMITS_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits?per_page=20`;
let githubCommitCache: Array<{ sha: string; title: string; description: string; authorName: string; publishedAt: Date }> = [];
let githubCommitCacheAt = 0;

async function syncGitHubProjectUpdates(orgId: string): Promise<void> {
  const cacheValid = Date.now() - githubCommitCacheAt < 10 * 60 * 1000;
  if (!cacheValid) {
    try {
      const response = await fetch(GITHUB_COMMITS_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YagamiCRM' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const commits = await response.json() as Array<any>;
      githubCommitCache = commits.map((commit) => {
        const lines = String(commit.commit?.message || 'Cập nhật dự án').split('\n');
        const authorName = commit.commit?.author?.name || commit.author?.login || 'GitHub';
        return {
          sha: String(commit.sha),
          title: lines[0] || 'Cập nhật dự án',
          description: lines.slice(1).join(' ').trim() || `GitHub · ${commit.commit?.author?.name || 'YagamiCRM'}`,
          authorName,
          publishedAt: new Date(commit.commit?.author?.date || Date.now()),
        };
      });
      githubCommitCacheAt = Date.now();
    } catch {
      // GitHub may be temporarily unavailable; use the last cached/stored updates instead.
    }
  }

  for (const commit of githubCommitCache) {
    const existing = await prisma.projectUpdate.findFirst({
      where: { orgId, sourceKey: commit.sha },
      select: { id: true },
    });
    const data = {
      title: commit.title,
      description: commit.description,
      version: commit.sha.slice(0, 7),
      authorName: commit.authorName,
      publishedAt: commit.publishedAt,
    };
    if (existing) {
      await prisma.projectUpdate.update({ where: { id: existing.id }, data });
    } else {
      await prisma.projectUpdate.create({
        data: { orgId, sourceKey: commit.sha, ...data },
      });
    }
  }
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications/settings', async (request) => {
    const user = request.user!;
    const setting = await prisma.appSetting.findFirst({
      where: { orgId: user.orgId, settingKey: 'notify_unreplied_conversations_enabled' },
      select: { valuePlain: true },
    });
    return { unrepliedConversationsEnabled: setting?.valuePlain !== 'false' };
  });

  app.put('/api/v1/notifications/settings', { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
    const user = request.user!;
    const { unrepliedConversationsEnabled } = request.body as { unrepliedConversationsEnabled?: boolean };
    if (typeof unrepliedConversationsEnabled !== 'boolean') {
      return reply.status(400).send({ error: 'Giá trị cài đặt không hợp lệ' });
    }
    await prisma.appSetting.upsert({
      where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'notify_unreplied_conversations_enabled' } },
      create: { orgId: user.orgId, settingKey: 'notify_unreplied_conversations_enabled', valuePlain: String(unrepliedConversationsEnabled) },
      update: { valuePlain: String(unrepliedConversationsEnabled) },
    });
    (app as any).io?.emit('notifications:updated', { orgId: user.orgId });
    return { unrepliedConversationsEnabled };
  });

  app.post('/api/v1/notifications/project-updates/:id/read', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const update = await prisma.projectUpdate.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
    if (!update) return reply.status(404).send({ error: 'Không tìm thấy bản cập nhật' });
    await prisma.projectUpdateRead.upsert({
      where: { projectUpdateId_userId: { projectUpdateId: id, userId: user.id } },
      create: { projectUpdateId: id, userId: user.id },
      update: {},
    });
    return { success: true };
  });

  app.get('/api/v1/project-updates', async (request) => {
    const user = request.user!;
    await syncGitHubProjectUpdates(user.orgId);
    const updates = await prisma.projectUpdate.findMany({
      where: { orgId: user.orgId, sourceKey: { not: null } },
      select: { id: true, title: true, version: true, authorName: true, sourceKey: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    return { repository: GITHUB_REPOSITORY, updates };
  });

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    await syncGitHubProjectUpdates(user.orgId);

    // 1. Unreplied conversations > 30 min (can be disabled from Settings)
    const notificationSetting = await prisma.appSetting.findFirst({
      where: { orgId: user.orgId, settingKey: 'notify_unreplied_conversations_enabled' },
      select: { valuePlain: true },
    });
    if (notificationSetting?.valuePlain !== 'false') {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
      const unreplied = await prisma.conversation.count({
        where: { orgId: user.orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
      });
      if (unreplied > 0) {
        notifications.push({
          id: 'unreplied',
          type: 'warning',
          priority: 'high',
          title: `${unreplied} cuộc trò chuyện chưa trả lời`,
          detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 2. Unread project updates for this user
    const projectUpdates = await prisma.projectUpdate.findMany({
      where: { orgId: user.orgId, sourceKey: { not: null }, reads: { none: { userId: user.id } } },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });
    for (const update of projectUpdates) {
      notifications.push({
        id: `project-update-${update.id}`,
        type: 'info',
        priority: 'low',
        title: update.version ? `${update.title} · ${update.version}` : update.title,
        detail: update.description,
        createdAt: update.publishedAt.toISOString(),
      });
    }

    // 3. Today's appointments
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayApts = await prisma.appointment.findMany({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: todayStart, lt: todayEnd },
        status: 'scheduled',
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const apt of todayApts) {
      notifications.push({
        id: `apt-${apt.id}`,
        type: 'info',
        priority: 'medium',
        title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
        createdAt: apt.appointmentDate.toISOString(),
      });
    }

    // 4. Tomorrow's appointments
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const tmrApts = await prisma.appointment.count({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: 'scheduled',
      },
    });
    if (tmrApts > 0) {
      notifications.push({
        id: 'tmr-apts',
        type: 'info',
        priority: 'low',
        title: `${tmrApts} lịch hẹn ngày mai`,
        detail: 'Chuẩn bị cho ngày mai',
        createdAt: new Date().toISOString(),
      });
    }

    // 5. Disconnected Zalo accounts
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: { id: true, displayName: true },
    });
    for (const acc of accounts) {
      const status = zaloPool.getStatus(acc.id);
      if (status !== 'connected') {
        notifications.push({
          id: `zalo-${acc.id}`,
          type: 'error',
          priority: 'high',
          title: `Zalo "${acc.displayName}" mất kết nối`,
          detail: `Trạng thái: ${status}`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { notifications };
  });
}
