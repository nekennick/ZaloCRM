<template>
  <div class="conversation-list d-flex flex-column">
    <!-- Account filter + Search -->
    <div class="conversation-toolbar pa-3">
      <v-select
        v-model="selectedAccountId"
        :items="accountOptions"
        item-title="text"
        item-value="value"
        label="Tất cả Zalo"
        density="compact"
        variant="solo-filled"
        hide-details
        clearable
        class="conversation-filter mb-2"
        @update:model-value="$emit('filter-account', $event)"
      />
      <v-text-field
        :model-value="search"
        @update:model-value="$emit('update:search', $event)"
        placeholder="Tìm kiếm..."
        prepend-inner-icon="mdi-magnify"
        variant="solo-filled"
        density="compact"
        hide-details
        clearable
        class="conversation-search"
      />
    </div>

    <!-- List -->
    <v-list class="conversation-items flex-grow-1 overflow-y-auto pa-0" density="compact">
      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <v-list-item
        v-for="conv in conversations"
        :key="conv.id"
        :active="conv.id === selectedId"
        @click="$emit('select', conv.id)"
        class="conversation-item"
        :class="{ 'conversation-active': conv.id === selectedId, 'conversation-unread': conv.unreadCount > 0 && conv.id !== selectedId }"
      >
        <template #prepend>
          <v-avatar size="48" color="grey-lighten-2" class="conversation-avatar">
            <v-icon v-if="conv.threadType === 'group'" icon="mdi-account-group" />
            <v-img v-else-if="conv.contact?.avatarUrl" :src="conv.contact.avatarUrl" />
            <v-icon v-else icon="mdi-account" />
          </v-avatar>
        </template>

        <v-list-item-title class="conversation-title d-flex align-center">
          <span class="conversation-name text-truncate" :class="{ 'font-weight-bold': conv.unreadCount > 0 }">
            {{ conv.threadType === 'group' ? (conv.contact?.fullName || 'Nhóm') : (conv.contact?.fullName || 'Unknown') }}
          </span>
          <v-icon v-if="conv.threadType === 'group'" size="14" class="group-indicator ml-1">mdi-account-multiple</v-icon>
          <v-spacer />
          <span class="conversation-time text-grey ml-1">{{ formatTime(conv.lastMessageAt) }}</span>
        </v-list-item-title>

        <v-list-item-subtitle class="conversation-subtitle d-flex align-center">
          <span class="conversation-preview text-truncate" :class="{ 'font-weight-medium': conv.unreadCount > 0 }">
            {{ lastMessagePreview(conv) }}
          </span>
          <v-spacer />
          <v-badge
            v-if="conv.unreadCount > 0"
            :content="conv.unreadCount"
            color="error"
            inline
          />
        </v-list-item-subtitle>
      </v-list-item>

      <div v-if="!loading && conversations.length === 0" class="text-center pa-8 text-grey">
        Chưa có cuộc trò chuyện nào
      </div>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import { api } from '@/api/index';

defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
}>();

defineEmits<{
  select: [id: string];
  'update:search': [value: string];
  'filter-account': [accountId: string | null];
}>();

const accountOptions = ref<{ text: string; value: string }[]>([]);
const selectedAccountId = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
    accountOptions.value = accounts.map((a: any) => ({
      text: a.displayName || a.zaloUid || a.id,
      value: a.id,
    }));
  } catch {
    // Non-critical — filter just won't show accounts
  }
});

function lastMessagePreview(conv: Conversation): string {
  const msg = conv.messages?.[0];
  if (!msg) return '';
  if (msg.isDeleted) return '(đã thu hồi)';
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';

  switch (msg.contentType) {
    case 'image': return prefix + '📷 Hình ảnh';
    case 'sticker': return prefix + '🏷️ Sticker';
    case 'video': return prefix + '🎥 Video';
    case 'voice': return prefix + '🎤 Tin nhắn thoại';
    case 'gif': return prefix + 'GIF';
    case 'file': return prefix + '📎 Tệp đính kèm';
    case 'link': return prefix + '🔗 Liên kết';
  }

  // Reminder/calendar messages
  if (msg.content) {
    try {
      const p = JSON.parse(msg.content);
      if (p.action === 'msginfo.actionlist' && p.title) {
        return prefix + '📅 ' + p.title.slice(0, 50);
      }
    } catch { /* not JSON */ }
  }

  const text = msg.content || '';
  return prefix + (text.length > 50 ? text.slice(0, 50) + '...' : text);
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays} ngày`;

  return date.toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.conversation-list {
  width: 100%;
  height: 100%;
  color: #172b4d;
  background: #fff;
  border-right: 1px solid #dfe3e8;
}

.conversation-toolbar {
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid #edf0f3;
}

.conversation-items {
  color: #172b4d;
  background: #fff !important;
}

.conversation-item {
  min-height: 72px;
  margin: 3px 7px;
  padding: 8px 10px !important;
  border-radius: 7px;
  color: #172b4d;
  transition: background-color 0.15s ease;
}

.conversation-item:hover { background: #f3f6f9 !important; }
.conversation-active { background: #e5f1ff !important; }
.conversation-unread:not(.conversation-active) { background: #f7fbff !important; }
.conversation-avatar { border: 1px solid #e1e5ea; }
.conversation-title { min-width: 0; line-height: 1.35; }
.conversation-name { min-width: 0; color: #172b4d; font-size: 0.92rem; font-weight: 500; }
.group-indicator { flex-shrink: 0; color: #667892; }

.conversation-time {
  flex-shrink: 0;
  color: #667892 !important;
  font-size: 0.68rem;
  font-weight: 400;
}

.conversation-subtitle { min-width: 0; margin-top: 4px; color: #667892 !important; opacity: 1 !important; }
.conversation-preview { max-width: calc(100% - 28px); color: #667892; font-size: 0.79rem; }

:deep(.conversation-item .v-list-item__prepend) { margin-right: 12px; }
:deep(.conversation-item .v-list-item__content) { min-width: 0; }
:deep(.conversation-toolbar .v-field) { color: #172b4d; background: #f2f4f7 !important; border-radius: 8px; box-shadow: none !important; }
:deep(.conversation-toolbar .v-field__input),
:deep(.conversation-toolbar .v-label),
:deep(.conversation-toolbar .v-icon) { color: #53657d !important; }
:deep(.conversation-item .v-badge__badge) { min-width: 20px; height: 20px; padding: 0 6px; color: #fff; background: #e84b55 !important; font-size: 0.67rem; box-shadow: 0 0 0 2px #fff; }
</style>
