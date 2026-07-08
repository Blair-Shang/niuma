<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  RsButton,
  RsForm,
  RsLabel,
  RsSelect,
  type RsSelectOption,
  type RsSelectOptionGroup,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

/** 模型选择 — 基础表单 */
const model = ref('gpt-4o')
const modelOptions: RsSelectOption[] = [
  { label: '弱水 GPT-4o', value: 'gpt-4o' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Claude', value: 'claude' },
]

/** 默认选中 — 编辑态回显 */
const plan = ref('pro')
const planOptions: RsSelectOption[] = [
  { label: 'Free', value: 'free' },
  { label: 'Pro', value: 'pro' },
  { label: 'Enterprise', value: 'enterprise' },
]

/** 占位 / 未选择 */
const role = ref('')
const roleOptions: RsSelectOption[] = [
  { label: '管理员', value: 'admin' },
  { label: '成员', value: 'member' },
  { label: '访客', value: 'guest' },
]

/** i18n 默认占位 — 不传 placeholder，随 Playground 语言切换 */
const localeDemo = ref('')
const localeOptions: RsSelectOption[] = [
  { label: '选项 A', value: 'a' },
  { label: '选项 B', value: 'b' },
]

/** 禁用整控件 */
const lockedModel = ref('gpt-4o')

/** 部分选项禁用 — 即将上线 / 无权限 */
const engine = ref('gpt-4o')
const engineOptions: RsSelectOption[] = [
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'Claude 3.5', value: 'claude-35' },
  { label: 'Gemini 2.0（即将上线）', value: 'gemini', disabled: true },
  { label: '企业专属模型（无权限）', value: 'enterprise', disabled: true },
]

/** 长列表 — 国家 / 时区类场景 */
const country = ref('')
const countryOptions: RsSelectOption[] = [
  { label: '中国', value: 'CN' },
  { label: '美国', value: 'US' },
  { label: '日本', value: 'JP' },
  { label: '韩国', value: 'KR' },
  { label: '新加坡', value: 'SG' },
  { label: '英国', value: 'GB' },
  { label: '德国', value: 'DE' },
  { label: '法国', value: 'FR' },
  { label: '加拿大', value: 'CA' },
  { label: '澳大利亚', value: 'AU' },
  { label: '印度', value: 'IN' },
  { label: '巴西', value: 'BR' },
  { label: '墨西哥', value: 'MX' },
  { label: '荷兰', value: 'NL' },
  { label: '瑞士', value: 'CH' },
  { label: '瑞典', value: 'SE' },
  { label: '阿联酋', value: 'AE' },
  { label: '沙特阿拉伯', value: 'SA' },
  { label: '印度尼西亚', value: 'ID' },
  { label: '泰国', value: 'TH' },
]

/** 长文案选项 — 测试触发器与下拉宽度 */
const docType = ref('')
const docTypeOptions: RsSelectOption[] = [
  { label: '标准服务协议（适用于个人与小型团队）', value: 'standard' },
  { label: '企业级数据处理附录（含跨境传输与合规条款）', value: 'enterprise-dpa' },
  { label: 'API 集成开发者许可', value: 'api' },
]

/** 表单联动 — 国家 → 城市 */
const regionCountry = ref('')
const regionCity = ref('')

const cityMap: Record<string, RsSelectOption[]> = {
  CN: [
    { label: '北京', value: 'beijing' },
    { label: '上海', value: 'shanghai' },
    { label: '深圳', value: 'shenzhen' },
    { label: '杭州', value: 'hangzhou' },
  ],
  US: [
    { label: 'San Francisco', value: 'sf' },
    { label: 'New York', value: 'nyc' },
    { label: 'Seattle', value: 'sea' },
  ],
  JP: [
    { label: '东京', value: 'tokyo' },
    { label: '大阪', value: 'osaka' },
  ],
}

const cityOptions = computed(() => cityMap[regionCountry.value] ?? [])
const cityDisabled = computed(() => !regionCountry.value)

watch(regionCountry, () => {
  regionCity.value = ''
})

/** 受控重置 */
const assignee = ref('alice')
const assigneeOptions: RsSelectOption[] = [
  { label: 'Alice', value: 'alice' },
  { label: 'Bob', value: 'bob' },
  { label: 'Carol', value: 'carol' },
]

/** 并排表单 — 账单周期 + 币种 */
const billingPeriod = ref('monthly')
const currency = ref('usd')
const periodOptions: RsSelectOption[] = [
  { label: '月付', value: 'monthly' },
  { label: '年付（省 20%）', value: 'yearly' },
]
const currencyOptions: RsSelectOption[] = [
  { label: 'USD ($)', value: 'usd' },
  { label: 'CNY (¥)', value: 'cny' },
  { label: 'EUR (€)', value: 'eur' },
]

/** 状态 / 优先级枚举 — 后台筛选常见 */
const status = ref('all')
const priority = ref('any')
const statusOptions: RsSelectOption[] = [
  { label: '全部状态', value: 'all' },
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'done' },
  { label: '已取消', value: 'cancelled' },
]
const priorityOptions: RsSelectOption[] = [
  { label: '任意优先级', value: 'any' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'urgent' },
]

/** 可搜索 */
const searchableCountry = ref('')

/** 多选 Tags */
const skills = ref<string[]>(['vue', 'ts'])
const skillOptions: RsSelectOption[] = [
  { label: 'Vue', value: 'vue' },
  { label: 'TypeScript', value: 'ts' },
  { label: 'React', value: 'react' },
  { label: 'Rust', value: 'rust' },
  { label: 'Go', value: 'go' },
]

/** 可清空 */
const clearableModel = ref('gpt-4o')

/** 选项分组 */
const groupedFramework = ref('')
const groupedOptions: RsSelectOptionGroup[] = [
  {
    label: '前端',
    options: [
      { label: 'Vue', value: 'vue' },
      { label: 'React', value: 'react' },
    ],
  },
  {
    label: '后端',
    options: [
      { label: 'Node.js', value: 'node' },
      { label: 'Go', value: 'go' },
    ],
  },
]

/** 虚拟滚动 */
const virtualCity = ref('')
const virtualOptions: RsSelectOption[] = Array.from({ length: 500 }, (_, i) => ({
  label: `城市 #${i + 1}`,
  value: `city-${i + 1}`,
}))

/** 远程搜索 */
const remoteUser = ref('')
const remoteLoading = ref(false)
const remoteOptions = ref<RsSelectOption[]>([])
const remoteCatalog: RsSelectOption[] = Array.from({ length: 40 }, (_, i) => ({
  label: `用户 ${String(i + 1).padStart(2, '0')}`,
  value: `user-${i + 1}`,
}))

function onRemoteSearch(query: string) {
  remoteLoading.value = true
  globalThis.setTimeout(() => {
    const q = query.trim().toLowerCase()
    remoteOptions.value = q
      ? remoteCatalog.filter((item) => item.label.toLowerCase().includes(q))
      : remoteCatalog.slice(0, 10)
    remoteLoading.value = false
  }, 400)
}

onMounted(() => {
  onRemoteSearch('')
  globalThis.setTimeout(() => {
    loadingOptions.value = modelOptions
    loadingState.value = false
  }, 1200)
})

/** 多选 + 可清空 */
const tagsClearable = ref<string[]>(['vue', 'ts'])

/** 分组多选 */
const groupedMulti = ref<string[]>(['vue'])

/** 表单必填校验 */
const formRef = ref<InstanceType<typeof RsForm> | null>(null)
const requiredRole = ref('')
const validateResult = ref('')

async function runValidate() {
  const result = await formRef.value?.validate()
  validateResult.value = result?.valid ? '通过' : '未通过（请选择角色）'
}

/** 命令式 API */
const imperativeModel = ref('')
const selectRef = ref<InstanceType<typeof RsSelect> | null>(null)

function setImperative(value: string) {
  selectRef.value?.setValue(value)
}

/** 加载态 */
const loadingModel = ref('')
const loadingOptions = ref<RsSelectOption[]>([])
const loadingState = ref(true)

/** 自定义空态 / 加载文案 */
const customEmptyModel = ref('')
const customEmptyOptions: RsSelectOption[] = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
]

/** 组合示例：团队成员 */
const teamRole = ref('')
const teamSkills = ref<string[]>([])
</script>

<template>
  <DemoPage title="RsSelect" test-file="RsSelect.spec.ts">
    <DemoBlock title="基础表单（Label + 占位）">
      <p class="hint">最常见的模型 / 配置选择，配合 RsLabel 与 for-id 关联无障碍。</p>
      <div class="field">
        <RsLabel for-id="pg-model">模型</RsLabel>
        <RsSelect id="pg-model" v-model="model" :options="modelOptions" placeholder="选择模型" />
        <p class="value-hint">当前值：<code>{{ model }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="默认选中（编辑回显）">
      <p class="hint">v-model 初始有值时直接展示已选项，无需 placeholder。</p>
      <div class="field">
        <RsLabel for-id="pg-plan">套餐</RsLabel>
        <RsSelect id="pg-plan" v-model="plan" :options="planOptions" />
        <p class="value-hint">当前值：<code>{{ plan }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="未选择 / 自定义占位">
      <p class="hint">空字符串时显示 placeholder；适合新建表单、角色分配等可选字段。</p>
      <div class="field">
        <RsLabel for-id="pg-role">角色</RsLabel>
        <RsSelect
          id="pg-role"
          v-model="role"
          :options="roleOptions"
          placeholder="选择成员角色"
        />
        <p class="value-hint">当前值：<code>{{ role || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="i18n 默认占位">
      <p class="hint">不传 placeholder 时使用内置文案；在左侧栏切换 zh-CN / en-US 观察变化。</p>
      <div class="field">
        <RsLabel for-id="pg-locale-demo">语言演示</RsLabel>
        <RsSelect id="pg-locale-demo" v-model="localeDemo" :options="localeOptions" />
      </div>
    </DemoBlock>

    <DemoBlock title="禁用整控件">
      <p class="hint">只读配置、无权限字段；整控件不可交互。</p>
      <div class="field">
        <RsLabel for-id="pg-locked" disabled>已锁定模型</RsLabel>
        <RsSelect
          id="pg-locked"
          v-model="lockedModel"
          :options="modelOptions"
          disabled
        />
      </div>
    </DemoBlock>

    <DemoBlock title="部分选项禁用">
      <p class="hint">「即将上线」「无权限」等场景；禁用项不可选但可见。</p>
      <div class="field">
        <RsLabel for-id="pg-engine">推理引擎</RsLabel>
        <RsSelect id="pg-engine" v-model="engine" :options="engineOptions" />
        <p class="value-hint">当前值：<code>{{ engine }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="长选项列表">
      <p class="hint">国家、时区类枚举；超过 {{ 50 }} 项自动启用虚拟滚动。</p>
      <div class="field">
        <RsLabel for-id="pg-country">国家 / 地区</RsLabel>
        <RsSelect
          id="pg-country"
          v-model="country"
          :options="countryOptions"
          placeholder="选择国家或地区"
        />
        <p class="value-hint">已选：<code>{{ country || '（空）' }}</code> · 共 {{ countryOptions.length }} 项</p>
      </div>
    </DemoBlock>

    <DemoBlock title="长文案选项">
      <p class="hint">合同类型、政策名称等；观察触发器与下拉面板对长文本的展示。</p>
      <div class="field field--wide">
        <RsLabel for-id="pg-doc-type">文档类型</RsLabel>
        <RsSelect
          id="pg-doc-type"
          v-model="docType"
          :options="docTypeOptions"
          placeholder="选择要签署的文档"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="表单联动（国家 → 城市）">
      <p class="hint">上级选择变化后清空下级；未选国家时城市 Select 禁用。业界级联选择的基础形态。</p>
      <div class="row-fields">
        <div class="field">
          <RsLabel for-id="pg-region-country" required>国家</RsLabel>
          <RsSelect
            id="pg-region-country"
            v-model="regionCountry"
            :options="countryOptions.slice(0, 3)"
            placeholder="先选国家"
          />
        </div>
        <div class="field">
          <RsLabel for-id="pg-region-city" required>城市</RsLabel>
          <RsSelect
            id="pg-region-city"
            v-model="regionCity"
            :options="cityOptions"
            :disabled="cityDisabled"
            placeholder="再选城市"
          />
        </div>
      </div>
      <p class="value-hint">
        联动结果：<code>{{ regionCountry || '—' }}</code> /
        <code>{{ regionCity || '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="受控重置">
      <p class="hint">通过外部按钮清空选择，模拟「重置筛选」或表单 reset。</p>
      <div class="field">
        <RsLabel for-id="pg-assignee">负责人</RsLabel>
        <div class="inline-actions">
          <RsSelect
            id="pg-assignee"
            v-model="assignee"
            :options="assigneeOptions"
            placeholder="指派负责人"
          />
          <RsButton variant="ghost" size="sm" @click="assignee = ''">清空</RsButton>
        </div>
        <p class="value-hint">当前值：<code>{{ assignee || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="并排双 Select（账单配置）">
      <p class="hint">SaaS 定价页、订阅设置中常见的多字段横排布局。</p>
      <div class="row-fields">
        <div class="field">
          <RsLabel for-id="pg-period">计费周期</RsLabel>
          <RsSelect id="pg-period" v-model="billingPeriod" :options="periodOptions" />
        </div>
        <div class="field">
          <RsLabel for-id="pg-currency">币种</RsLabel>
          <RsSelect id="pg-currency" v-model="currency" :options="currencyOptions" />
        </div>
      </div>
      <p class="value-hint">
        {{ billingPeriod }} · {{ currency }}
      </p>
    </DemoBlock>

    <DemoBlock title="筛选栏（状态 + 优先级）">
      <p class="hint">后台列表页顶栏：枚举筛选、默认值「全部 / 任意」。</p>
      <div class="row-fields">
        <div class="field">
          <RsLabel for-id="pg-status">状态</RsLabel>
          <RsSelect id="pg-status" v-model="status" :options="statusOptions" />
        </div>
        <div class="field">
          <RsLabel for-id="pg-priority">优先级</RsLabel>
          <RsSelect id="pg-priority" v-model="priority" :options="priorityOptions" />
        </div>
      </div>
      <p class="value-hint">
        筛选条件：<code>status={{ status }}</code> ·
        <code>priority={{ priority }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="可搜索 / 过滤">
      <p class="hint">`searchable` 在下拉面板顶部展示搜索框，本地过滤选项。</p>
      <div class="field">
        <RsLabel for-id="pg-searchable-country">国家</RsLabel>
        <RsSelect
          id="pg-searchable-country"
          v-model="searchableCountry"
          :options="countryOptions"
          searchable
          clearable
          placeholder="搜索国家"
        />
        <p class="value-hint">当前值：<code>{{ searchableCountry || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="多选（Tags）">
      <p class="hint">`multiple` 时 v-model 为 string[]，触发器展示可移除标签。</p>
      <div class="field field--wide">
        <RsLabel for-id="pg-skills">技能栈</RsLabel>
        <RsSelect
          id="pg-skills"
          v-model="skills"
          :options="skillOptions"
          multiple
          searchable
          placeholder="选择技能"
        />
        <p class="value-hint">已选：<code>{{ skills.join(', ') || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="可清空（Allow Clear）">
      <p class="hint">`clearable` 在触发器右侧展示清空按钮。</p>
      <div class="field">
        <RsLabel for-id="pg-clearable">模型</RsLabel>
        <RsSelect
          id="pg-clearable"
          v-model="clearableModel"
          :options="modelOptions"
          clearable
        />
        <p class="value-hint">当前值：<code>{{ clearableModel || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="选项分组（OptGroup）">
      <p class="hint">`options` 传入 `RsSelectOptionGroup[]` 即可分组展示。</p>
      <div class="field">
        <RsLabel for-id="pg-grouped">技术栈</RsLabel>
        <RsSelect
          id="pg-grouped"
          v-model="groupedFramework"
          :options="groupedOptions"
          searchable
          placeholder="选择框架"
        />
        <p class="value-hint">当前值：<code>{{ groupedFramework || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="虚拟滚动（长列表）">
      <p class="hint">`virtual` 或超过 `virtualThreshold`（默认 50）时启用 ComboboxVirtualizer。</p>
      <div class="field">
        <RsLabel for-id="pg-virtual">城市（500 项）</RsLabel>
        <RsSelect
          id="pg-virtual"
          v-model="virtualCity"
          :options="virtualOptions"
          virtual
          searchable
          placeholder="搜索城市"
        />
        <p class="value-hint">当前值：<code>{{ virtualCity || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="远程搜索（Remote Search）">
      <p class="hint">`remote` + `@search`：关闭内置过滤，由业务侧更新 options。</p>
      <div class="field">
        <RsLabel for-id="pg-remote">用户</RsLabel>
        <RsSelect
          id="pg-remote"
          v-model="remoteUser"
          :options="remoteOptions"
          searchable
          remote
          :loading="remoteLoading"
          clearable
          placeholder="输入用户名搜索"
          @search="onRemoteSearch"
        />
        <p class="value-hint">当前值：<code>{{ remoteUser || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="多选 + 可清空">
      <p class="hint">`multiple` 与 `clearable` 组合：一键清空全部标签。</p>
      <div class="field field--wide">
        <RsLabel for-id="pg-tags-clearable">标签</RsLabel>
        <RsSelect
          id="pg-tags-clearable"
          v-model="tagsClearable"
          :options="skillOptions"
          multiple
          clearable
          searchable
          placeholder="选择标签"
        />
        <p class="value-hint">已选：<code>{{ tagsClearable.join(', ') || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="分组多选">
      <p class="hint">分组结构下多选，搜索会按组过滤可见选项。</p>
      <div class="field field--wide">
        <RsLabel for-id="pg-grouped-multi">技术栈（多选）</RsLabel>
        <RsSelect
          id="pg-grouped-multi"
          v-model="groupedMulti"
          :options="groupedOptions"
          multiple
          searchable
          placeholder="选择一项或多项"
        />
        <p class="value-hint">已选：<code>{{ groupedMulti.join(', ') || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="表单必填校验（RsForm）">
      <p class="hint">
        `required` 注册到 RsForm 校验；未选时 <code>validate()</code> 返回 invalid。
      </p>
      <RsForm ref="formRef" max-width="md">
        <div class="field">
          <RsLabel for-id="pg-required-role" required>角色</RsLabel>
          <RsSelect
            id="pg-required-role"
            v-model="requiredRole"
            :options="roleOptions"
            required
            placeholder="选择角色"
          />
        </div>
        <div class="inline-actions">
          <RsButton size="sm" @click="runValidate">校验</RsButton>
          <span v-if="validateResult" class="value-hint">结果：<code>{{ validateResult }}</code></span>
        </div>
      </RsForm>
    </DemoBlock>

    <DemoBlock title="命令式 API（defineExpose）">
      <p class="hint">
        通过 ref 调用 <code>setValue</code> / <code>clearValidation</code>，适合外部重置或回填。
      </p>
      <div class="field">
        <RsLabel for-id="pg-imperative">模型</RsLabel>
        <div class="inline-actions">
          <RsSelect
            id="pg-imperative"
            ref="selectRef"
            v-model="imperativeModel"
            :options="modelOptions"
            clearable
            placeholder="选择模型"
          />
          <RsButton variant="ghost" size="sm" @click="setImperative('claude')">设为 Claude</RsButton>
          <RsButton variant="ghost" size="sm" @click="setImperative('')">清空</RsButton>
        </div>
        <p class="value-hint">当前值：<code>{{ imperativeModel || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="加载态">
      <p class="hint">`loading` 为 true 时展示加载文案，隐藏选项列表（常用于异步拉取 options）。</p>
      <div class="field">
        <RsLabel for-id="pg-loading">模型</RsLabel>
        <RsSelect
          id="pg-loading"
          v-model="loadingModel"
          :options="loadingOptions"
          :loading="loadingState"
          searchable
          placeholder="等待选项加载…"
        />
        <p class="value-hint">
          状态：<code>{{ loadingState ? '加载中' : '已就绪' }}</code> ·
          选项数：<code>{{ loadingOptions.length }}</code>
        </p>
      </div>
    </DemoBlock>

    <DemoBlock title="自定义空态 / 加载文案">
      <p class="hint">
        覆盖 <code>emptyText</code>、<code>loadingText</code>、<code>searchPlaceholder</code>；
        打开后搜索不存在的关键词观察空态。
      </p>
      <div class="field">
        <RsLabel for-id="pg-custom-empty">代号</RsLabel>
        <RsSelect
          id="pg-custom-empty"
          v-model="customEmptyModel"
          :options="customEmptyOptions"
          searchable
          empty-text="没有匹配的代号"
          search-placeholder="输入代号过滤"
          placeholder="选择代号"
        />
        <p class="value-hint">当前值：<code>{{ customEmptyModel || '（空）' }}</code></p>
      </div>
    </DemoBlock>

    <DemoBlock title="组合示例：团队成员配置">
      <div class="team-panel">
        <div class="field">
          <RsLabel for-id="pg-team-role" required>角色</RsLabel>
          <RsSelect
            id="pg-team-role"
            v-model="teamRole"
            :options="roleOptions"
            required
            clearable
            placeholder="选择角色"
          />
        </div>
        <div class="field field--wide">
          <RsLabel for-id="pg-team-skills">技能</RsLabel>
          <RsSelect
            id="pg-team-skills"
            v-model="teamSkills"
            :options="skillOptions"
            multiple
            searchable
            placeholder="选择技能（可多选）"
          />
        </div>
        <p class="team-summary">
          配置预览：
          <strong>{{ teamRole || '未指定角色' }}</strong>
          · 技能
          <strong>{{ teamSkills.length ? teamSkills.join('、') : '无' }}</strong>
        </p>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-width: 20rem;
}
.field--wide {
  max-width: 28rem;
}
.row-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.value-hint {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.value-hint code {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-primary-hover);
}
.inline-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.inline-actions .rs-select {
  flex: 1;
  min-width: 0;
}
.team-panel {
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
}
.team-summary {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.team-summary strong {
  color: var(--rs-text);
  font-weight: 600;
}
</style>
