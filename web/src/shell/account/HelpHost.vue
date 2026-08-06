<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsButton, RsDialog } from '@niuma/ui'
import AppBrandIcon from '@/shell/widgets/AppBrandIcon.vue'
import { useAppUpdateStore } from '@/stores/app-update'
import { useBridgeStore } from '@/stores/bridge'

const { t, te } = useI18n()
const store = useAppUpdateStore()
const bridge = useBridgeStore()

const changelogErrorText = computed(() => {
  const code = store.changelogError?.trim()
  if (!code) return ''
  const key = `appUpdate.errors.${code}`
  return te(key) ? t(key) : code
})

function onAboutOpen(open: boolean) {
  if (open) store.openAbout()
  else store.closeAbout()
}

function onChangelogOpen(open: boolean) {
  if (open) void store.openChangelog()
  else store.closeChangelog()
}
</script>

<template>
  <div id="nm-help-portal" class="nm-help-shell">
    <RsDialog
      :open="store.aboutOpen"
      :title="t('shell.help.aboutTitle')"
      width="sm"
      layout="confirm"
      teleport-to="#nm-help-portal"
      :resizable="false"
      :draggable="false"
      :fullscreenable="false"
      :show-overlay="false"
      :show-close="true"
      :close-on-overlay-click="false"
      @update:open="onAboutOpen"
    >
      <template #body>
        <div class="nm-about">
          <div class="nm-about__brand">
            <AppBrandIcon :size="36" variant="mark" />
            <div>
              <h3 class="nm-about__name">{{ t('app.title') }}</h3>
              <p class="nm-about__tag">{{ t('shell.help.aboutTagline') }}</p>
            </div>
          </div>
          <dl class="nm-about__facts">
            <dt>{{ t('settings.appVersion') }}</dt>
            <dd class="font-mono">{{ bridge.shellVersion || '—' }}</dd>
            <dt>{{ t('settings.buildId') }}</dt>
            <dd class="font-mono">{{ bridge.shellBuildId || '—' }}</dd>
            <dt>{{ t('shell.help.platform') }}</dt>
            <dd class="font-mono">
              {{ bridge.shellInfo?.platform || '—' }}
              <template v-if="bridge.shellInfo?.arch"> / {{ bridge.shellInfo.arch }}</template>
            </dd>
          </dl>
        </div>
      </template>
      <template #footer>
        <RsButton variant="secondary" @click="store.closeAbout()">
          {{ t('appUpdate.close') }}
        </RsButton>
        <RsButton
          variant="primary"
          :loading="store.aboutChecking"
          :disabled="!bridge.shellVersion"
          @click="store.checkFromAbout()"
        >
          {{
            store.aboutChecking ? t('shell.help.checkingUpdate') : t('shell.help.checkUpdate')
          }}
        </RsButton>
      </template>
    </RsDialog>

    <RsDialog
      :open="store.changelogOpen"
      :title="t('shell.help.changelogTitle')"
      width="md"
      layout="confirm"
      teleport-to="#nm-help-portal"
      :resizable="false"
      :draggable="false"
      :fullscreenable="false"
      :show-overlay="false"
      :show-close="true"
      :close-on-overlay-click="false"
      @update:open="onChangelogOpen"
    >
      <template #body>
        <div class="nm-changelog">
          <p v-if="store.changelogLoading" class="nm-changelog__meta">
            {{ t('shell.help.changelogLoading') }}
          </p>
          <template v-else-if="store.changelogRelease">
            <p class="nm-changelog__meta">
              <span class="font-mono">{{ store.changelogRelease.version }}</span>
              <span v-if="store.changelogRelease.title"> · {{ store.changelogRelease.title }}</span>
            </p>
            <p v-if="store.changelogHasUpdate" class="nm-changelog__update">
              {{ t('shell.help.changelogUpdateAvailable') }}
            </p>
            <pre class="nm-changelog__notes">{{
              store.changelogRelease.notesMd || t('appUpdate.noNotes')
            }}</pre>
          </template>
          <p v-else-if="changelogErrorText" class="nm-changelog__err">{{ changelogErrorText }}</p>
          <p v-else class="nm-changelog__meta">{{ t('shell.help.changelogEmpty') }}</p>
        </div>
      </template>
      <template #footer>
        <RsButton variant="secondary" @click="store.closeChangelog()">
          {{ t('appUpdate.close') }}
        </RsButton>
        <RsButton
          v-if="store.changelogHasUpdate"
          variant="primary"
          @click="store.updateFromChangelog()"
        >
          {{ t('appUpdate.updateNow') }}
        </RsButton>
      </template>
    </RsDialog>
  </div>
</template>

<style scoped>
.nm-help-shell {
  position: relative;
  z-index: 80;
}
.nm-about {
  display: grid;
  gap: 1rem;
}
.nm-about__brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.nm-about__name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
}
.nm-about__tag {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--rs-muted);
}
.nm-about__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  margin: 0;
  font-size: 0.85rem;
}
.nm-about__facts dt {
  color: var(--rs-muted);
}
.nm-about__facts dd {
  margin: 0;
}
.nm-changelog {
  display: grid;
  gap: 0.75rem;
}
.nm-changelog__meta {
  margin: 0;
  font-size: 0.875rem;
  color: var(--rs-muted);
}
.nm-changelog__update {
  margin: 0;
  font-size: 0.85rem;
  color: var(--rs-primary);
}
.nm-changelog__notes {
  margin: 0;
  max-height: 16rem;
  overflow: auto;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: var(--rs-bg-subtle, rgba(0, 0, 0, 0.04));
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.5;
}
.nm-changelog__err {
  margin: 0;
  color: var(--rs-danger, #c0392b);
  font-size: 0.875rem;
}
</style>
