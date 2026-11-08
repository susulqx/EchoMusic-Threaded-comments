/**
 * 楼层容器的装配与重算。
 *
 * 一个 .comment-floor-inline 对应一份 state（折叠集合、页码、监听器）。
 * 触发路径有三条，全部汇到 scheduleApply：
 *   1. ctx.dom.observe 发现新容器（宿主的 MutationObserver，只在容器的父级上）
 *   2. 容器内部 MutationObserver（宿主追加「加载更多」的回复、Vue 更新文本）
 *   3. 用户点击折叠按钮 / 分页按钮
 *
 * 重算只写属性，不动节点顺序 —— 宿主的 keyed list 因此不会被打乱。
 */

import { MAX_COLLAPSED_KEYS, ROOTS_PER_PAGE } from "./constants.js";
import { clearContainerMarks, readReplies, readReplyKey } from "./dom.js";
import { resolveClick } from "./interactions.js";
import {
  lookupKeyById,
  lookupMeta,
  protectKeys,
  releaseProtection,
} from "./meta-cache.js";
import { syncPager } from "./pager.js";
import { getSettings } from "./runtime.js";
import { syncToggle } from "./toggle.js";
import { buildThreadTree, computeIndentStep, paginateTree } from "./tree.js";

/** container -> state，容器断开后由 teardownContainer 移除 */
const containerStates = new Map();

const scheduleApply = (container) => {
  const state = containerStates.get(container);
  if (!state || state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    if (!container.isConnected) return;
    applyContainer(container);
  });
};

/**
 * 把「同一楼层内重复的对齐键」排除在树之外。
 * 同昵称 + 同秒在单楼层内极少见，一旦出现就无法判断谁是谁，宁可全部按根级平铺。
 */
const collectItems = (keys) => {
  const keyCount = new Map();
  for (const key of keys) {
    if (!key) continue;
    keyCount.set(key, (keyCount.get(key) || 0) + 1);
  }

  const items = [];
  for (const key of keys) {
    if (!key || keyCount.get(key) !== 1) continue;
    const entry = lookupMeta(key);
    items.push({
      id: key,
      pid: entry && entry.pid ? lookupKeyById(entry.pid) : "",
      time: entry ? entry.timeMs : 0,
    });
  }
  return { items, keyCount };
};

/** 写容器级属性：模式、引导线开关、固定高度 */
const applyContainerAttrs = (container, settings) => {
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
};

/**
 * 分页：只看根回复，子回复跟随所属根，一页之内不出现断链。
 * 返回 null 表示当前没有分页；否则返回 id -> page 的映射。
 */
const applyPaging = (container, state, settings, tree) => {
  if (!settings.paginate) {
    state.page = 0;
    state.pageCount = 1;
    return null;
  }
  const paged = paginateTree(tree, ROOTS_PER_PAGE);
  state.pageCount = paged.pageCount;
  if (state.page >= paged.pageCount) state.page = paged.pageCount - 1;
  if (state.page < 0) state.page = 0;
  return new Map(paged.pages.map((entry) => [entry.id, entry.page]));
};

/** 逐层传播隐藏状态：祖先被折叠、或被分页挡在外面，整棵子树都隐藏 */
const computeHidden = (tree, state, pageById) => {
  const hiddenById = new Map();
  for (const node of tree) {
    const parentHidden = node.parentId ? hiddenById.get(node.parentId) === true : false;
    const parentCollapsed = node.parentId ? state.collapsed.has(node.parentId) : false;
    const pageHidden =
      pageById !== null && node.depth === 0 && pageById.get(node.id) !== state.page;
    hiddenById.set(node.id, parentHidden || parentCollapsed || pageHidden);
  }
  return hiddenById;
};

const applyReply = (element, node, depth, hidden, settings, state) => {
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

  if (hidden) element.setAttribute("data-echo-tree-hidden", "on");
  else element.removeAttribute("data-echo-tree-hidden");

  syncToggle(element, node, settings, Boolean(node && state.collapsed.has(node.id)));
};

/**
 * 重算一个楼层的全部标记。整个插件的视觉结果都由它决定。
 */
export const applyContainer = (container) => {
  const state = containerStates.get(container);
  if (!state) return;
  const settings = getSettings();

  if (!settings.enabled) {
    clearContainerMarks(container, releaseProtection);
    return;
  }

  const replies = readReplies(container);
  applyContainerAttrs(container, settings);

  const keys = replies.map(readReplyKey);
  protectKeys(container, keys);

  const { items, keyCount } = collectItems(keys);
  const tree = buildThreadTree(items);
  const nodeById = new Map(tree.map((node) => [node.id, node]));

  const maxDepth = tree.reduce((acc, node) => Math.max(acc, node.depth), 0);
  const step = computeIndentStep(container.clientWidth, maxDepth);
  container.style.setProperty("--echo-tree-step", step + "px");

  const pageById = applyPaging(container, state, settings, tree);
  const hiddenById = computeHidden(tree, state, pageById);

  replies.forEach((element, index) => {
    const key = keys[index];
    const node = key && keyCount.get(key) === 1 ? nodeById.get(key) : undefined;
    applyReply(
      element,
      node,
      node ? node.depth : 0,
      Boolean(node && hiddenById.get(node.id) === true),
      settings,
      state,
    );
  });

  syncPager(container, state, settings, pageById ? state.pageCount : 1);
};

/** 折叠集合按「昵称\0时间」记，跨加载更多稳定；集合自身必须有界 */
const rememberCollapsed = (state, key) => {
  if (state.collapsed.has(key)) {
    state.collapsed.delete(key);
    return;
  }
  state.collapsed.add(key);
  while (state.collapsed.size > MAX_COLLAPSED_KEYS) {
    const oldest = state.collapsed.values().next().value;
    if (oldest === undefined) break;
    state.collapsed.delete(oldest);
  }
};

const handleContainerClick = (container, state, event) => {
  const intent = resolveClick(container, event, state);
  if (!intent) return;

  event.preventDefault();
  event.stopPropagation();

  if (intent.type === "toggle") {
    rememberCollapsed(state, intent.key);
    scheduleApply(container);
    return;
  }
  if (intent.type === "pager-prev") {
    state.page -= 1;
    scheduleApply(container);
    return;
  }
  if (intent.type === "pager-next") {
    state.page += 1;
    scheduleApply(container);
    return;
  }
  if (intent.type === "pager-load-more" && intent.button) {
    intent.button.click();
  }
};

/**
 * 发现容器的入口。ctx.dom.observe 传进来的元素就是楼层的根。
 * 返回值会被宿主当作 dispose 调用，因此这里也返回 teardown。
 */
export const setupContainer = (container) => {
  if (containerStates.has(container)) {
    applyContainer(container);
    return;
  }

  const state = {
    collapsed: new Set(),
    page: 0,
    pageCount: 1,
    frame: 0,
    observer: null,
    onClick: null,
  };
  containerStates.set(container, state);

  state.onClick = (event) => handleContainerClick(container, state, event);
  container.addEventListener("click", state.onClick, true);

  // 宿主只会观察容器的父级，加载更多往容器里追加节点时不会触发，
  // 所以这里自己盯容器内部（含文本节点更新，Vue 改昵称/时间时也能重算）。
  state.observer = new MutationObserver(() => scheduleApply(container));
  state.observer.observe(container, { childList: true, subtree: true, characterData: true });

  applyContainer(container);
  return () => teardownContainer(container);
};

export const teardownContainer = (container) => {
  const state = containerStates.get(container);
  if (!state) return;
  if (state.frame) cancelAnimationFrame(state.frame);
  if (state.observer) state.observer.disconnect();
  if (state.onClick) container.removeEventListener("click", state.onClick, true);
  clearContainerMarks(container, releaseProtection);
  containerStates.delete(container);
};

/** 设置变更后立刻刷新所有在线容器，无需用户重新展开楼层 */
export const refreshAllContainers = () => {
  for (const container of containerStates.keys()) {
    if (container.isConnected) applyContainer(container);
  }
};

export const teardownAllContainers = () => {
  for (const container of Array.from(containerStates.keys())) teardownContainer(container);
  containerStates.clear();
};
