/**
 * 点击意图解析：把 DOM 事件翻译成「该做什么」，由 container.js 执行。
 *
 * 之所以不让这里直接改状态，是为了避免 interactions 与 container 互相 import 成环；
 * 纯函数也更好测。
 */

import { findLoadMoreButton } from "./dom.js";
import { BRANCH_CLASS } from "./guides.js";
import { PAGER_BUTTON_SELECTOR, PAGER_PREV_CLASS } from "./pager.js";

/** 折叠入口是引导线里的分支组；节点、符号、命中区都在组内，点哪个都归到这条分支 */
export const TOGGLE_SELECTOR = "." + BRANCH_CLASS;

const closestIn = (target, selector, scope) => {
  if (!target || typeof target.closest !== "function") return null;
  const found = target.closest(selector);
  return found && (!scope || scope.contains(found)) ? found : null;
};

/**
 * 返回 null 表示不拦截。
 * 返回 { type: "pager-prev" | "pager-next" | "toggle", key? } 表示由插件处理。
 */
export const resolveClick = (container, event, state) => {
  const pagerButton = closestIn(event.target, PAGER_BUTTON_SELECTOR, container);
  if (pagerButton) {
    if (pagerButton.classList.contains(PAGER_PREV_CLASS)) {
      if (state.page <= 0) return null;
      return { type: "pager-prev" };
    }
    if (!pagerButton.classList.contains("echo-tree-pager-next")) return null;
    if (state.page >= state.pageCount - 1) {
      // 末页：把请求交回宿主，插件不碰请求与列表状态
      return { type: "pager-load-more", button: findLoadMoreButton(container) };
    }
    return { type: "pager-next" };
  }

  const toggle = closestIn(event.target, TOGGLE_SELECTOR, container);
  if (!toggle) return null;
  const key = toggle.getAttribute("data-echo-tree-key");
  if (!key) return null;
  return { type: "toggle", key };
};
