/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/index.js';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '' } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (accountId) where.zaloAccountId = accountId;
    if (search) {
      where.contact = {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      where.zaloAccountId = { in: accessibleAccounts.map((a) => a.zaloAccountId) };
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.conversation.count({ where }),
    ]);

    return { conversations, total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      await instance.api.sendMessage({ msg: content }, threadId, threadType);

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content,
          contentType: 'text',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  app.post('/api/v1/conversations/:id/attachments', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const upload = await request.file();
    if (!upload) return reply.status(400).send({ error: 'Chưa chọn tệp để gửi' });

    const originalName = path.basename(upload.filename || 'file').replace(/[^\w.() -]/g, '_');
    const extension = path.extname(originalName).slice(1).toLowerCase();
    const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip']);
    if (!extension || !allowedExtensions.has(extension)) {
      return reply.status(400).send({ error: 'Chỉ hỗ trợ ảnh JPG/PNG/WEBP và tệp PDF, Word, Excel, CSV, TXT, ZIP' });
    }

    const buffer = await upload.toBuffer();
    if (!buffer.length) return reply.status(400).send({ error: 'Tệp rỗng' });
    if (upload.file.truncated) return reply.status(413).send({ error: 'Tệp vượt quá giới hạn 25 MB' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    const storageDir = path.join(config.uploadDir, 'chat');
    const storageName = randomUUID() + '.' + extension;
    const storagePath = path.join(storageDir, storageName);
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(extension);
    const caption = String((upload.fields?.caption as any)?.value || '').trim();

    try {
      await fs.mkdir(storageDir, { recursive: true });
      await fs.writeFile(storagePath, buffer);
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      await instance.api.sendMessage({
        msg: caption,
        attachments: { data: buffer, filename: originalName, metadata: { totalSize: buffer.length } },
      }, conversation.externalThreadId || '', threadType);

      const attachment = {
        name: originalName,
        size: buffer.length,
        href: '/uploads/chat/' + storageName,
        mimeType: upload.mimetype,
      };
      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: JSON.stringify(attachment),
          contentType: isImage ? 'image' : 'file',
          attachments: [attachment],
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });
      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });
      return message;
    } catch (err) {
      await fs.unlink(storagePath).catch(() => {});
      logger.error('[chat] Send attachment error:', err);
      return reply.status(500).send({ error: 'Không thể gửi tệp qua Zalo' });
    }
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });

  // ── AI Suggest — generate reply suggestions ─────────────────────────────
  app.post('/api/v1/conversations/:id/ai-suggest', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    try {
      const { generateSuggestions } = await import('./ai-suggest.js');
      const result = await generateSuggestions(id, user.orgId);
      return result;
    } catch (err: any) {
      logger.error('[chat] AI suggest error:', err);
      return reply.status(400).send({ error: err.message || 'AI gợi ý thất bại' });
    }
  });

  // ── AI System Prompt — get current prompt ───────────────────────────────
  app.get('/api/v1/ai/prompt', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const { getSystemPromptForUI } = await import('./ai-suggest.js');
      return await getSystemPromptForUI(user.orgId);
    } catch (err: any) {
      logger.error('[chat] Get AI prompt error:', err);
      return reply.status(500).send({ error: 'Lỗi lấy prompt' });
    }
  });

  // ── AI System Prompt — save/update prompt ───────────────────────────────
  app.put('/api/v1/ai/prompt', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (user.role !== 'owner' && user.role !== 'admin') {
      return reply.status(403).send({ error: 'Chỉ Admin/Owner mới được chỉnh sửa prompt' });
    }
    const { prompt } = request.body as { prompt: string };
    if (!prompt?.trim()) return reply.status(400).send({ error: 'Prompt không được rỗng' });

    try {
      const { saveSystemPrompt } = await import('./ai-suggest.js');
      await saveSystemPrompt(user.orgId, prompt.trim());
      return { success: true };
    } catch (err: any) {
      logger.error('[chat] Save AI prompt error:', err);
      return reply.status(500).send({ error: 'Lỗi lưu prompt' });
    }
  });
}
