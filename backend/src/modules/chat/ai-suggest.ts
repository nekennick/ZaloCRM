/**
 * ai-suggest.ts — AI Copilot service using Kimi 2.5 (Moonshot AI).
 * Generates reply suggestions for customer service agents.
 * 
 * - Uses OpenAI-compatible API at https://api.moonshot.ai/v1
 * - System Prompt is stored in DB (AppSetting) and editable from Settings UI
 * - Rate limited to N suggestions/day per org
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

const DEFAULT_SYSTEM_PROMPT = `Bạn là trợ lý bán hàng chuyên nghiệp của một cửa hàng bán sản phẩm "Muối sấy Ngọc Yến" — sản phẩm muối sấy dùng để chấm trái cây và nấu ăn.

QUY TẮC:
- Trả lời bằng tiếng Việt, thân thiện, ngắn gọn, chuyên nghiệp.
- Gọi khách là "anh/chị" hoặc "mình".
- Tư vấn nhiệt tình về sản phẩm muối sấy Ngọc Yến.
- Nếu khách hỏi giá, hướng dẫn họ liên hệ để biết giá mới nhất hoặc giá sỉ.
- Không bịa thông tin mà bạn không biết.
- Mỗi câu trả lời tối đa 2-3 câu, rất ngắn gọn phù hợp tin nhắn Zalo.

ĐẶC ĐIỂM SẢN PHẨM:
- Muối sấy Ngọc Yến: Dùng chấm trái cây (xoài, ổi, mận, khế...) và nấu ăn.
- Hương vị đặc trưng, thơm ngon, an toàn vệ sinh thực phẩm.
- Có thể mua lẻ hoặc sỉ.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AISuggestion {
  text: string;
}

/**
 * Get the system prompt — from DB if customised, else default.
 */
async function getSystemPrompt(orgId: string): Promise<string> {
  try {
    const setting = await prisma.appSetting.findFirst({
      where: { orgId, settingKey: 'ai_system_prompt' },
      select: { valuePlain: true },
    });
    if (setting?.valuePlain) return setting.valuePlain;
  } catch {
    // Fallback to default
  }
  return DEFAULT_SYSTEM_PROMPT;
}

/**
 * Check daily usage limit for AI suggestions.
 * Returns { allowed, remaining, limit }.
 */
async function checkDailyLimit(orgId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = config.aiSuggestDailyLimit;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // We track usage via a special AppSetting key
  const key = `ai_suggest_count_${todayStart.toISOString().split('T')[0]}`;
  const record = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: key },
    select: { valuePlain: true },
  });

  const used = parseInt(record?.valuePlain || '0');
  return { allowed: used < limit, remaining: Math.max(0, limit - used), limit };
}

/**
 * Increment the daily usage counter.
 */
async function incrementDailyUsage(orgId: string): Promise<void> {
  const todayKey = `ai_suggest_count_${new Date().toISOString().split('T')[0]}`;

  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: todayKey } },
    update: {
      valuePlain: String(
        parseInt(
          (await prisma.appSetting.findFirst({
            where: { orgId, settingKey: todayKey },
            select: { valuePlain: true },
          }))?.valuePlain || '0',
        ) + 1,
      ),
    },
    create: {
      orgId,
      settingKey: todayKey,
      valuePlain: '1',
    },
  });
}

/**
 * Generate AI reply suggestions for a conversation.
 */
export async function generateSuggestions(
  conversationId: string,
  orgId: string,
): Promise<{ suggestions: AISuggestion[]; remaining: number }> {
  // 1. Check API key
  if (!config.moonshotApiKey) {
    throw new Error('MOONSHOT_API_KEY chưa được cấu hình');
  }

  // 2. Check daily limit
  const usage = await checkDailyLimit(orgId);
  if (!usage.allowed) {
    throw new Error(`Đã hết lượt gợi ý hôm nay (${usage.limit}/${usage.limit}). Thử lại vào ngày mai.`);
  }

  // 3. Fetch recent messages (last 20)
  const recentMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: 'desc' },
    take: 20,
    select: {
      content: true,
      contentType: true,
      senderType: true,
      senderName: true,
      sentAt: true,
      isDeleted: true,
    },
  });

  if (recentMessages.length === 0) {
    throw new Error('Chưa có tin nhắn nào trong cuộc trò chuyện này.');
  }

  // 4. Fetch contact info for context
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      contact: {
        select: { fullName: true, phone: true, status: true, notes: true, tags: true },
      },
    },
  });

  // 5. Build system prompt
  const systemPrompt = await getSystemPrompt(orgId);

  // Add contact context
  let contextBlock = '';
  if (conversation?.contact) {
    const c = conversation.contact;
    const parts: string[] = [];
    if (c.fullName) parts.push(`Tên khách: ${c.fullName}`);
    if (c.phone) parts.push(`SĐT: ${c.phone}`);
    if (c.status) parts.push(`Trạng thái CRM: ${c.status}`);
    if (c.notes) parts.push(`Ghi chú: ${c.notes}`);
    if (c.tags && Array.isArray(c.tags) && (c.tags as string[]).length > 0) {
      parts.push(`Tags: ${(c.tags as string[]).join(', ')}`);
    }
    if (parts.length > 0) {
      contextBlock = `\n\nTHÔNG TIN KHÁCH HÀNG:\n${parts.join('\n')}`;
    }
  }

  const fullSystemPrompt = systemPrompt + contextBlock +
    '\n\nYÊU CẦU: Hãy đưa ra đúng 2 gợi ý câu trả lời. Trả lời dạng JSON array: ["gợi ý 1", "gợi ý 2"]. Chỉ trả JSON, không giải thích thêm.';

  // 6. Build messages array (oldest first)
  const chatMessages: ChatMessage[] = [{ role: 'system', content: fullSystemPrompt }];

  for (const msg of recentMessages.reverse()) {
    if (msg.isDeleted) continue;
    const role: 'user' | 'assistant' = msg.senderType === 'self' ? 'assistant' : 'user';
    let content = msg.content || '';

    // Non-text content — describe it
    if (msg.contentType !== 'text' && msg.contentType) {
      const typeMap: Record<string, string> = {
        image: '[Khách gửi hình ảnh]',
        sticker: '[Khách gửi sticker]',
        video: '[Khách gửi video]',
        voice: '[Khách gửi tin nhắn thoại]',
        file: '[Khách gửi tệp đính kèm]',
        gif: '[Khách gửi GIF]',
        link: '[Khách gửi liên kết]',
      };
      if (typeMap[msg.contentType]) content = typeMap[msg.contentType];
    }

    if (content) chatMessages.push({ role, content });
  }

  // 7. Call Moonshot API
  logger.info(`[ai-suggest] Calling Kimi 2.5 for conversation ${conversationId} (${chatMessages.length - 1} messages)`);

  const response = await fetch(`${MOONSHOT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.moonshotApiKey}`,
    },
    body: JSON.stringify({
      model: config.moonshotModel,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`[ai-suggest] Moonshot API error ${response.status}: ${errorBody}`);
    throw new Error(`AI API lỗi (${response.status}). Vui lòng thử lại sau.`);
  }

  const data = await response.json() as {
    choices: { message: { content: string } }[];
  };

  const raw = data.choices?.[0]?.message?.content || '';

  // 8. Parse JSON response
  let suggestions: AISuggestion[] = [];
  try {
    // Try to extract JSON array from response (handle markdown code blocks)
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as string[];
      suggestions = parsed
        .filter((s) => typeof s === 'string' && s.trim())
        .slice(0, 2)
        .map((text) => ({ text: text.trim() }));
    }
  } catch {
    // If JSON parse fails, split by newline and take first 2 non-empty lines
    logger.warn('[ai-suggest] Failed to parse JSON, falling back to text split');
    suggestions = raw
      .split('\n')
      .map((s) => s.replace(/^\d+[\.\)]\s*/, '').replace(/^["']|["']$/g, '').trim())
      .filter((s) => s.length > 0)
      .slice(0, 2)
      .map((text) => ({ text }));
  }

  if (suggestions.length === 0) {
    throw new Error('AI không thể tạo gợi ý. Vui lòng thử lại.');
  }

  // 9. Increment usage counter
  await incrementDailyUsage(orgId);
  const updatedUsage = await checkDailyLimit(orgId);

  logger.info(`[ai-suggest] Generated ${suggestions.length} suggestions, remaining: ${updatedUsage.remaining}`);

  return { suggestions, remaining: updatedUsage.remaining };
}

/**
 * Save custom system prompt to DB.
 */
export async function saveSystemPrompt(orgId: string, prompt: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: 'ai_system_prompt' } },
    update: { valuePlain: prompt },
    create: { orgId, settingKey: 'ai_system_prompt', valuePlain: prompt },
  });
}

/**
 * Get the current system prompt (for Settings UI).
 */
export async function getSystemPromptForUI(orgId: string): Promise<{ prompt: string; isDefault: boolean }> {
  const setting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'ai_system_prompt' },
    select: { valuePlain: true },
  });
  if (setting?.valuePlain) {
    return { prompt: setting.valuePlain, isDefault: false };
  }
  return { prompt: DEFAULT_SYSTEM_PROMPT, isDefault: true };
}
