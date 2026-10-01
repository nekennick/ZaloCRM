<template>
  <div class="project-updates-page pa-4 pa-md-6">
    <div class="d-flex align-center mb-5">
      <div>
        <h1 class="text-h5 font-weight-bold">Cập nhật dự án</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">Lịch sử các cập nhật mới nhất.</p>
      </div>
      <v-spacer />
      <v-btn icon="mdi-refresh" variant="text" :loading="loading" aria-label="Tải lại" @click="fetchUpdates" />
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-card rounded="lg" border elevation="0">
      <v-list v-if="updates.length" lines="two" class="py-0">
        <template v-for="(update, index) in updates" :key="update.id">
          <v-list-item class="py-3">
            <template #prepend>
              <v-avatar color="primary" variant="tonal" size="38">
                <v-icon icon="mdi-source-commit" />
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-medium text-wrap">{{ update.title }}</v-list-item-title>
            <v-list-item-subtitle class="mt-1 text-wrap">
              {{ update.authorName || 'GitHub' }} · {{ formatDateTime(update.publishedAt) }}
            </v-list-item-subtitle>
            <template #append>
              <code class="commit-code">{{ update.version || update.sourceKey?.slice(0, 7) }}</code>
            </template>
          </v-list-item>
          <v-divider v-if="index < updates.length - 1" />
        </template>
      </v-list>
      <div v-else-if="!loading" class="py-12 text-center text-medium-emphasis">
        Chưa có bản cập nhật nào để hiển thị.
      </div>
      <div v-else class="py-12 text-center"><v-progress-circular indeterminate color="primary" /></div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api/index';

interface ProjectUpdate {
  id: string;
  title: string;
  version?: string | null;
  authorName?: string | null;
  sourceKey?: string | null;
  publishedAt: string;
}

const updates = ref<ProjectUpdate[]>([]);
const loading = ref(false);
const error = ref('');

async function fetchUpdates() {
  loading.value = true;
  error.value = '';
  try {
    const response = await api.get('/project-updates');
    updates.value = response.data.updates || [];
  } catch {
    error.value = 'Không thể tải lịch sử cập nhật. Vui lòng thử lại.';
  } finally {
    loading.value = false;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

onMounted(fetchUpdates);
</script>

<style scoped>
.project-updates-page {
  width: 100%;
  min-height: calc(100vh - 64px);
  max-width: 980px;
  margin: 0 auto;
  box-sizing: border-box;
}

.commit-code {
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: 12px;
}
</style>
