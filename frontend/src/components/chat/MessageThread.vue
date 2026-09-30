<template>
  <div class="message-thread d-flex flex-column flex-grow-1">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="chat-header pa-3 d-flex align-center">
        <v-avatar size="42" color="grey-lighten-2" class="mr-3 chat-header-avatar">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" />
        </v-avatar>
        <div class="flex-grow-1 chat-header-info">
          <div class="chat-header-name font-weight-medium">{{ conversation.contact?.fullName || 'Unknown' }}</div>
          <div class="chat-header-status">{{ conversation.threadType === 'group' ? 'Nhóm trò chuyện' : 'Đang hoạt động' }}</div>
        </div>
        <v-btn
          :icon="showContactPanel ? 'mdi-account-details' : 'mdi-account-details-outline'"
          size="small" variant="text"
          :color="showContactPanel ? 'primary' : undefined"
          @click="$emit('toggle-contact-panel')"
        />
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-3 chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <div v-for="(msg, index) in messages" :key="msg.id" class="message-row d-flex" :class="[msg.senderType === 'self' ? 'justify-end' : 'justify-start', { 'message-grouped': isGroupedWithPrevious(msg, index) }]">
          <v-avatar v-if="msg.senderType !== 'self' && !isGroupedWithPrevious(msg, index)" size="32" color="grey-lighten-2" class="message-avatar mr-2">
            <v-img v-if="msg.senderAvatarUrl || (conversation.threadType !== 'group' && conversation.contact?.avatarUrl)" :src="msg.senderAvatarUrl || conversation.contact?.avatarUrl || ''" />
            <v-icon v-else-if="conversation.threadType === 'group'" size="18">mdi-account-group</v-icon>
            <v-icon v-else size="18">mdi-account</v-icon>
          </v-avatar>
          <div v-else-if="msg.senderType !== 'self'" class="message-avatar-spacer mr-2" />
          <div class="message-stack">
            <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self' && !isGroupedWithPrevious(msg, index)" class="message-sender mb-1">
              {{ msg.senderName || 'Unknown' }}
            </div>
            <div class="message-bubble" :class="msg.senderType === 'self' ? 'message-self' : 'message-contact'" @contextmenu.prevent.stop="openMessageMenu($event, msg)">
              <div v-if="msg.replyTo" class="message-reply-quote">
                <div class="message-reply-name">{{ replySenderName(msg.replyTo) }}</div>
                <div class="message-reply-content">{{ replyText(msg.replyTo) }}</div>
              </div>
              <!-- Deleted -->
              <div v-if="msg.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
                {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
              </div>
              <!-- Image -->
              <div v-else-if="getImageUrl(msg)">
                <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="previewImageUrl = getImageUrl(msg)!" />
              </div>
              <!-- File/PDF -->
              <div v-else-if="getFileInfo(msg)" class="file-card">
                <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
                <div class="flex-grow-1">
                  <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                  <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                </div>
                <v-btn v-if="getFileInfo(msg)!.href" icon size="x-small" variant="text" @click="openFile(getFileInfo(msg)!.href)">
                  <v-icon size="16">mdi-download</v-icon>
                </v-btn>
              </div>
              <!-- Location -->
              <div v-else-if="getLocationInfo(msg)" class="location-card" @click.stop="openLocation(getLocationInfo(msg)!.mapsUrl)">
                <v-icon size="28" color="error" class="mr-2">mdi-map-marker</v-icon>
                <div class="flex-grow-1">
                  <div class="text-body-2 font-weight-medium">{{ getLocationInfo(msg)!.title }}</div>
                  <div class="text-caption location-address">{{ getLocationInfo(msg)!.address }}</div>
                  <div class="text-caption location-coordinates">{{ getLocationInfo(msg)!.latitude.toFixed(6) }}, {{ getLocationInfo(msg)!.longitude.toFixed(6) }}</div>
                </div>
                <v-btn icon size="x-small" color="primary" variant="text" title="Mở trên bản đồ" @click.stop="openLocation(getLocationInfo(msg)!.mapsUrl)">
                  <v-icon size="18">mdi-open-in-new</v-icon>
                </v-btn>
              </div>
              <!-- Sticker/Video/Voice/GIF -->
              <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
              <div v-else-if="msg.contentType === 'video'">🎥 Video</div>
              <div v-else-if="msg.contentType === 'voice'">🎤 Tin nhắn thoại</div>
              <div v-else-if="msg.contentType === 'gif'">GIF</div>
              <!-- Reminder/Calendar -->
              <div v-else-if="isReminderMessage(msg)" class="reminder-card">
                <div class="d-flex align-center mb-1">
                  <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
                  <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
                </div>
                <div class="text-body-2">{{ getReminderTitle(msg) }}</div>
                <div v-if="getReminderTime(msg)" class="text-caption mt-1" style="opacity: 0.7;">
                  <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(msg) }}
                </div>
                <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="syncAppointment(msg)">
                  Đồng bộ lịch
                </v-btn>
              </div>
              <!-- Default text -->
              <div v-else>{{ parseDisplayContent(msg.content) }}</div>
              <!-- Timestamp -->
              <div class="msg-time mt-1" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'">
                {{ formatMessageTime(msg.sentAt) }}
              </div>
            </div>
            <div v-if="msg.senderType === 'self'" class="message-delivery-status">
              <v-icon size="12">mdi-check</v-icon> Đã gửi
            </div>
          </div>
        </div>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <div v-if="contextMenuMessage" class="message-context-menu" :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }" @click.stop>
        <v-list density="compact" class="py-1">
          <v-list-item prepend-icon="mdi-reply-outline" title="Trả lời tin nhắn" @click="startReply(contextMenuMessage)" />
          <v-list-item v-if="canDeleteMessages" prepend-icon="mdi-delete-outline" title="Xóa tin nhắn" base-color="error" @click="handleDeleteMessage(contextMenuMessage)" />
        </v-list>
      </div>

      <!-- AI Suggestions popup -->
      <div v-if="aiSuggestions.length > 0" class="ai-suggestions pa-2">
        <div class="d-flex align-center mb-1">
          <v-icon size="16" color="info" class="mr-1">mdi-robot-outline</v-icon>
          <span class="text-caption font-weight-bold" style="color: #00F2FF;">AI Gợi ý</span>
          <v-spacer />
          <span v-if="aiRemaining !== null" class="text-caption text-grey">Còn {{ aiRemaining }} lượt</span>
          <v-btn icon size="x-small" variant="text" @click="aiSuggestions = []"><v-icon size="14">mdi-close</v-icon></v-btn>
        </div>
        <div
          v-for="(s, idx) in aiSuggestions"
          :key="idx"
          class="ai-suggestion-card pa-2 px-3 mb-1 rounded-lg"
          @click="pickSuggestion(s.text)"
        >
          {{ s.text }}
        </div>
      </div>

      <!-- AI Error -->
      <v-alert v-if="aiError" type="warning" variant="tonal" density="compact" class="mx-2 mb-1" closable @click:close="aiError = ''">
        {{ aiError }}
      </v-alert>

      <div v-if="replyingTo" class="reply-preview mx-3 mb-1">
        <v-icon size="16" class="mr-2">mdi-reply-outline</v-icon>
        <div class="flex-grow-1 text-truncate">
          <div class="text-caption font-weight-medium">Trả lời {{ replyingTo.senderName || 'tin nhắn' }}</div>
          <div class="text-caption text-truncate">{{ replyText(replyingTo) }}</div>
        </div>
        <v-btn icon size="x-small" variant="text" @click="replyingTo = null"><v-icon size="15">mdi-close</v-icon></v-btn>
      </div>

      <!-- Attachment preview -->
      <div v-if="selectedImagePreview" class="attachment-preview mx-3 mb-1">
        <img :src="selectedImagePreview" alt="Ảnh sắp gửi" />
        <v-btn icon size="x-small" color="error" variant="flat" class="attachment-preview-remove" title="Bỏ ảnh" @click="clearSelectedFile">
          <v-icon size="14">mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Input -->
      <div class="pa-2 d-flex align-end chat-input-area">
        <input
          ref="fileInput"
          type="file"
          class="d-none"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          @change="handleFileSelect"
        />
        <v-btn
          icon
          size="small"
          variant="tonal"
          color="info"
          class="mr-2"
          :loading="aiLoading"
          :disabled="!conversation"
          title="AI Gợi ý trả lời"
          @click="fetchAISuggestions"
        >
          <v-icon>mdi-robot-outline</v-icon>
        </v-btn>
        <v-btn icon size="small" variant="tonal" color="info" class="mr-2" :disabled="!conversation" title="Gửi ảnh hoặc tệp" @click="fileInput?.click()"><v-icon>mdi-paperclip</v-icon></v-btn>
        <v-textarea v-model="inputText" placeholder="Nhập tin nhắn..." variant="solo-filled" density="compact" hide-details auto-grow rows="1" max-rows="3" @keydown.enter.exact.prevent="handleSend" @paste="handlePaste" class="flex-grow-1 mr-2" />
        <v-btn icon color="primary" :loading="sending" :disabled="!inputText.trim() && !selectedFile" @click="handleSend"><v-icon>mdi-send</v-icon></v-btn>
      </div>
    </template>

    <!-- Image preview dialog -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string, replyToMessageId?: string];
  'send-attachment': [file: File, caption: string, replyToMessageId?: string];
  'delete-message': [messageId: string];
  'toggle-contact-panel': [];
}>();

const authStore = useAuthStore();
const canDeleteMessages = computed(() => authStore.isAdmin);
const inputText = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const selectedImagePreview = ref('');
const replyingTo = ref<Message | null>(null);
const contextMenuMessage = ref<Message | null>(null);
const contextMenuPosition = ref({ x: 0, y: 0 });
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) previewImageUrl.value = ''; } });
const syncSnack = ref({ show: false, text: '', color: 'success' });

// AI Suggest state
const aiSuggestions = ref<{ text: string }[]>([]);
const aiLoading = ref(false);
const aiError = ref('');
const aiRemaining = ref<number | null>(null);

const acceptedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip']);

function setSelectedFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!acceptedExtensions.has(extension)) {
    syncSnack.value = { show: true, text: 'Chỉ hỗ trợ ảnh JPG/PNG/WEBP và tệp PDF, Word, Excel, CSV, TXT, ZIP', color: 'warning' };
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    syncSnack.value = { show: true, text: 'Tệp vượt quá giới hạn 25 MB', color: 'warning' };
    return;
  }
  clearSelectedFile();
  selectedFile.value = file;
  if (file.type.startsWith('image/')) {
    selectedImagePreview.value = URL.createObjectURL(file);
  }
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) setSelectedFile(file);
  input.value = '';
}

function handlePaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  const extension = file.type.split('/')[1] || 'png';
  setSelectedFile(new File([file], 'anh-da-dan-' + Date.now() + '.' + extension, { type: file.type }));
}

function clearSelectedFile() {
  if (selectedImagePreview.value) URL.revokeObjectURL(selectedImagePreview.value);
  selectedImagePreview.value = '';
  selectedFile.value = null;
}

function openMessageMenu(event: MouseEvent, message: Message) {
  contextMenuPosition.value = {
    x: Math.min(event.clientX, window.innerWidth - 210),
    y: Math.min(event.clientY, window.innerHeight - 110),
  };
  contextMenuMessage.value = message;
}

function closeMessageMenu() { contextMenuMessage.value = null; }

function startReply(message: Message) {
  replyingTo.value = message;
  closeMessageMenu();
  nextTick(() => document.querySelector<HTMLTextAreaElement>('.chat-input-area textarea')?.focus());
}

function replyText(message: Pick<Message, 'content' | 'contentType' | 'isDeleted'>) {
  if (message.isDeleted) return 'Tin nhắn đã bị xoá';
  if (message.contentType === 'image') return 'Hình ảnh';
  if (message.contentType === 'file') return 'Tệp đính kèm';
  const text = parseDisplayContent(message.content);
  return text.length > 100 ? text.slice(0, 100) + '…' : text;
}

function replySenderName(message: NonNullable<Message['replyTo']>) {
  return message.senderName || (message.senderType === 'self' ? 'Bạn' : 'Tin nhắn');
}

function isGroupedWithPrevious(message: Message, index: number) {
  if (index === 0) return false;
  const previous = props.messages[index - 1];
  if (message.senderType !== previous.senderType) return false;
  if (message.senderType !== 'self') {
    const sameSender = message.senderUid && previous.senderUid
      ? message.senderUid === previous.senderUid
      : message.senderName === previous.senderName;
    if (!sameSender) return false;
  }
  const gap = new Date(message.sentAt).getTime() - new Date(previous.sentAt).getTime();
  return gap >= 0 && gap <= 30 * 60 * 1000;
}

function handleDeleteMessage(message: Message) {
  closeMessageMenu();
  if (!window.confirm('Xóa tin nhắn này khỏi CRM? Tin nhắn trên Zalo sẽ không bị thu hồi.')) return;
  emit('delete-message', message.id);
}

function handleSend() {
  if (selectedFile.value) {
    emit('send-attachment', selectedFile.value, inputText.value, replyingTo.value?.id);
    clearSelectedFile();
  } else if (inputText.value.trim()) {
    emit('send', inputText.value, replyingTo.value?.id);
  } else {
    return;
  }
  inputText.value = '';
  aiSuggestions.value = [];
  replyingTo.value = null;
}

async function fetchAISuggestions() {
  if (!props.conversation?.id) return;
  aiLoading.value = true;
  aiError.value = '';
  aiSuggestions.value = [];
  try {
    const res = await api.post(`/conversations/${props.conversation.id}/ai-suggest`);
    aiSuggestions.value = res.data.suggestions || [];
    aiRemaining.value = res.data.remaining ?? null;
  } catch (err: any) {
    aiError.value = err.response?.data?.error || 'Không thể tạo gợi ý';
  } finally {
    aiLoading.value = false;
  }
}

function pickSuggestion(text: string) {
  inputText.value = text;
  aiSuggestions.value = [];
}
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function openFile(url: string) { window.open(url, '_blank'); }

/** Extract image URL from JSON content */
function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

/** Extract file info from JSON content (PDF, docs, etc.) */
function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (p.name && typeof p.size === 'number') {
      const bytes = p.size;
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return { name: p.name, size, href: p.href || '' };
    }
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size, href: p.href || '' };
    }
  } catch {}
  return null;
}

function getLocationInfo(msg: Message): { title: string; address: string; latitude: number; longitude: number; mapsUrl: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const payload = JSON.parse(msg.content);
    const params = typeof payload.params === 'string' ? JSON.parse(payload.params) : payload.params;
    const latitude = Number(params?.latitude);
    const longitude = Number(params?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const address = String(payload.description || payload.title || 'Vị trí được chia sẻ');
    return {
      title: payload.title || 'Vị trí đã chia sẻ',
      address,
      latitude,
      longitude,
      mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
    };
  } catch {
    return null;
  }
}

function openLocation(url: string) { window.open(url, '_blank', 'noopener,noreferrer'); }

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    if (p.title && p.href) return `🔗 ${p.title}`;
    if (p.title) return p.title;
    if (p.href) return `🔗 ${p.description || p.href}`;
    return content;
  } catch { return content; }
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
  return null;
}

/** Sync Zalo reminder to CRM appointments via API */
async function syncAppointment(msg: Message) {
  if (!props.conversation?.contact?.id) { syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' }; return; }
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; }
    }
    if (!appointmentDate) { syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' }; return; }
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate,
      appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      type: 'tai_kham',
      notes: `[Zalo] ${p.title || ''}`,
    });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
  } catch (err: any) {
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
  }
}

watch(() => props.messages.length, async () => { await nextTick(); if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; });
onMounted(() => document.addEventListener('click', closeMessageMenu));
onBeforeUnmount(() => {
  clearSelectedFile();
  document.removeEventListener('click', closeMessageMenu);
});
</script>

<style scoped>
.message-thread { height: 100%; min-width: 0; color: #172b4d; background: #eef0f4; }
.chat-header { z-index: 2; min-height: 66px; color: #172b4d; background: #fff; border-bottom: 1px solid #dfe3e8; box-shadow: 0 1px 2px rgba(28, 39, 54, 0.04); }
.chat-header-avatar { border: 1px solid #e0e4e9; }
.chat-header-info { min-width: 0; }
.chat-header-name { overflow: hidden; color: #172b4d; font-size: 0.96rem; text-overflow: ellipsis; white-space: nowrap; }
.chat-header-status { margin-top: 1px; color: #738197; font-size: 0.7rem; }
.chat-messages-area { padding: 18px 22px !important; background: #eef0f4; }
.message-row { align-items: flex-end; margin-bottom: 8px; }
.message-row.message-grouped { margin-top: -4px; margin-bottom: 4px; }
.message-avatar { flex-shrink: 0; margin-bottom: 2px; border: 1px solid #d9dee5; }
.message-avatar-spacer { flex: 0 0 32px; width: 32px; }
.message-stack { max-width: 66%; min-width: 0; }
.message-sender { padding-left: 12px; color: #5f6f86; font-size: 0.72rem; font-weight: 500; }
.message-bubble { padding: 9px 13px; overflow: hidden; color: #223553; font-size: 0.9rem; line-height: 1.42; word-wrap: break-word; border: 1px solid #d9dee5; border-radius: 8px; box-shadow: 0 1px 1px rgba(28, 39, 54, 0.07); }
.message-contact { background: #fff; }
.message-self { background: #d9efff; border-color: #c8e3f7; }
.message-reply-quote { margin-bottom: 8px; padding: 8px 10px; overflow: hidden; color: #365170; background: #c9def7; border-left: 3px solid #0068ff; border-radius: 3px; }
.message-reply-name { color: #263c5a; font-size: 0.75rem; font-weight: 600; }
.message-reply-content { margin-top: 2px; overflow: hidden; color: #536d89; font-size: 0.77rem; text-overflow: ellipsis; white-space: nowrap; }
.message-delivery-status { display: flex; align-items: center; justify-content: flex-end; gap: 2px; margin-top: 3px; color: #8793a3; font-size: 0.66rem; }
.msg-time { color: #6f7d91; font-size: 0.65rem; line-height: 1.2; }
.msg-time-self { text-align: right; }
.reminder-card { padding: 8px 12px; background: #fff8e8; border-left: 3px solid #f4ad37; border-radius: 6px; }
.file-card { display: flex; align-items: center; padding: 8px 10px; background: #f4f6f8; border: 1px solid #e0e5ea; border-radius: 7px; }
.location-card { display: flex; align-items: center; min-width: 250px; padding: 10px 12px; cursor: pointer; background: #fff7f6; border: 1px solid #f1d2cf; border-radius: 8px; }
.location-card:hover { background: #fff0ee; }
.location-address { margin-top: 2px; line-height: 1.35; opacity: 0.8; }
.location-coordinates { margin-top: 4px; opacity: 0.55; }
.chat-image { display: block; max-width: 100%; max-height: 300px; cursor: pointer; border-radius: 8px; transition: transform 0.2s; }
.chat-image:hover { transform: scale(1.01); }
.message-context-menu { position: fixed; z-index: 2500; min-width: 190px; overflow: hidden; color: #172b4d; background: #fff; border: 1px solid #dfe3e8; border-radius: 8px; box-shadow: 0 8px 24px rgba(28, 39, 54, 0.18); }
.message-context-menu :deep(.v-list) { color: #172b4d; background: #fff !important; }
.message-context-menu :deep(.v-list-item:hover) { background: #f2f6fa; }
.reply-preview { display: flex; align-items: center; max-width: 460px; padding: 7px 10px; color: #44546b; background: #f2f4f7; border-left: 3px solid #0068ff; border-radius: 4px; }
.attachment-preview { position: relative; width: fit-content; padding: 4px; background: #fff; border: 1px solid #d9dee5; border-radius: 8px; box-shadow: 0 1px 3px rgba(28, 39, 54, 0.1); }
.attachment-preview img { display: block; width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.attachment-preview-remove { position: absolute; top: -7px; right: -7px; min-width: 22px !important; width: 22px !important; height: 22px !important; }
.chat-input-area { flex-shrink: 0; padding: 9px 12px !important; background: #fff; border-top: 1px solid #dfe3e8; }
.chat-input-area :deep(.v-field) { color: #172b4d; background: #f1f3f5 !important; border-radius: 18px; box-shadow: none !important; }
.chat-input-area :deep(textarea) { color: #223553 !important; font-size: 0.9rem; }
.chat-input-area :deep(textarea::placeholder) { color: #8491a3; opacity: 1; }
.chat-input-area :deep(.v-btn) { box-shadow: none; }
.ai-suggestions { color: #172b4d; background: #fff; border-top: 1px solid #dfe3e8; }
.ai-suggestion-card { cursor: pointer; color: #33445e; background: #f5f8fb; border: 1px solid #dfe5eb; border-radius: 7px; font-size: 0.9rem; line-height: 1.4; transition: all 0.2s; }
.ai-suggestion-card:hover { background: #eaf3ff; border-color: #b8d7ff; transform: translateX(3px); }

@media (max-width: 900px) {
  .chat-messages-area { padding: 14px 12px !important; }
  .message-stack { max-width: 78%; }
}
</style>
