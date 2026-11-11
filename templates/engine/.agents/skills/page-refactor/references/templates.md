# page-refactor 施工模板（S1–S12）

本文件由 `.agents/skills/page-refactor/SKILL.md` 在施工步按需读取。盘点、硬红线、验证门以 SKILL.md 为准。模板与样板页面冲突时以本文件为准，并在 SKILL.md 记一笔漂移，不当场改样板。

## 内嵌模板（施工权威，S1-S12）

> 施工以此为骨架：类名/字段/按钮按目标页面替换，**机制注释逐字保留**（注释即陷阱知识）。模板沉淀自 purchaseOrder / supplier 页面（2026-10），与目标分支旧代码不一致属预期——不一致处按模板改，不按旧代码改。

### S1 详情页高度模型 CSS 全套（`<style scoped>`）

```css
/* 覆盖层内纵向布局：内容区随滚动延伸，footer 钉底（供应商 detail 口径） */
.xx-detail {            /* 类名按目标页面换 */
  width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

/* ===== 高度模型：上半区纯内容高、下半区 min 半屏 grow 撑满填页、外层 .detail-layer 承接滚动 =====
   高度链（查看态）：.xx-detail(min-height:100%，可超) → a-spin 两层 → .view-body → .view-top / .view-bottom；
   同链（编辑/新增态）：.edit-body → a-spin 两层 → .edit-main → .edit-top / .edit-bottom。
   中间层一律 flex:1 1 auto（内容驱动：撑开模式高度随内容传导；内容不足一屏时 grow 吃剩余）。
   两半区高度按 CSS 变量 --layer-h 计算（脚本 ResizeObserver 注入）：
   CSS 限制——容器高度不定（可撑开）时子项百分比 min-height/height 解析失效，百分比链不可用。
   注意 a-spin 根实为 .ant-spin-nested-loading——组件上的自定义 class 不落到该根上，
   故按 antd 结构类选择。 */
.xx-detail :deep(.ant-spin-nested-loading),
.xx-detail :deep(.ant-spin-container) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.view-body,
.edit-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 上半区：纯内容高（超出半屏由外层 .detail-layer 滚动承接） */
.view-top,
.edit-top {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
}

/* 下半区：min 半屏基准，上半区不足半屏时 grow 吃剩余撑满整页；
   上半区超半屏时链为内容驱动无剩余可吃、锁半屏由表内滚动承接 */
.view-bottom,
.edit-bottom {
  flex: 1 1 auto;
  min-height: calc(var(--layer-h, 0px) / 2);
  display: flex;
  flex-direction: column;
}

/* 上半区在下半区最大化时整体让位 */
.view-top.is-hidden-by-max,
.edit-top.is-hidden-by-max {
  display: none;
}

/* 下半区最大化：吃掉上半区让出的全部高度（flex 填充，无定位依赖——详情头/返回按钮保留在顶） */
.view-bottom.is-maximized,
.edit-bottom.is-maximized {
  flex: 1 1 auto;
  height: auto;
}

/* 页签：下半区 tabs 撑满本区（nav 不收缩，内容区逐层撑满、表内滚动依赖此链）；
   上半区 tabs 不进链（自然流，内容多高页签多高——撑开传导的关键） */
.view-tabs :deep(.ant-tabs-nav) {
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.view-bottom :deep(.ant-tabs),
.view-bottom :deep(.ant-tabs-content-holder),
.edit-bottom :deep(.ant-tabs),
.edit-bottom :deep(.ant-tabs-content-holder) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.view-bottom :deep(.ant-tabs-content),
.view-bottom :deep(.ant-tabs-tabpane-active),
.edit-bottom :deep(.ant-tabs-content),
.edit-bottom :deep(.ant-tabs-tabpane-active) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 上半区内容：自然流；overflow:hidden 仍要显式——a-row :gutter 的负外边距（每侧 -4px）
   会把行撑出面板 8px 空白，不裁会冒横向滚动条；空白落在栅格列 padding 槽位内，裁掉无内容损失 */
.view-top-pane,
.edit-top-pane {
  overflow: hidden;
}

/* 信息栅格：查看/编辑两态统一——4 列 / label 左右 / 间距紧凑（无 table 边框视觉） */
.info-grid :deep(.ant-form-item) {
  margin-bottom: 8px;
}
.info-grid .info-value {
  color: var(--text-primary, #172b4d);
}

/* label 朝向全表单一致：control 内容层 flex 化 + 所有子控件「基准归零、拉满占位」，
   控件基准不再参与换行判定 → label 恒横排；查看态纯文本同样适用。
   例外口径：a-tag 徽标不参与拉满（:not(.ant-tag) 排除）——胶囊被拉满会铺满整列变整列色块 */
.info-grid :deep(.ant-form-item-control) {
  min-width: 0;
}
.info-grid :deep(.ant-form-item-control-input-content) {
  display: flex;
}
.info-grid :deep(.ant-form-item-control-input-content > :not(.ant-tag)) {
  /* width:0 直接参与内容基准计算；!important 压 antd 动态样式/内联的 width:100%；
     拉满交给 flex-grow */
  width: 0 !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
}
/* input-group 内层 input：基准归零后仍需防 affix 传播 intrinsic */
.info-grid :deep(.ant-input-affix-wrapper > input.ant-input) {
  flex: 1 1 auto;
  width: 0;
}
.info-grid :deep(.ant-form-item-label) {
  flex-shrink: 0;
  /* 压 antd 内置小屏 (<576px) 表单样式：antd 会让 label 撑满整行变竖排 → 全部强制横排口径 */
  width: 106px !important;
  flex: 0 0 106px !important;
  padding: 0 8px 0 0 !important;
  white-space: nowrap;
}

/* 下半区内容：表格撑满本区，行多时由表体内部纵向滚动（表体外框不滚动） */
.view-table-region,
.view-table-region :deep(.ant-spin-nested-loading),
.view-table-region :deep(.ant-spin-container),
.view-table-region :deep(.ant-table),
.view-table-region :deep(.ant-table-container) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.view-table-region :deep(.ant-table-content) {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto !important;   /* antd 纯横向滚动会内联 overflow-y:hidden，须覆盖 */
}

/* 工具栏并入页签行：.tab-extra-row 自带 flex 容器——.ant-tabs-extra-content 默认非 flex，
   块级 .detail-toolbar-actions 会把最大化按钮挤到第二行，此处兜住 */
.tab-extra-row { display: flex; align-items: center; gap: 8px; }
.detail-toolbar-actions { display: flex; gap: 8px; }

/* 编辑态明细表链：a-spin 的根实为 .ant-spin-nested-loading、a-table 内部另有一层 spin
   （.ant-table-wrapper > .ant-spin-nested-loading > .ant-spin-container > .ant-table），
   两处中间层都须补进链，否则 .ant-table 落在非 flex 父里 flex:1 失效、表体被压成 0 高 */
.edit-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.edit-body :deep(.ant-spin-nested-loading),
.edit-body :deep(.ant-spin-container) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.edit-table-region {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.edit-table-region :deep(.ant-table-wrapper),
.edit-table-region :deep(.ant-spin-nested-loading),
.edit-table-region :deep(.ant-spin-container),
.edit-table-region :deep(.ant-table),
.edit-table-region :deep(.ant-table-container) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.edit-table-region :deep(.ant-table-content) {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto !important;
}

/* 长文本（备注/审批意见等）：保留换行 + 长串强制断行 */
.long-text {
  white-space: pre-wrap;
  word-break: break-word;
}
```

### S2 applyLayerHeight 脚本（`--layer-h` 注入，`<script setup>`）

```ts
/** 下半区 tab 最大化：查看/编辑两态共用一个开关；详情层 v-if 全新实例，关闭自动重置 */
const maximizedHalfTab = ref(false);

/** 高度模型：上半区纯内容高；下半区 min 详情层实高一半，上半区不足半屏时 grow 吃剩余撑满填页。
 *  CSS 限制：容器高度不定（可撑开模式）时子项百分比 min-height/height 解析失效
 *  → 用 ResizeObserver 把 .detail-layer 实高注入 CSS 变量 --layer-h（单一可靠参考系） */
const detailEl = ref<HTMLElement | null>(null);
let layerResizeObserver: ResizeObserver | null = null;

function applyLayerHeight() {
  const el = detailEl.value;
  const layer = el?.parentElement ?? null; // 详情组件根 .xx-detail 的父即 .detail-layer（列表页内 v-if 覆盖层）
  if (!el || !layer) return;
  // 可用高 = 详情层 clientHeight（含 padding）- 上下 padding - 详情头（高+下边距）。
  // 漏扣任何一项都会让详情根撑出一屏出现滚动条（实证：774 - 32 - 44 = 698，简版原样注入 774 曾致溢出 76px）
  const cs = getComputedStyle(layer);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const header = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : null;
  let extra = 0;
  if (header) extra += header.offsetHeight + parseFloat(getComputedStyle(header).marginBottom || '0');
  el.style.setProperty('--layer-h', `${Math.max(layer.clientHeight - padY - extra, 0)}px`);
}

onMounted(() => {
  applyLayerHeight();
  nextTick(applyLayerHeight); // footer/头渲染稳定后再校一次
  const layer = detailEl.value?.parentElement ?? null;
  if (layer && typeof ResizeObserver !== 'undefined') {
    layerResizeObserver = new ResizeObserver(applyLayerHeight);
    layerResizeObserver.observe(layer);
  }
});
onBeforeUnmount(() => {
  layerResizeObserver?.disconnect();
  layerResizeObserver = null;
});
```

### S3 详情页模板骨架（查看态 + 头部）

info-grid 字段行省略——按目标页面字段铺 `a-col :lg="6"`（只读 `span.info-value`），长文本 `:span="24"`。

```html
<div ref="detailEl" class="xx-detail" :class="{ 'is-view': viewMode }">
  <DetailPageHeader :title="headerTitle" parent-title="xx单据" @close="requestClose">
    <template #meta><!-- 单号 + 状态 tag（新增态无单号整体不渲染） --></template>
    <template #extra>
      <!-- 查看态：页面级操作按钮；编辑/新增态：取消/保存——均与返回按钮同一行靠右 -->
    </template>
  </DetailPageHeader>

  <template v-if="viewMode">
    <a-spin :spinning="detailLoading">
      <template v-if="detailData">
        <div class="view-body">
          <!-- 上半区（纯内容高）：基础信息；下半区最大化时整体让位隐藏 -->
          <div class="view-top" :class="{ 'is-hidden-by-max': maximizedHalfTab }">
            <a-tabs class="view-tabs" size="small">
              <a-tab-pane key="basic" tab="基础信息">
                <a-form class="info-grid view-top-pane"
                  :label-col="{ style: { width: '106px' } }"
                  :wrapper-col="{ style: { flex: 'auto' } }">
                  <!-- a-row :gutter="8" + a-col :lg="6" × N 字段（只读 span.info-value）… -->
                </a-form>
              </a-tab-pane>
            </a-tabs>
          </div>

          <!-- 下半区（min 半屏 grow 撑满；表内滚动）：明细/关联单据多 tab -->
          <div class="view-bottom" :class="{ 'is-maximized': maximizedHalfTab }">
            <a-tabs v-model:activeKey="linkTabKey" class="view-tabs" size="small">
              <template #rightExtra>
                <a-button type="text" size="small" class="tab-max-btn"
                  @click="maximizedHalfTab = !maximizedHalfTab">
                  <template #icon>
                    <CompressOutlined v-if="maximizedHalfTab" />
                    <ExpandOutlined v-else />
                  </template>
                </a-button>
              </template>
              <a-tab-pane key="orderDetail" tab="订单明细">
                <a-table class="view-table-region" bordered :columns="viewDetailColumns"
                  :data-source="detailData.details" row-key="id"
                  size="small" :pagination="false" :scroll="{ x: viewTableScrollX }">
                  <!-- #bodyCell 格式化… -->
                </a-table>
              </a-tab-pane>
              <!-- 其余关联单据 tab 同构… -->
            </a-tabs>
          </div>
        </div>
      </template>
    </a-spin>
  </template>
  <template v-else><!-- 编辑/新增态骨架见 S3b：.edit-body → .edit-main → .edit-top / .edit-bottom，链见 S1 CSS --></template>
</div>
```

配套脚本：`const linkTabKey = ref<'tabKey1' | 'tabKey2' | ...>('tabKey1');`（键名按目标页面 tab 集）；`headerTitle` 随三态切换——`const headerTitle = computed(() => mode === 'create' ? '新增xx单据' : mode === 'edit' ? '编辑xx单据' : 'xx单据详情');`（口径同样板页；`title`/`parentTitle` 必填，漏传过不了类型门）。

### S3b 编辑/新增态模板骨架（形态 A；形态跃迁主战场）

编辑/新增态与查看态共用 DetailPageHeader（取消/保存按钮进 `#extra`，与返回按钮同一行靠右）与 S1 高度链；字段绑定、rules、保存 handler、辅助弹窗从原 Drawer **逐字搬移**（禁顺手改语义）。

```html
<template v-else>
  <div class="edit-body">
    <a-spin :spinning="editLoading">
      <div class="edit-main">
        <!-- 上半区（纯内容高，表单项自然撑开）：基础信息可编辑表单 tab -->
        <div class="edit-top" :class="{ 'is-hidden-by-max': maximizedHalfTab }">
          <a-tabs class="view-tabs" size="small">
            <a-tab-pane key="basic" tab="基础信息">
              <div class="edit-top-pane"><!-- overflow:hidden 兜 gutter 负边距（S1/T7） -->
                <a-form class="info-grid"
                  :label-col="{ style: { width: '106px' } }"
                  :wrapper-col="{ style: { flex: 'auto' } }">
                  <!-- a-row :gutter="8" + a-col :xs="24" :sm="12" :lg="6" × N 字段
                       （a-form-item + 控件，绑定/校验/handler 从原 Drawer 逐字搬移）；
                       长文本（备注等）a-col :span="24" -->
                </a-form>
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>

        <!-- 下半区（min 半屏 grow 撑满；表内滚动）：明细编辑 tab，工具栏并入页签行（S4） -->
        <div class="edit-bottom" :class="{ 'is-maximized': maximizedHalfTab }">
          <a-tabs class="view-tabs" size="small">
            <template #rightExtra><!-- .tab-extra-row + .detail-toolbar-actions + 最大化按钮，见 S4 --></template>
            <a-tab-pane key="orderDetail" tab="订单明细">
              <div class="edit-table-region"><!-- 高度链见 S1（a-table 内层 spin 双层补链 T5） -->
                <a-table bordered :columns="editDetailColumns" :data-source="editForm.details"
                  row-key="lineNo" size="small" :pagination="false" :scroll="{ x: 1800 }">
                  <template #bodyCell="{ column, record, index }">
                    <!-- 单元格编辑控件（a-input-number / a-select / 弹窗选择入口）从原 Drawer 逐字搬移；
                         只读格（规格/单位/金额等）纯文本；行操作（历史价/删行）收在最右列 -->
                  </template>
                  <template #footer>
                    <div class="detail-footer"><!-- 合计行（金额/税额/价税合计），从原 Drawer 搬移 --></div>
                  </template>
                </a-table>
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>
      </div>
    </a-spin>
  </div>
  <!-- 辅助弹窗（物资查询/历史价格/引入单据等）：.edit-body 的兄弟节点，从原 Drawer 整体搬移 -->
</template>
```

注：编辑/新增态与查看态共用同一高度链——**两态都必须实测**（硬红线 4）。

### S4 工具栏并入页签行（编辑态明细 tab）

```html
<!-- 下半区：明细 tab；明细操作按钮组与最大化按钮并入页签 nav 行（省独立行约 40px） -->
<div class="edit-bottom" :class="{ 'is-maximized': maximizedHalfTab }">
  <a-tabs class="view-tabs" size="small">
    <template #rightExtra>
      <div class="tab-extra-row">
        <div class="detail-toolbar-actions">
          <!-- 目标页面的明细操作按钮（handler 逐字搬移，不改逻辑）… -->
        </div>
        <a-button type="text" size="small" class="tab-max-btn"
          @click="maximizedHalfTab = !maximizedHalfTab"><!-- Compress/Expand 图标同 S3 --></a-button>
      </div>
    </template>
    <a-tab-pane key="orderDetail" tab="订单明细">
      <div class="edit-table-region"><!-- 明细编辑表（页签内容只剩表格，直接吃剩余高度）… --></div>
    </a-tab-pane>
  </a-tabs>
</div>
```

### S5 列表页模板骨架（AG Grid 版：工具栏 + 表格卡 + 浮层 + 详情层）

`RowActions` 为页面级行操作按钮组组件——模板与动作集模式见 S12（buildRowActions + RowActions）；`SearchPanel` 为本仓库列表页筛选区**标准**组件（2026-10-26 用户裁定，采购订单页 = 口径样板：网格 `--search-cols` + 页面侧 label 定宽配方，口径单源见特性地图 `verify-ui/features/list-filter-layout.md`）；目标项目缺失该组件时才用目标页面既有搜索区。目标项目未用 AG Grid 时先按 S12 接入再施工本节。

```html
<!-- 表格工具栏：左组单据级操作 / 右组与复选框联动的批量操作 -->
<div class="table-toolbar">
  <div class="toolbar-left"><!-- 新增 / 导出… --></div>
  <!-- 批量操作（资格同源：浮层按钮 / 批量资格集合 / 复选框可选三处同口径） -->
  <div class="toolbar-right"><!-- 批量按钮（disabled 与选中集联动，含计数）… --></div>
</div>

<a-card class="table-card" :body-style="{ padding: '0', display: 'flex', flexDirection: 'column', height: '100%' }">
  <div class="grid-wrapper" ref="gridWrapperEl" @mouseover="onGridRowOver" @mouseout="onGridRowOut">
    <AgGridVue class="xx-grid" :grid-options="gridOptions" :row-data="tableData"
      style="width: 100%; height: 100%" />
    <!-- 行操作浮层：hover 行右缘浮出，替代已删除的固定操作列 -->
    <div v-if="hoverPanel" class="row-hover-panel" :style="{ top: `${hoverPanel.top}px` }"
      @mouseenter="hoverKeep" @mouseleave="hoverPanelLeave" @wheel="onHoverPanelWheel">
      <RowActions :record="hoverPanel.record" />
    </div>
  </div>
  <div class="table-footer">
    <a-pagination :current="query.page" :page-size="query.pageSize" :total="totalCount"
      :show-size-changer="true" :show-total="showTotal" :page-size-options="['10', '20', '50', '100']"
      @change="onPaginationChange" @show-size-change="onPaginationChange" />
  </div>
</a-card>

<!-- 详情覆盖层（页面内视图切换，不走路由）；Transition 淡入+上移，无布局推挤；跃迁后原 Drawer 此处下线 -->
<Transition name="xx-detail-layer">
  <div v-if="detailState" class="detail-layer">
    <XxDetail :mode="detailState.mode" :id="detailState.id" @close="..." />
  </div>
</Transition>
```

### S6 hover 浮层显隐逻辑（AG Grid 版：DOM 事件委托）

```ts
const hoverPanel = ref<{ record: XxListItem; top: number } | null>(null);
const hoverLocked = ref(false);
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverTimer() {
  if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
}
function scheduleHoverHide() {
  clearHoverTimer();
  // 给「行 → 浮层」的鼠标斜移留窗口；浮层 mouseenter（hoverKeep）即取消
  hoverHideTimer = setTimeout(() => { if (!hoverLocked.value) hoverPanel.value = null; }, 150);
}
function hoverKeep() { hoverLocked.value = true; clearHoverTimer(); }
function hoverPanelLeave() { hoverLocked.value = false; hoverPanel.value = null; }
/** 浮层上滚轮转发：浮层不在 .ag-body-viewport 内、.table-card overflow:hidden，
 *  浏览器找不到可滚祖先 → 手动转发给表格滚动视口；触发的滚动经 onBodyScroll 隐藏浮层 */
function onHoverPanelWheel(e: WheelEvent) {
  const wrap = gridWrapperEl.value;
  const viewport = wrap?.querySelector<HTMLElement>('.ag-body-viewport');
  if (!viewport) return;
  e.preventDefault();
  viewport.scrollTop += e.deltaY;
}
function hideHoverPanel() { clearHoverTimer(); hoverPanel.value = null; hoverLocked.value = false; }

// DOM 事件委托（AG Grid 的 rowMouseEnter 实测回调不触发，禁依赖）：
// mouseover 冒泡到 grid 容器后回查 .ag-row，按 row-index（服务端分页直映射 tableData）取行数据
function onGridRowOver(e: MouseEvent) {
  // 详情层打开期间熔断：真实鼠标点击浮层按钮 → 浮层移出 DOM → Chrome 对露出行补发
  // mouseover 会重建浮层。JS 点击探针测不到此路径，须真实断言。
  if (detailState.value) { hoverPanel.value = null; return; }
  const target = e.target as Element | null;
  const rowEl = target?.closest?.('.ag-row') ?? null;
  const wrap = gridWrapperEl.value;
  if (!rowEl || !wrap) return;
  const rowIndex = Number(rowEl.getAttribute('row-index'));
  const record = tableData.value[rowIndex];
  if (!record) return;
  // 零动作行不浮出（2026-10-26）：不满足资格的动作不渲染（S12），空卡片不占位。判据只用 buildRowActions，不另写资格清单。
  if (buildRowActions(record).length === 0) { hoverPanel.value = null; return; }
  clearHoverTimer();
  const rr = rowEl.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  hoverPanel.value = { record, top: rr.top - wr.top + rr.height / 2 };
}
// 移出到「另一行」不隐藏（新行 mouseover 刷新浮层）；移出到行外区域延时隐藏
function onGridRowOut(e: MouseEvent) {
  const toRow = (e.relatedTarget as Element | null)?.closest?.('.ag-row');
  if (toRow) return;
  scheduleHoverHide();
}
```

配套：gridOptions 里 `onBodyScroll: () => hideHoverPanel()`（滚动中行屏幕位置失效）。

### S7 gridOptions 关键配置（AG Grid 版）

依赖：`ag-grid-vue3` + `ag-grid-community`（`themeAlpine`、类型）；中文 locale 获取见 S12 §5，空态文案/CustomTooltip/textTooltip 模板见 S12 §6。

```ts
// 普通对象（非 reactive）：避免 Vue Proxy 干扰 ag-grid 内部状态管理
const gridOptions: GridOptions<XxListItem> = {
  theme: themeAlpine,
  columnDefs,
  defaultColDef: {
    sortable: false,          // 服务端分页：列默认不排序（只排当页数据会误导）
    resizable: true,
    tooltipComponent: 'customTooltip',
    tooltipValueGetter: textTooltip,   // 文本列 hover 全文（空值不弹）
  },
  components: { customTooltip: CustomTooltip },
  tooltipShowDelay: 400,
  tooltipHideDelay: 3000,
  tooltipShowMode: 'whenTruncated',    // 仅截断时弹全文
  // 批量选择（v33+ Selection API）：复选框自动渲染为首列；行点击不选（防误触）；
  // isRowSelectable 与后端守卫同口径。
  // 前导列左固定时，多选列只写 selectionColumnDef: { pinned: 'left' }（ColDef.pinned 对选择列无效）。
  // 页面未要求左固定则不要加 selectionColumnDef，也不要给业务列写 pinned。
  rowSelection: {
    mode: 'multiRow',
    headerCheckbox: true,
    enableClickSelection: false,
    isRowSelectable: (node) => canBatchSelect(node.data),
  },
  headerHeight: 40,
  rowHeight: 40,
  overlayNoRowsTemplate: emptyOverlayHtml.value,
  localeText: AG_GRID_LOCALE_CN,
  suppressCellFocus: true,
  onGridReady: (params) => { gridApi.value = params.api; },
  onSelectionChanged: () => { /* 同步 selectedRowKeys */ },
  onBodyScroll: () => hideHoverPanel(),
};
```

列定义模式：序号列 `{ colId:'index', width:64, valueGetter: rowIndex+1, suppressMovable:true, tooltipValueGetter:()=>null }`；主干文本列 `{ field, flex:1.2~1.4, minWidth:110~140 }`；窄列固定 `width`。**左固定只允许定义顺序上的连续前导列**（2026-10-26 用户口径，MTO：多选｜序号｜单号｜名称，列序不变）。中间列、操作列禁止 pin——pinned-left 容器整段渲染在最前，插队会打乱「复选框→序号→单号」（T11）。多选列的 pin 不认 `ColDef.pinned`，只认 `selectionColumnDef: { pinned: 'left' }`。未要求左固定的页面保持全部不 pin。

### S8 列表页 CSS 高度链（`<style scoped>`）

```css
/* 根容器：高度钉满内容区（不产生外部滚动条）；同时作详情覆盖层的定位上下文 */
.xx-list {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 详情层：铺满列表区域，白底随主题；自带滚动，列表实例保持存活（滚动/筛选不丢）；
   z-index 须压过行 hover 浮层（z-30） */
.detail-layer {
  position: absolute;
  inset: 0;
  z-index: 100;
  overflow-y: auto;
  padding: var(--spacing-lg, 24px);
  background: var(--bg-container, #fff);
}

/* 详情层过渡：淡入 + 轻微上移；离场反向。仅动 opacity/transform 无布局推挤 */
.xx-detail-layer-enter-active { transition: opacity 0.2s ease-out, transform 0.2s ease-out; }
.xx-detail-layer-leave-active { transition: opacity 0.15s ease-in, transform 0.15s ease-in; }
.xx-detail-layer-enter-from,
.xx-detail-layer-leave-to { opacity: 0; transform: translateY(12px); }
@media (prefers-reduced-motion: reduce) {
  .xx-detail-layer-enter-active,
  .xx-detail-layer-leave-active { transition: opacity 0.15s ease; }
  .xx-detail-layer-enter-from,
  .xx-detail-layer-leave-to { transform: none; }
}

/* 工具栏分组：左组单据级，右组批量靠右（竖线分隔） */
.toolbar-left { display: flex; gap: 8px; }
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  padding-left: 12px;
  border-left: 1px solid var(--border-color, #e4e7ee);
}

/* 表格卡：吃掉剩余视口高度（flex:1 + min-height:0 是内部滚动不外溢的关键），页脚钉底 */
.table-card { flex: 1; min-height: 0; overflow: hidden; }
.table-card :deep(.ant-card-body) {
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 全局样式 .ant-card-body 若带 !important 钉了内边距——以更高特异性落实 padding:0，
     页脚钉底才成立（无此全局样式时普通覆盖即可） */
  padding: 0 !important;
}

/* 表格容器：弹性伸缩，行滚动收在表格内部；position:relative 作浮层定位锚 */
.grid-wrapper { flex: 1; min-height: 0; position: relative; }

/* 行 hover 浮层：垂直居中于 hover 行（top 脚本注入），白底卡片浮于表格右缘内侧 */
.row-hover-panel {
  position: absolute;
  right: 12px;
  transform: translateY(-50%);
  z-index: 30;
  padding: 6px 12px;
  background: var(--bg-container, #fff);
  border: 1px solid var(--border-color, #e4e7ee);
  border-radius: 6px;
  box-shadow: var(--shadow-lg, 0 4px 16px rgba(0, 0, 0, 0.08));
  white-space: nowrap;
}

/* 底部固定分页页脚 */
.table-footer { flex-shrink: 0; display: flex; justify-content: flex-end; padding: 8px 12px; }
```

注：cellRenderer 字符串渲染的单元格样式（grid-tag/action-* 等）须放**非 scoped 块**、用页面根类（如 `.xx-list`）限定作用域，避免污染其他列表页。

### S9 纯表单型详情（目标形态 B）CSS

```css
/* 列表页：内容不足一屏时详情层也撑满内容区（内容区高度 definite，百分比可解析） */
.xx-list { min-height: 100%; }
/* 详情层白底（随主题）；其余 inset/overflow/padding 不动，四周保留灰色内边距 */
.detail-layer { background: var(--bg-container, #fff); /* 原规则保持 */ }
/* 详情页：撑满内容盒 + 表单卡片吃剩余高度推 footer 到底 */
.xx-detail { min-height: 100%; display: flex; flex-direction: column; }
.form-card { flex: 1; }
/* footer 钉底：滚动时贴可视区底部，不透出滚过内容 */
.form-footer {
  position: sticky; bottom: 0; z-index: 1;
  background: var(--bg-container, #fff);
  padding: 8px 0 4px;
}
```

### S10 验证探针断言骨架（降级路径：目标仓库无 harness 时）

断言清单见「验证门」（一项不减）；实现从简——node + CDP 直连（`--remote-debugging-port` 启 headless Chromium），核心工具函数：

```js
// 断言模式：数值化 getBoundingClientRect 对比，输出 PASS/FAIL 汇总 + 截图留档
const rect = async (sel) => { const el = await page.$(sel); return el.boundingBox(); };
const overflowY = async (sel) => await page.$eval(sel, (e) => getComputedStyle(e).overflowY);
// 高度链断言组（详情页目标形态 A）：top+bottom ≈ layerH / 外层 scrollH == clientH / 表体 overflowY == 'auto'
// 悬浮态断言（hover 浮层）：CDP Input.dispatchMouseEvent 派发真实 mousemove 序列（synthetic 事件测不到委托路径）
```

真实鼠标路径（hover 浮层显隐、详情层熔断）必须 `Input.dispatchMouseEvent` 派发，JS 注入的 synthetic 事件测不到事件委托分支。

### S11 DetailPageHeader 组件全文（目标仓库缺失时直接创建）

依赖：仅 antd + `@ant-design/icons-vue`。路径建议 `src/components/DetailPageHeader.vue`。

```vue
<template>
  <div class="detail-page-header">
    <a-button class="back-btn" @click="emit('close')">
      <template #icon><RollbackOutlined /></template>
      返回
    </a-button>
    <!-- 头部元信息区（可选）：调用方透传（订单号/状态等），紧跟返回按钮右侧；不传即不渲染 -->
    <div v-if="$slots.meta" class="header-meta">
      <slot name="meta" />
    </div>
    <a-breadcrumb class="header-breadcrumb">
      <a-breadcrumb-item>{{ parentTitle }}</a-breadcrumb-item>
      <a-breadcrumb-item>{{ title }}</a-breadcrumb-item>
    </a-breadcrumb>
    <!-- 右侧动作区（可选）：详情层把单据动作贴标题行右端时用；未提供插槽时不渲染 -->
    <div v-if="$slots.extra" class="header-extra">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { RollbackOutlined } from '@ant-design/icons-vue';

defineProps<{
  /** 当前操作名（面包屑第二级） */
  title: string;
  /** 面包屑上的列表页标题（页面内视图切换，无路由，纯文本展示） */
  parentTitle: string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.detail-page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--spacing-md);
}

.back-btn {
  flex-shrink: 0;
}

/* 头部元信息区：紧跟返回按钮右侧（订单号/状态等，由调用方透传） */
.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-breadcrumb {
  font-size: 13px;
  min-width: 0;
}

/* 右侧动作区：贴标题行右端，窄视口折行不溢出 */
.header-extra {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
```

插槽契约：`#meta`（返回右侧元信息）/ `#extra`（操作按钮，`margin-left:auto` 靠右 + flex 折行防窄视口溢出）；`title`/`parentTitle` 为**必填** props（面包屑恒渲染：`parentTitle`=列表页标题，`title`=当前操作名，随三态切换）。插槽不传即不渲染，复用方零影响；详情页头部新增能力走**加插槽级最小增量**，不改既有插槽语义。

### S12 AG Grid 一次性接入（目标项目未用时：装好配置好，效果与样板一致）

目标项目未用 AG Grid 时**直接接入，不走 a-table 模拟**。按序完成 1-6，接好后按 S5-S8 施工。

**1. 依赖（版本对齐样板）**：

```bash
npm i ag-grid-community@^35.3.1 ag-grid-vue3@^35.3.1 ag-grid-enterprise@^35.3.1
```

**2. 应用入口注册（main.ts）**：

```ts
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { config } from './config';

// AG Grid：注册社区版 + 企业版模块；许可证取自运行时 config.js（缺失回退 .env，仍缺则跳过——企业功能降级并打 console 提示）
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);
if (config.AG_GRID_LICENSE_KEY) {
  LicenseManager.setLicenseKey(config.AG_GRID_LICENSE_KEY);
}
```

**3. license key 运行时注入（key 明文禁入仓库/技能/代码——从既有环境的 .env 或部署 config.js 迁移 key 值）**：

```ts
// config/index.ts
// window.APP_CONFIG 的全局类型声明（缺此块则取值处过不了 vue-tsc 严格门）
declare global {
  interface Window {
    APP_CONFIG: AppConfig;
  }
}

export interface AppConfig {
  API_BASE_URL: string;
  AG_GRID_LICENSE_KEY: string;
}

const appConfig: AppConfig = {
  API_BASE_URL: /* 目标项目既有取值 */,
  // AG Grid 许可证：以运行时 config.js 为准（dev/prod 同一套），缺失时回退 .env
  AG_GRID_LICENSE_KEY: window.APP_CONFIG?.AG_GRID_LICENSE_KEY || import.meta.env.VITE_AG_GRID_LICENSE_KEY || '',
};
```

配套：`public/config.js` 部署侧写 `window.APP_CONFIG = { AG_GRID_LICENSE_KEY: '<公司 license>' }`；开发侧 `.env` 写 `VITE_AG_GRID_LICENSE_KEY=<公司 license>`（.env 在 gitignore 内）。key 未配置时企业功能降级 + console 试用提示（属已知噪声，断言控制台清零时排除；有 key 则无 banner——接入后先验证此项确认 key 生效）。

过期 key 场景：已注入但已过期的 key（如随仓分发的试用 key）仍会打 license banner，效果同未注入——验证门「无 banner」项仅对**有效** key 成立；过期/缺失场景一律按已知噪声排除并在验收报告记录偏差。

**4. 全局视觉适配（style.css 全局段——锁定与 antd 主题一致的观感）**：

```css
/* ============================================
 * AG Grid 基础视觉（ag-grid 原生类名，全局统一，供数据表格页复用）
 * 说明：ag-grid 主题在运行时注入 <style>，与下列同层选择器存在覆盖竞争，
 * 故统一加 !important 以锁定既有观感
 * ============================================ */
.ag-root-wrapper,
.ag-root {
  border: none !important;
  /* 主题自带浅色底（Alpine --ag-background-color 为白），暗色主题会露白底：
     根层透传父级（卡片）底色，行/表头各有着色，浅·暗自动随主题 */
  background-color: transparent !important;
  font-family: inherit;
  color: var(--text-primary);
}

/* 表头：接近白色底 + 底边线（--grid-header-bg 随主题切换，口径同列表 antd 表头） */
.ag-header {
  background-color: var(--grid-header-bg) !important;
  border-bottom: 1px solid var(--border-color, #dfe1e6) !important;
}

.ag-header-cell-text {
  font-size: 13px !important;
  font-weight: 600 !important;
  color: var(--text-primary) !important;
}

/* 字号与表头对齐；line-height 不覆写——ag-grid 主题按行高自适应算得
   --ag-internal-content-line-height = 行高 − 边框，恰等于单元格内容区高度，
   从而 scrollHeight == clientHeight（无垂直溢出）；若强行覆写为大于内容区高度的绝对值，
   会触发内部纵向滚动判定为真，被 tooltipShowMode='whenTruncated' 误判成
   「已截断」而对短内容乱弹气泡 */
.ag-cell {
  font-size: 13px !important;
}

.ag-row {
  background-color: transparent !important;
}

.ag-row-hover {
  background-color: var(--bg-hover, #fafafa) !important;
}

.ag-overlay-loading-wrapper {
  background-color: rgba(255, 255, 255, 0.05);
}
```

依赖的 CSS 变量：`--text-primary` / `--border-color` / `--bg-hover` / `--bg-container` / `--spacing-lg` 属常见主题基础变量（缺失按语义补齐）；`--grid-header-bg` 为样板专属变量，三主题各定义一次——亮色 `#fafafa`、亮色变体 `#fafbfc`、暗色 `#21262d`。目标项目无同名变量时按上述取值补齐或映射到既有变量（`var()` 处无 fallback，漏补即表头背景透明）。

**5. 中文 locale（`AG_GRID_LOCALE_CN`，挂 `gridOptions.localeText`）**：完整包为 `utils/agGrid/locale.ts`（约 680 行，ag-grid v35 官方 LocaleText key 对照翻译，纯数据文件不入本文）。获取方式按序：
   ① 同仓库跨分支：`git checkout <样板分支> -- frontend/src/utils/agGrid/`（连目录带文件一步拉齐；本仓库样板分支为 `feature/ui-upgrade`，等价按引入提交 `e6f33915` 取）；
   ② 跨仓库：从样板仓库复制该文件（或从来源项目移植）；
   ③ 均不可达：按 ag-grid v35 官方 LocaleText key 清单自建，缺省回落英文不阻塞功能（企业列筛选/分页菜单文案为英文——须在方案中向用户说明效果差异）。

**6. 页面级组件模板（效果一致性关键件，按目标页面业务替换字段/动作）**：

```ts
// 空态文案源：目标页面的空态口径（本仓库为列表查询门 useListQueryGate 的 emptyText；
// 无此基建的目标仓库回落「暂无数据」常量）
// 空态 overlay 模板；gridOptions 为普通对象（T15）——overlayNoRowsTemplate 只取初值，
// 文案变化须经下方 watch + gridApi 手动同步，否则沿用旧文案
const emptyOverlayHtml = computed(() => `<div class="grid-empty">${emptyText.value}</div>`);

watch(emptyOverlayHtml, (html) => {
  const api = gridApi.value;
  if (!api) return;
  api.setGridOption('overlayNoRowsTemplate', html);
  // 加载中不强制重渲：文案由「未查询指引」翻成「暂无数据」的瞬间数据未回，
  // 就调 showNoRowsOverlay 会把 loading 盖成空态（首次查询可见）
  if (api.getGridOption('loading')) return;
  // 模板变更时若正处于空态，强制重渲染 overlay（否则沿用旧文案）
  if (api.getDisplayedRowCount() === 0) {
    api.showNoRowsOverlay();
  }
});

/** hover 全文提示组件：是否该弹由 grid 原生 tooltipShowMode='whenTruncated'（溢出判定）决定；
 *  内容优先取格式化文本（valueFormatter 后），无格式化回落原始值 */
const CustomTooltip = defineComponent({
  name: 'XxGridTooltip',
  props: {
    params: { type: Object as PropType<Record<string, any>>, required: true },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          class: 'xx-grid-tooltip',
          style: {
            maxWidth: '300px',
            maxHeight: '200px',
            overflow: 'auto',
            padding: '6px 10px',
            backgroundColor: 'var(--bg-container, #fff)',
            border: '1px solid var(--border-color, #ddd)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            fontSize: '12px',
            lineHeight: '1.5',
            wordBreak: 'break-word',
            whiteSpace: 'normal',
            color: 'var(--text-secondary, #595959)',
          },
        },
        props.params.valueFormatted ?? props.params.value ?? '',
      );
  },
});

/** 文本列 hover 显示完整内容（valueFormatter 列显示格式化后文本；空值不弹） */
function textTooltip(p: { value?: unknown; valueFormatted?: string | null }): string | null {
  const text = p.valueFormatted ?? p.value;
  return text == null || text === '' ? null : String(text);
}

/** 单号列渲染器：链接点击进查看详情（保留原 a-table 单号链接交互） */
const OrderNoCellRenderer = defineComponent({
  name: 'XxOrderNoCell',
  props: {
    params: { type: Object as PropType<ICellRendererParams<XxListItem>>, required: true },
  },
  setup(props) {
    return () => {
      const record = props.params.data;
      // 行销毁瞬间 data 可能缺位，渲染空壳避免半途取值报错
      if (!record) return h('div');
      return h('a', { class: 'xx-no-link', onClick: () => openDetail('view', record.id) }, record.orderNo);
    };
  },
});

/** 行动作集合（原操作列逻辑抽出，供 hover 浮层复用）。
 *  2026-10-26 用户口径：不满足资格的动作不渲染（禁止置灰 + Tooltip 常驻）；
 *  零动作行由 S6 不浮出。资格与后端守卫同口径，三处同源（浮层 / 批量 / isRowSelectable）。
 *  危险动作的确认用居中 Modal.confirm，禁止 Popconfirm 气泡。 */
function buildRowActions(record: XxListItem): VNode[] {
  const actions: VNode[] = [];
  actions.push(h('a', { class: 'action-view', onClick: () => openDetail('view', record.id) }, [h(EyeOutlined), ' 查看详情']));
  if (canEdit(record)) {
    actions.push(h('a', { class: 'action-edit', onClick: () => openDetail('edit', record.id) }, [h(EditOutlined), ' 编辑']));
  }
  if (canDelete(record)) {
    actions.push(h('a', { class: 'action-delete', onClick: () => confirmDelete(record) }, [h(DeleteOutlined), ' 删除']));
  }
  return actions; // 动作集按目标页面业务增删；条件与后端守卫逐项同源
}

/** 行内确认：居中 Modal.confirm。onOk 里是原删除 handler（API、成功刷新、错误展示逐字搬入）。 */
function confirmDelete(record: XxListItem) {
  Modal.confirm({
    title: '确认删除',
    content: '确认删除该记录？',
    okButtonProps: { danger: true },
    onOk: () => deleteRecord(record.id),
  });
}

/** 行 hover 操作浮层内容组件：与批量按钮、复选框资格三处同源（buildRowActions 唯一出处） */
const RowActions = defineComponent({
  name: 'XxRowActions',
  props: {
    record: { type: Object as PropType<XxListItem>, required: true },
  },
  setup(props) {
    return () => h('div', { class: 'grid-actions' }, buildRowActions(props.record));
  },
});

/** antd 色名 → grid-tag 类名（状态 tag 用 antd 预设色名，映射到页内 tag 样式） */
const TAG_COLOR_CLASS: Record<string, string> = {
  default: 'grid-tag-default',
  processing: 'grid-tag-blue',
  success: 'grid-tag-green',
  green: 'grid-tag-green',
  blue: 'grid-tag-blue',
  orange: 'grid-tag-orange',
  red: 'grid-tag-red',
};

function statusTagHtml(text: string, antdColor: string | undefined): string {
  const cls = TAG_COLOR_CLASS[antdColor || 'default'] ?? 'grid-tag-default';
  return `<span class="grid-tag ${cls}">${text}</span>`;
}
```

配套非 scoped CSS（状态 tag / 单号链接 / 动作链接 / 空态，放 `<style>` 非 scoped 块、页面根类限定）：

```css
.xx-list .grid-tag {
  display: inline-block;
  padding: 0 7px;
  font-size: 12px;
  line-height: 20px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.xx-list .grid-tag-green { color: #389e0d; background: #f6ffed; border-color: #b7eb8f; }
.xx-list .grid-tag-blue { color: #1677ff; background: #e6f4ff; border-color: #91caff; }
.xx-list .grid-tag-orange { color: #d46b08; background: #fff7e6; border-color: #ffd591; }
.xx-list .grid-tag-red { color: #cf1322; background: #fff1f0; border-color: #ffa39e; }
.xx-list .grid-tag-default { color: #595959; background: #fafafa; border-color: #d9d9d9; }
.xx-list .xx-no-link { color: var(--primary-color, #1677ff); cursor: pointer; }
.xx-list .xx-no-link:hover { text-decoration: underline; }
.xx-list .grid-actions { display: flex; gap: 8px; align-items: center; }
.xx-list .action-view { color: var(--text-secondary, #666); cursor: pointer; font-size: 13px; }
.xx-list .action-view:hover { color: var(--primary-color, #1677ff); }
.xx-list .action-edit { color: var(--primary-color, #1677ff); cursor: pointer; font-size: 13px; }
.xx-list .action-delete { color: #ff4d4f; cursor: pointer; font-size: 13px; }
.xx-list .grid-empty { padding: 32px 0; color: var(--text-secondary, #999); text-align: center; }
```

**接入验收**：控制台无 license 试用 banner（key 生效证明）；表格视觉与样板一致（表头/行 hover/字号/tag）；企业功能（列菜单等）文案为中文（locale 生效证明）。
