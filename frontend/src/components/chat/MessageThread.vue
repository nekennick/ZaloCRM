<template>
  <div class="message-thread d-flex flex-column flex-grow-1" style="height: 100%;">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid var(--border-glow, rgba(0,242,255,0.1));">
        <v-avatar size="36" color="grey-lighten-2" class="mr-3">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" />
        </v-avatar>
        <div class="flex-grow-1">
          <div class="font-weight-medium">{{ conversation.contact?.fullName || 'Unknown' }}</div>
          <div class="text-caption text-grey">{{ conversation.zaloAccount?.displayName || 'Zalo' }}</div>
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
        <div v-for="msg in messages" :key="msg.id" class="mb-2 d-flex" :class="msg.senderType === 'self' ? 'justify-end' : 'justify-start'">
          <div style="max-width: 70%;">
            <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1" style="color: #00F2FF; font-weight: 500;">
              {{ msg.senderName || 'Unknown' }}
            </div>
            <div class="message-bubble pa-2 px-3 rounded-lg" :class="msg.senderType === 'self' ? 'bg-primary text-white' : 'bg-white'" style="word-wrap: break-word;">
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
              <div class="text-caption mt-1 msg-time" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                {{ formatMessageTime(msg.sentAt) }}
              </div>
            </div>
          </div>
        </div>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
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
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  'send-attachment': [file: File, caption: string];
  'toggle-contact-panel': [];
}>();

const inputText = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const selectedImagePreview = ref('');
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

function handleSend() {
  if (selectedFile.value) {
    emit('send-attachment', selectedFile.value, inputText.value);
    clearSelectedFile();
  } else if (inputText.value.trim()) {
    emit('send', inputText.value);
  } else {
    return;
  }
  inputText.value = '';
  aiSuggestions.value = [];
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
onBeforeUnmount(clearSelectedFile);
</script>

<style scoped>
.message-bubble { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.reminder-card { padding: 8px 12px; border-left: 3px solid #FFB74D; border-radius: 8px; background: rgba(255, 183, 77, 0.08); }
.file-card { display: flex; align-items: center; padding: 8px 12px; border-radius: 8px; background: rgba(0, 242, 255, 0.05); border: 1px solid rgba(0, 242, 255, 0.1); }
.chat-image { max-width: 100%; max-height: 300px; border-radius: 12px; cursor: pointer; transition: transform 0.2s; }
.chat-image:hover { transform: scale(1.02); }
.attachment-preview { position: relative; width: fit-content; padding: 4px; border-radius: 10px; background: rgba(0, 242, 255, 0.08); border: 1px solid rgba(0, 242, 255, 0.28); }
.attachment-preview img { display: block; width: 72px; height: 72px; object-fit: cover; border-radius: 7px; }
.attachment-preview-remove { position: absolute; top: -7px; right: -7px; min-width: 22px !important; width: 22px !important; height: 22px !important; }

/* AI Suggestions */
.ai-suggestions {
  border-top: 1px solid rgba(0, 242, 255, 0.15);
  background: rgba(0, 242, 255, 0.03);
}
.ai-suggestion-card {
  cursor: pointer;
  border: 1px solid rgba(0, 242, 255, 0.12);
  background: rgba(0, 242, 255, 0.06);
  transition: all 0.2s;
  font-size: 0.9rem;
  line-height: 1.4;
}
.ai-suggestion-card:hover {
  background: rgba(0, 242, 255, 0.15);
  border-color: rgba(0, 242, 255, 0.3);
  transform: translateX(4px);
}
</style>
