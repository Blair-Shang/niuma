<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsButton, RsDialog, RsMarkdown } from '@niuma/ui'
import { useAppUpdateStore } from '@/stores/app-update'
import { useBridgeStore } from '@/stores/bridge'

const { t, te } = useI18n()
const store = useAppUpdateStore()
const bridge = useBridgeStore()

const title = computed(() => {
  if (store.phase === 'idle' && store.dialogOpen && !store.latest) {
    return t('appUpdate.titleLatest')
  }
  if (store.latest) {
    return t('appUpdate.titleAvailable', { version: store.latest.version })
  }
  return t('appUpdate.titleCheck')
})

const errorText = computed(() => {
  const code = store.error?.trim()
  if (!code) return ''
  const key = `appUpdate.errors.${code}`
  if (te(key)) return t(key)
  return code
})

const canDismiss = computed(() => !store.forceUpdate)

function onOpenChange(open: boolean) {
  if (!open) {
    if (!canDismiss.value) return
    store.closeDialog()
    return
  }
  store.openDialog()
}
</script>

<template>
  <div id="nm-update-portal" class="nm-update-shell">
    <RsDialog
      :open="store.dialogOpen"
      :title="title"
      width="md"
      layout="confirm"
      teleport-to="#nm-update-portal"
      :resizable="false"
      :draggable="false"
      :fullscreenable="false"
      :show-overlay="false"
      :show-close="canDismiss"
      :close-on-overlay-click="false"
      @update:open="onOpenChange"
    >
      <template #body>
        <div class="nm-update">
          <p v-if="store.phase === 'idle' && !store.latest" class="nm-update__meta">
            {{ t('appUpdate.upToDate', { version: bridge.shellVersion || '—' }) }}
          </p>
          <template v-else-if="store.latest">
            <p class="nm-update__meta">
              {{
                t('appUpdate.versionCompare', {
                  current: bridge.shellVersion || '—',
                  latest: store.latest.version,
                })
              }}
              <span v-if="store.forceUpdate" class="nm-update__force">
                · {{ t('appUpdate.forceHint') }}
              </span>
            </p>
            <h3 v-if="store.latest.title" class="nm-update__title">{{ store.latest.title }}</h3>
            <RsMarkdown
              class="nm-update__notes"
              :model-value="store.latest.notesMd || t('appUpdate.noNotes')"
              readonly
              height="14rem"
            />
            <div
              v-if="store.phase === 'downloading' || store.phase === 'verifying'"
              class="nm-update__prog"
            >
              <div class="nm-update__bar">
                <div class="nm-update__bar-fill" :style="{ width: `${store.progressPercent}%` }" />
              </div>
              <p class="nm-caption">
                {{
                  store.phase === 'verifying'
                    ? t('appUpdate.verifying')
                    : t('appUpdate.downloading', { percent: store.progressPercent })
                }}
              </p>
            </div>
          </template>
          <p v-if="errorText" class="nm-update__err">{{ errorText }}</p>
        </div>
      </template>
      <template #footer>
        <RsButton
          v-if="store.phase === 'downloading'"
          variant="secondary"
          @click="store.cancelDownload()"
        >
          {{ t('appUpdate.cancelDownload') }}
        </RsButton>
        <RsButton
          v-else-if="
            canDismiss && store.latest && (store.phase === 'available' || store.phase === 'forced')
          "
          variant="secondary"
          @click="store.snooze()"
        >
          {{ t('appUpdate.snooze') }}
        </RsButton>
        <RsButton
          v-if="store.latest && (store.phase === 'available' || store.phase === 'forced')"
          variant="primary"
          @click="store.startUpdate()"
        >
          {{
            store.inAppInstallSupported
              ? t('appUpdate.updateNow')
              : t('appUpdate.openDownload')
          }}
        </RsButton>
        <RsButton v-else-if="!store.latest" variant="primary" @click="store.closeDialog()">
          {{ t('appUpdate.close') }}
        </RsButton>
      </template>
    </RsDialog>
  </div>
</template>

<style scoped>
.nm-update-shell {
  position: relative;
  z-index: 80;
}
.nm-update {
  display: grid;
  gap: 0.75rem;
}
.nm-update__meta {
  margin: 0;
  font-size: 0.875rem;
  color: var(--rs-fg-muted, #666);
}
.nm-update__force {
  color: var(--rs-danger, #c0392b);
}
.nm-update__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.nm-update__notes {
  min-width: 0;
}
.nm-update__prog {
  display: grid;
  gap: 0.35rem;
}
.nm-update__bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.nm-update__bar-fill {
  height: 100%;
  background: var(--rs-primary, #2563eb);
  transition: width 0.2s ease;
}
.nm-update__err {
  margin: 0;
  color: var(--rs-danger, #c0392b);
  font-size: 0.875rem;
}
</style>
