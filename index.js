/**
 * 评论区树状显示（threaded-comments）
 *
 * 把宿主评论组件的楼层回复，按回复关系以缩进树的形式展示。
 * 关系来源：拦截 /comment/* 响应，旁路缓存每条回复的 pid 与「昵称 + 时间」对齐键；
 * DOM 侧只写 data-echo-* 属性，缩进与引导线全部交给 CSS，不移动宿主节点。
 */

const STORAGE_KEY = "threaded-comments:settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "lineKeepMain",
  container: false,
  containerHeight: 480,
  paginate: false,
};

const MIN_CONTAINER_HEIGHT = 240;
const MAX_CONTAINER_HEIGHT = 960;
const DEFAULT_CONTAINER_HEIGHT = 480;
const MAX_DEPTH = 10;
const MAX_META_ENTRIES = 4800;
const MAX_COLLAPSED_KEYS = 400;
const ROOTS_PER_PAGE = 20;
const MIN_INDENT_STEP = 19;
const NARROW_WIDTH = 640;
const NARROW_INDENT_STEP = 24;
const WIDE_INDENT_STEP = 32;
const MIN_CONTENT_WIDTH = 150;

const MODES = ["lineCollapseMain", "lineKeepMain", "indentOnly"];

const MODE_OPTIONS = [
  { label: "线条模式 · 收起主评论", value: "lineCollapseMain" },
  { label: "线条模式 · 不收起主评论", value: "lineKeepMain" },
  { label: "仅缩进", value: "indentOnly" },
];

const MODE_HINTS = {
  lineCollapseMain: "折叠时连父评论正文一起收起，只保留作者行与恢复按钮。",
  lineKeepMain: "折叠时保留父评论正文，只隐藏它下面的回复。",
  indentOnly: "只做缩进，不显示引导线与折叠按钮。",
};

/* ------------------------------------------------------------------ *
 * 纯函数（导出供单测）
 * ------------------------------------------------------------------ */

const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampHeight = (value) =>
  Math.min(MAX_CONTAINER_HEIGHT, Math.max(MIN_CONTAINER_HEIGHT, Math.round(value)));

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const mode = MODES.includes(source.mode) ? source.mode : DEFAULT_SETTINGS.mode;
  const height = toFiniteNumber(source.containerHeight, DEFAULT_CONTAINER_HEIGHT);
  return {
    enabled: source.enabled === undefined ? DEFAULT_SETTINGS.enabled : Boolean(source.enabled),
    mode,
    container: Boolean(source.container),
    containerHeight: clampHeight(height),
    paginate: Boolean(source.paginate),
  };
}

export function resolveMetaKey(name, time) {
  const collapse = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const author = collapse(name);
  const stamp = collapse(String(time == null ? "" : time).split("·")[0]);
  if (!author || !stamp) return "";
  return author + "\u0000" + stamp;
}

export const computeDepthCap = (depth) => {
  const value = Math.floor(toFiniteNumber(depth, 0));
  return Math.max(0, Math.min(MAX_DEPTH, value));
};

/**
 * 由 [{ id, pid, time }] 生成 [{ id, depth, parentId, hasChildren, descendantCount }]。
 * 输出按「父先子后」的深度优先顺序；同级按 time 升序、时间相同时按输入顺序。
 * pid 指向不存在的节点时视作根；成环的节点全部降级为根，避免死循环。
 */
export function buildThreadTree(items, maxDepth) {
  const cap = maxDepth === undefined ? MAX_DEPTH : computeDepthCap(maxDepth);
  const input = Array.isArray(items) ? items : [];
  const byId = new Map();
  input.forEach((item, index) => {
    const id = String(item && item.id != null ? item.id : "");
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      pid: item && item.pid != null ? String(item.pid) : "",
      time: toFiniteNumber(item && item.time, 0),
      index,
    });
  });

  const parentOf = new Map();
  for (const node of byId.values()) {
    const pid = node.pid;
    parentOf.set(node.id, pid && pid !== node.id && byId.has(pid) ? pid : null);
  }

  // 断环：沿父链上溯，遇到本次上溯已访问的节点即视为成环，环上所有节点降级为根。
  const settled = new Set();
  for (const node of byId.values()) {
    if (settled.has(node.id)) continue;
    const path = [];
    const onPath = new Set();
    let cursor = node.id;
    while (cursor && !settled.has(cursor)) {
      if (onPath.has(cursor)) break;
      onPath.add(cursor);
      path.push(cursor);
      cursor = parentOf.get(cursor) || null;
    }
    if (cursor && onPath.has(cursor)) {
      for (const id of path) parentOf.set(id, null);
    }
    for (const id of path) settled.add(id);
  }

  const children = new Map();
  const roots = [];
  for (const node of byId.values()) {
    const pid = parentOf.get(node.id);
    if (pid) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(node.id);
    } else {
      roots.push(node.id);
    }
  }

  const compare = (left, right) => {
    const diff = byId.get(left).time - byId.get(right).time;
    return diff !== 0 ? diff : byId.get(left).index - byId.get(right).index;
  };
  roots.sort(compare);
  for (const list of children.values()) list.sort(compare);

  const out = [];
  const visited = new Set();
  const walk = (id, depth) => {
    if (visited.has(id)) return;
    visited.add(id);
    const kids = children.get(id) || [];
    const level = Math.min(depth, cap);
    out.push({
      id,
      depth: level,
      parentId: depth === 0 ? null : parentOf.get(id) || null,
      hasChildren: kids.length > 0,
      descendantCount: 0,
    });
    for (const kid of kids) walk(kid, level + 1);
  };
  for (const id of roots) walk(id, 0);
  for (const node of byId.values()) if (!visited.has(node.id)) walk(node.id, 0);

  const countDescendants = (id) => {
    let total = 0;
    const stack = (children.get(id) || []).slice();
    while (stack.length > 0) {
      const current = stack.pop();
      total += 1;
      stack.push(...(children.get(current) || []));
    }
    return total;
  };
  for (const node of out) node.descendantCount = countDescendants(node.id);

  return out;
}

/**
 * 把 buildThreadTree 的输出按「根回复」切成固定大小的页。
 * 返回 [{ id, page }]，page 从 0 开始；子回复与其根同页，保证一页内不出现断链。
 */
export function paginateTree(tree, perPage) {
  const size = Math.max(1, Math.floor(toFiniteNumber(perPage, ROOTS_PER_PAGE)));
  const out = [];
  let rootIndex = -1;
  for (const node of Array.isArray(tree) ? tree : []) {
    if (!node || !node.id) continue;
    if (node.depth === 0) rootIndex += 1;
    const page = rootIndex < 0 ? 0 : Math.floor(rootIndex / size);
    out.push({ id: node.id, page });
  }
  const pageCount = rootIndex < 0 ? 1 : Math.floor(rootIndex / size) + 1;
  return { pages: out, pageCount };
}

export const computeIndentStep = (width, maxDepth) => {
  const preferred = !Number.isFinite(width) || width <= NARROW_WIDTH ? NARROW_INDENT_STEP : WIDE_INDENT_STEP;
  if (!Number.isFinite(width) || width <= 0) return preferred;
  const depth = Math.max(1, computeDepthCap(maxDepth || 0));
  const fitted = (width - MIN_CONTENT_WIDTH) / depth;
  if (!Number.isFinite(fitted) || fitted <= 0) return preferred;
  const step = Math.max(MIN_INDENT_STEP, Math.min(preferred, fitted));
  return Math.round(step * 100) / 100;
};

/* ------------------------------------------------------------------ *
 * 关系缓存：/comment/* 响应 -> 「昵称 + 时间」-> { id, pid, timeMs }
 * ------------------------------------------------------------------ */

const metaByKey = new Map();
const keyOfId = new Map();

const pickString = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const parseTimeMs = (value) => {
  const parsed = Date.parse(String(value == null ? "" : value).replace(/-/g, "/").split("·")[0].trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 淘汰不能只看插入顺序：用户正在看的楼层往往是最早加载的，后续楼层的 pid 仍指向它。
 * 因此把在线楼层用到的键（含其父键）按引用计数保护起来，淘汰时跳过；
 * 全被保护时退化为普通插入序淘汰，保证缓存有界。
 */
const protectCounts = new Map();
const protectedByContainer = new Map();

const releaseProtection = (container) => {
  const previous = protectedByContainer.get(container);
  if (!previous) return;
  protectedByContainer.delete(container);
  for (const key of previous) {
    const next = (protectCounts.get(key) || 0) - 1;
    if (next > 0) protectCounts.set(key, next);
    else protectCounts.delete(key);
  }
};

const protectKeys = (container, keys) => {
  releaseProtection(container);
  const set = new Set();
  for (const key of keys) {
    if (!key) continue;
    set.add(key);
    const entry = metaByKey.get(key);
    const parentKey = entry && entry.pid ? keyOfId.get(entry.pid) : "";
    if (parentKey) set.add(parentKey);
  }
  if (set.size === 0) return;
  protectedByContainer.set(container, set);
  for (const key of set) protectCounts.set(key, (protectCounts.get(key) || 0) + 1);
};

const dropMeta = (key) => {
  const entry = metaByKey.get(key);
  if (!entry) return;
  metaByKey.delete(key);
  if (entry.id && keyOfId.get(entry.id) === key) keyOfId.delete(entry.id);
};

const evictOne = () => {
  for (const key of metaByKey.keys()) {
    if (protectCounts.has(key)) continue;
    dropMeta(key);
    return true;
  }
  const oldest = metaByKey.keys().next().value;
  if (oldest === undefined) return false;
  dropMeta(oldest);
  return true;
};

const rememberRelation = (key, entry) => {
  if (!key || !entry || !entry.id) return;
  if (metaByKey.has(key)) metaByKey.delete(key);
  metaByKey.set(key, entry);
  keyOfId.set(entry.id, key);
  // 加了 guard：若所有条目都受保护，evictOne 会退化为插入序淘汰，仍可能一次删不完，避免死循环。
  let guard = metaByKey.size;
  while (metaByKey.size > MAX_META_ENTRIES && guard-- > 0) {
    if (!evictOne()) break;
  }
};

const resetMetaCaches = () => {
  metaByKey.clear();
  keyOfId.clear();
  protectCounts.clear();
  protectedByContainer.clear();
};

const collectRelations = (node, depth) => {
  if (!node || typeof node !== "object" || (depth || 0) > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRelations(item, depth || 0);
    return;
  }
  const id = pickString(node.comment_id, node.id);
  const author = pickString(node.user_name, node.nickname, node.userName);
  const stamp = pickString(node.addtime, node.add_time, node.time);
  if (id && author && stamp) {
    const key = resolveMetaKey(author, stamp);
    if (key) {
      rememberRelation(key, {
        id,
        pid: pickString(node.pid, node.parent_id, ""),
        timeMs: parseTimeMs(stamp),
      });
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectRelations(value, (depth || 0) + 1);
  }
};

/* ------------------------------------------------------------------ *
 * 运行时状态
 * ------------------------------------------------------------------ */

let runtimeState = null;
let styleDispose = null;
let settingsDispose = null;
let interceptDispose = null;
let observeDispose = null;

const containerStates = new Map();

const readSettings = () => (runtimeState ? runtimeState.settings : DEFAULT_SETTINGS);

const isReplyElement = (element) =>
  Boolean(element && element.classList && element.classList.contains("comment-floor-reply"));

const readReplyKey = (element) => {
  const nameElement = element.querySelector(".comment-floor-reply-name");
  const timeElement = element.querySelector(".comment-floor-reply-time");
  return resolveMetaKey(
    nameElement ? nameElement.textContent : "",
    timeElement ? timeElement.textContent : "",
  );
};

const applyContainer = (container) => {
  const state = containerStates.get(container);
  if (!state) return;
  const settings = readSettings();

  if (!settings.enabled) {
    clearContainerMarks(container);
    return;
  }

  const replies = Array.from(container.children).filter(isReplyElement);

  container.setAttribute("data-echo-thread", "on");
  container.setAttribute("data-echo-mode", settings.mode);
  container.setAttribute("data-echo-guides", settings.mode === "indentOnly" ? "off" : "on");
  if (settings.container) {
    container.setAttribute("data-echo-container", "on");
    container.style.setProperty("--echo-tree-container-height", settings.containerHeight + "px");
  } else {
    container.removeAttribute("data-echo-container");
    container.style.removeProperty("--echo-tree-container-height");
  }

  const keys = replies.map(readReplyKey);
  protectKeys(container, keys);
  const keyCount = new Map();
  for (const key of keys) {
    if (!key) continue;
    keyCount.set(key, (keyCount.get(key) || 0) + 1);
  }

  const items = [];
  keys.forEach((key) => {
    if (!key || keyCount.get(key) !== 1) return;
    const entry = metaByKey.get(key);
    items.push({
      id: key,
      pid: entry && entry.pid ? keyOfId.get(entry.pid) || "" : "",
      time: entry ? entry.timeMs : 0,
    });
  });

  const tree = buildThreadTree(items);
  const nodeById = new Map(tree.map((node) => [node.id, node]));
  const maxDepth = tree.reduce((acc, node) => Math.max(acc, node.depth), 0);
  const step = computeIndentStep(container.clientWidth, maxDepth);
  container.style.setProperty("--echo-tree-step", step + "px");

  // 分页只看根：子回复跟随所属根，一页内不出现断链。
  let pageById = null;
  let pageCount = 1;
  if (settings.paginate) {
    const paged = paginateTree(tree, ROOTS_PER_PAGE);
    pageCount = paged.pageCount;
    state.pageCount = pageCount;
    if (state.page >= pageCount) state.page = pageCount - 1;
    if (state.page < 0) state.page = 0;
    pageById = new Map(paged.pages.map((entry) => [entry.id, entry.page]));
  } else {
    state.page = 0;
  }

  const hiddenById = new Map();
  for (const node of tree) {
    const parentHidden = node.parentId ? hiddenById.get(node.parentId) === true : false;
    const parentCollapsed = node.parentId ? state.collapsed.has(node.parentId) : false;
    const pageHidden =
      pageById !== null && node.depth === 0 && pageById.get(node.id) !== state.page;
    hiddenById.set(node.id, parentHidden || parentCollapsed || pageHidden);
  }

  replies.forEach((element, index) => {
    const key = keys[index];
    const node = key && keyCount.get(key) === 1 ? nodeById.get(key) : undefined;
    const depth = node ? node.depth : 0;

    element.setAttribute("data-echo-tree", "on");
    element.setAttribute("data-echo-tree-depth", String(depth));
    element.style.setProperty("--echo-tree-depth", String(depth));

    if (node && node.hasChildren) {
      const collapsed = state.collapsed.has(node.id);
      element.setAttribute("data-echo-tree-branch", "on");
      element.setAttribute("data-echo-tree-tail", "+" + node.descendantCount);
      if (collapsed) element.setAttribute("data-echo-tree-collapsed", "on");
      else element.removeAttribute("data-echo-tree-collapsed");
    } else {
      element.removeAttribute("data-echo-tree-branch");
      element.removeAttribute("data-echo-tree-tail");
      element.removeAttribute("data-echo-tree-collapsed");
    }

    if (node && hiddenById.get(node.id) === true) element.setAttribute("data-echo-tree-hidden", "on");
    else element.removeAttribute("data-echo-tree-hidden");

    syncToggle(element, node, settings, state);
  });

  syncPager(container, state, settings, pageCount);
};

const directChild = (parent, className) =>
  Array.from(parent.children || []).find(
    (child) => child.classList && child.classList.contains(className),
  ) || null;

/**
 * 分页控件。插在宿主「加载更多回复」之前：
 * 页内翻页只改可见性；已在末页且宿主还有更多时，「下一页」直接触发宿主的加载更多，
 * 把请求职责交回宿主，插件不碰 Vue 状态。
 */
const syncPager = (container, state, settings, pageCount) => {
  let pager = directChild(container, "echo-tree-pager");
  if (!settings.paginate || pageCount <= 1) {
    if (pager) pager.remove();
    if (!settings.paginate) state.page = 0;
    return;
  }
  if (!pager) {
    pager = document.createElement("div");
    pager.className = "echo-tree-pager";
    const more = directChild(container, "comment-floor-more");
    if (more) container.insertBefore(pager, more);
    else container.appendChild(pager);
  }

  const isFirst = state.page <= 0;
  const isLast = state.page >= pageCount - 1;
  const hasMoreFromHost = Boolean(
    (() => {
      const more = directChild(container, "comment-floor-more");
      return more && directChild(more, "comment-floor-more-btn");
    })(),
  );

  const makeButton = (className, text) => {
    let button = directChild(pager, className);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "echo-tree-pager-btn " + className;
      pager.appendChild(button);
    }
    if (button.textContent !== text) button.textContent = text;
    return button;
  };

  const label = "第 " + (state.page + 1) + " / " + pageCount + " 页";
  let info = directChild(pager, "echo-tree-pager-info");
  if (!info) {
    info = document.createElement("span");
    info.className = "echo-tree-pager-info";
    pager.appendChild(info);
  }
  if (!pager.contains(info)) pager.appendChild(info);
  if (info.textContent !== label) info.textContent = label;

  const prev = makeButton("echo-tree-pager-prev", "上一页");
  const next = makeButton("echo-tree-pager-next", isLast && hasMoreFromHost ? "加载更多" : "下一页");
  if (isFirst) prev.setAttribute("disabled", "disabled");
  else prev.removeAttribute("disabled");
  if (isLast && !hasMoreFromHost) next.setAttribute("disabled", "disabled");
  else next.removeAttribute("disabled");

  // 顺序：上一页 / 信息 / 下一页
  if (pager.children[0] !== prev) pager.insertBefore(prev, pager.children[0] || null);
  if (pager.children[1] !== info) pager.insertBefore(info, pager.children[1] || null);
  if (pager.children[2] !== next) pager.insertBefore(next, pager.children[2] || null);
};

/**
 * 翻页只改可见性；末页且宿主还有更多时，把点击转发给宿主的「加载更多回复」按钮，
 * 让宿主自己发请求、自己合并列表 —— 插件不复制宿主的请求与状态。
 */
const handlePagerClick = (container, pager, button) => {
  const state = containerStates.get(container);
  if (!state || !pager) return;
  if (button.classList.contains("echo-tree-pager-prev")) {
    if (state.page <= 0) return;
    state.page -= 1;
    scheduleApply(container);
    return;
  }
  if (!button.classList.contains("echo-tree-pager-next")) return;
  if (state.page >= state.pageCount - 1) {
    const moreButton = forwardLoadMore(container);
    if (moreButton) moreButton.click();
    return;
  }
  state.page += 1;
  scheduleApply(container);
};

const forwardLoadMore = (container) => {
  const more = directChild(container, "comment-floor-more");
  return more ? directChild(more, "comment-floor-more-btn") : null;
};

const syncToggle = (element, node, settings, state) => {
  const header = element.querySelector(".comment-floor-reply-header");
  const existing = header ? header.querySelector(".echo-tree-toggle") : null;
  if (!header || !node || !node.hasChildren || settings.mode === "indentOnly") {
    if (existing) existing.remove();
    return;
  }
  let button = existing;
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "echo-tree-toggle";
    header.appendChild(button);
  }
  const collapsed = state.collapsed.has(node.id);
  button.setAttribute("data-echo-tree-key", node.id);
  button.textContent = collapsed ? "+" + node.descendantCount : "−";
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", collapsed ? "展开回复" : "收起回复");
  button.setAttribute("title", collapsed ? "展开回复" : "收起回复");
};

const clearContainerMarks = (container) => {
  releaseProtection(container);
  container.removeAttribute("data-echo-thread");
  container.removeAttribute("data-echo-mode");
  container.removeAttribute("data-echo-guides");
  container.removeAttribute("data-echo-container");
  container.style.removeProperty("--echo-tree-container-height");
  container.style.removeProperty("--echo-tree-step");
  const replies = Array.from(container.querySelectorAll(".comment-floor-reply"));
  for (const element of replies) {
    element.removeAttribute("data-echo-tree");
    element.removeAttribute("data-echo-tree-depth");
    element.removeAttribute("data-echo-tree-branch");
    element.removeAttribute("data-echo-tree-tail");
    element.removeAttribute("data-echo-tree-collapsed");
    element.removeAttribute("data-echo-tree-hidden");
    element.style.removeProperty("--echo-tree-depth");
    const button = element.querySelector(".echo-tree-toggle");
    if (button) button.remove();
  }
  const pager = directChild(container, "echo-tree-pager");
  if (pager) pager.remove();
};

const scheduleApply = (container) => {
  const state = containerStates.get(container);
  if (!state || state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    if (!container.isConnected) return;
    applyContainer(container);
  });
};

const setupContainer = (container) => {
  if (containerStates.has(container)) {
    applyContainer(container);
    return;
  }

  const state = { collapsed: new Set(), page: 0, pageCount: 1, frame: 0, observer: null, onClick: null };
  containerStates.set(container, state);

  state.onClick = (event) => {
    const target = event.target;
    if (target && target.closest) {
      const pagerButton = target.closest(".echo-tree-pager-btn");
      if (pagerButton && container.contains(pagerButton)) {
        event.preventDefault();
        event.stopPropagation();
        handlePagerClick(container, target.closest(".echo-tree-pager"), pagerButton);
        return;
      }
    }
    const button =
      target && target.closest ? target.closest(".comment-floor-reply-header > .echo-tree-toggle") : null;
    if (!button || !container.contains(button)) return;
    const key = button.getAttribute("data-echo-tree-key");
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if (state.collapsed.has(key)) {
      state.collapsed.delete(key);
    } else {
      state.collapsed.add(key);
      // 折叠键按「昵称\0时间」记，跨加载更多稳定；集合自身必须有界。
      while (state.collapsed.size > MAX_COLLAPSED_KEYS) {
        const oldest = state.collapsed.values().next().value;
        if (oldest === undefined) break;
        state.collapsed.delete(oldest);
      }
    }
    scheduleApply(container);
  };
  container.addEventListener("click", state.onClick, true);

  state.observer = new MutationObserver(() => scheduleApply(container));
  state.observer.observe(container, { childList: true, subtree: true, characterData: true });

  applyContainer(container);

  return () => teardownContainer(container);
};

const teardownContainer = (container) => {
  const state = containerStates.get(container);
  if (!state) return;
  if (state.frame) cancelAnimationFrame(state.frame);
  state.observer?.disconnect();
  if (state.onClick) container.removeEventListener("click", state.onClick, true);
  clearContainerMarks(container);
  containerStates.delete(container);
};

const refreshAll = () => {
  for (const container of containerStates.keys()) {
    if (container.isConnected) applyContainer(container);
  }
};

/* ------------------------------------------------------------------ *
 * 设置页
 * ------------------------------------------------------------------ */

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "ThreadedCommentsSettings",
    setup() {
      const { computed, defineAsyncComponent, h } = ctx.vue;
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);

      const settings = computed(() => (runtimeState ? runtimeState.settings : DEFAULT_SETTINGS));

      const patch = (value) => {
        if (!runtimeState) return;
        const next = normalizeSettings({ ...runtimeState.settings, ...value });
        Object.assign(runtimeState.settings, next);
        void Promise.resolve(ctx.storage.set(STORAGE_KEY, next)).catch((error) => {
          ctx.toast.warning("树状评论设置保存失败：" + (error instanceof Error ? error.message : String(error)));
        });
        refreshAll();
      };

      const field = (label, description, control) =>
        h("div", { class: "echo-tc-field" }, [
          h("span", { class: "echo-tc-copy" }, [
            h("span", { class: "echo-tc-label" }, label),
            description ? h("span", { class: "echo-tc-desc" }, description) : null,
          ]),
          h("span", { class: "echo-tc-control" }, control),
        ]);

      return () =>
        h("div", { class: "echo-tc-settings" }, [
          field(
            "评论区树状显示",
            "把楼层回复按回复关系缩进展示。",
            h(Switch, {
              modelValue: settings.value.enabled,
              "onUpdate:modelValue": (value) => patch({ enabled: Boolean(value) }),
            }),
          ),
          settings.value.enabled
            ? field(
                "固定高度回复容器",
                "回复较多时在固定高度内滚动，较少时自动收缩。",
                h(Switch, {
                  modelValue: settings.value.container,
                  "onUpdate:modelValue": (value) => patch({ container: Boolean(value) }),
                }),
              )
            : null,
          settings.value.enabled && settings.value.container
            ? field(
                "容器最大高度",
                MIN_CONTAINER_HEIGHT + "–" + MAX_CONTAINER_HEIGHT + " 像素。",
                h(Slider, {
                  modelValue: settings.value.containerHeight,
                  min: MIN_CONTAINER_HEIGHT,
                  max: MAX_CONTAINER_HEIGHT,
                  step: 20,
                  showValue: true,
                  valueSuffix: "px",
                  "onUpdate:modelValue": (value) => patch({ containerHeight: Number(value) }),
                }),
              )
            : null,
          settings.value.enabled
            ? field(
                "显示模式",
                MODE_HINTS[settings.value.mode],
                h(Select, {
                  modelValue: settings.value.mode,
                  options: MODE_OPTIONS,
                  "onUpdate:modelValue": (value) => patch({ mode: String(value) }),
                }),
              )
            : null,
          settings.value.enabled
            ? field(
                "楼层内分页",
                "每个根回复及其子回复算一页，每页 " + ROOTS_PER_PAGE + " 个根回复；末页可继续加载。",
                h(Switch, {
                  modelValue: settings.value.paginate,
                  "onUpdate:modelValue": (value) => patch({ paginate: Boolean(value) }),
                }),
              )
            : null,
          h("p", { class: "echo-tc-note" }, "调整后立即生效，评论楼层无需重新展开。"),
        ]);
    },
  });

/* ------------------------------------------------------------------ *
 * 样式
 * ------------------------------------------------------------------ */

const STYLE = `
.comment-floor-inline[data-echo-thread="on"] {
  --echo-tree-line: var(--border-subtle, rgba(255, 255, 255, 0.14));
}

.comment-floor-inline[data-echo-thread="on"] > .comment-floor-reply[data-echo-tree] {
  position: relative;
  margin-left: calc(var(--echo-tree-step, 32px) * var(--echo-tree-depth, 0));
}

.comment-floor-inline[data-echo-guides="on"]
  > .comment-floor-reply[data-echo-tree-depth]:not([data-echo-tree-depth="0"])::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--echo-tree-step, 32px) * var(--echo-tree-depth, 0) * -1);
  width: calc(var(--echo-tree-step, 32px) * var(--echo-tree-depth, 0));
  background-image: repeating-linear-gradient(
    to right,
    var(--echo-tree-line) 0 1px,
    transparent 1px var(--echo-tree-step, 32px)
  );
  pointer-events: none;
}

.comment-floor-inline[data-echo-guides="on"]
  > .comment-floor-reply[data-echo-tree-depth]:not([data-echo-tree-depth="0"])::after {
  content: "";
  position: absolute;
  top: 0;
  left: calc(var(--echo-tree-step, 32px) * -1);
  width: calc(var(--echo-tree-step, 32px) + 12px);
  height: 31px;
  border-left: 1px solid var(--echo-tree-line);
  border-bottom: 1px solid var(--echo-tree-line);
  border-bottom-left-radius: 10px;
  pointer-events: none;
}

.comment-floor-inline > .comment-floor-reply[data-echo-tree-hidden] {
  display: none !important;
}

.comment-floor-inline[data-echo-mode="lineCollapseMain"]
  > .comment-floor-reply[data-echo-tree-collapsed]
  .comment-floor-reply-body
  > :not(.comment-floor-reply-header) {
  display: none !important;
}

.comment-floor-inline[data-echo-container="on"] {
  max-height: var(--echo-tree-container-height, 480px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.echo-tree-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 0 2px;
}

.echo-tree-pager-btn {
  min-width: 64px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.16));
  border-radius: var(--radius-pill, 13px);
  background: var(--control-muted-bg, transparent);
  color: var(--color-text-secondary, inherit);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.echo-tree-pager-btn:hover:not([disabled]),
.echo-tree-pager-btn:focus-visible {
  border-color: var(--color-primary, #7cc6ff);
  color: var(--color-primary, #7cc6ff);
  outline: none;
}

.echo-tree-pager-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.echo-tree-pager-info {
  font-size: 12px;
  color: var(--color-text-secondary, inherit);
  font-variant-numeric: tabular-nums;
}

.echo-tree-toggle {
  flex: none;
  margin-left: 6px;
  min-width: 24px;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.16));
  border-radius: 9px;
  background: var(--control-muted-bg, transparent);
  color: var(--color-text-secondary, inherit);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.echo-tree-toggle:hover,
.echo-tree-toggle:focus-visible {
  border-color: var(--color-primary, #7cc6ff);
  color: var(--color-primary, #7cc6ff);
  outline: none;
}

.echo-tc-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.echo-tc-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.echo-tc-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.echo-tc-label {
  font-size: 13px;
  color: var(--color-text-main, inherit);
}

.echo-tc-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary, inherit);
}

.echo-tc-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 160px;
}

.echo-tc-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary, inherit);
}
`;

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

export async function activate(ctx) {
  const saved = await ctx.storage.get(STORAGE_KEY).catch(() => null);
  runtimeState = ctx.vue.reactive({ settings: normalizeSettings(saved) });

  styleDispose = ctx.css.inject(STYLE, { id: "threaded-comments" });

  settingsDispose = ctx.ui.settings.define({
    title: "评论区树状显示",
    description: "把楼层回复按回复关系缩进成树，支持引导线与分支折叠。",
    component: createSettingsComponent(ctx),
  });

  interceptDispose = ctx.server.intercept(
    async (request, next) => {
      const response = await next();
      try {
        if (response && response.body) collectRelations(response.body, 0);
      } catch (error) {
        console.warn("[threaded-comments] 回复关系采集失败", error);
      }
      return response;
    },
    { match: /^\/comment\//, priority: 90, name: "threaded-comments-collector" },
  );

  observeDispose = ctx.dom.observe(".comment-floor-inline", (container) => setupContainer(container));
}

export function deactivate() {
  for (const container of Array.from(containerStates.keys())) teardownContainer(container);
  containerStates.clear();
  resetMetaCaches();

  observeDispose?.();
  observeDispose = null;
  interceptDispose?.();
  interceptDispose = null;
  settingsDispose?.();
  settingsDispose = null;
  styleDispose?.();
  styleDispose = null;
  runtimeState = null;
}
