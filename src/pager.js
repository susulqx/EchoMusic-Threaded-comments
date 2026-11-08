/**
 * 楼层内分页条：上一页 / 第 N / M 页 / 下一页。
 *
 * 设计边界：插件只切「已加载到本地的回复」的可见性，不接管宿主的请求。
 * 到了末页而宿主还有更多回复时，把「下一页」变成「加载更多」，点击后转发给
 * 宿主的按钮（forwardLoadMore），让宿主自己发请求、自己合并列表。
 */

import { findLoadMoreButton } from "./dom.js";
import { t } from "./i18n.js";
import { directChild } from "./util.js";

const PAGER_CLASS = "echo-tree-pager";
const BUTTON_CLASS = "echo-tree-pager-btn";
const PREV_CLASS = "echo-tree-pager-prev";
const NEXT_CLASS = "echo-tree-pager-next";
const INFO_CLASS = "echo-tree-pager-info";

/** 复用或新建分页条内的按钮，文案变了才写 DOM */
const ensureButton = (pager, className, text) => {
  let button = directChild(pager, className);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS + " " + className;
    pager.appendChild(button);
  }
  if (button.textContent !== text) button.textContent = text;
  return button;
};

/** 复用或新建中间的「第 N / M 页」文本 */
const ensureInfo = (pager) => {
  let info = directChild(pager, INFO_CLASS);
  if (!info) {
    info = document.createElement("span");
    info.className = INFO_CLASS;
    pager.appendChild(info);
  }
  return info;
};

/**
 * 同步分页条。pageCount <= 1 或未开启分页时整条移除。
 * 顺带把 state.pageCount 与按钮禁用态刷新到最新。
 */
export const syncPager = (container, state, settings, pageCount) => {
  let pager = directChild(container, PAGER_CLASS);

  if (!settings.paginate || pageCount <= 1) {
    if (pager) pager.remove();
    if (!settings.paginate) state.page = 0;
    return;
  }

  if (!pager) {
    pager = document.createElement("div");
    pager.className = PAGER_CLASS;
    const more = directChild(container, "comment-floor-more");
    if (more) container.insertBefore(pager, more);
    else container.appendChild(pager);
  }

  const isFirst = state.page <= 0;
  const isLast = state.page >= pageCount - 1;
  const hasMoreFromHost = Boolean(findLoadMoreButton(container));

  const info = ensureInfo(pager);
  const label = t("pager.info", { page: state.page + 1, total: pageCount });
  if (info.textContent !== label) info.textContent = label;

  const prev = ensureButton(pager, PREV_CLASS, t("pager.prev"));
  const next = ensureButton(
    pager,
    NEXT_CLASS,
    isLast && hasMoreFromHost ? t("pager.loadMore") : t("pager.next"),
  );

  if (isFirst) prev.setAttribute("disabled", "disabled");
  else prev.removeAttribute("disabled");
  if (isLast && !hasMoreFromHost) next.setAttribute("disabled", "disabled");
  else next.removeAttribute("disabled");

  // 顺序固定：上一页 / 信息 / 下一页
  if (pager.children[0] !== prev) pager.insertBefore(prev, pager.children[0] || null);
  if (pager.children[1] !== info) pager.insertBefore(info, pager.children[1] || null);
  if (pager.children[2] !== next) pager.insertBefore(next, pager.children[2] || null);

  return pager;
};

export const PAGER_BUTTON_SELECTOR = "." + BUTTON_CLASS;
export const PAGER_ROOT_SELECTOR = "." + PAGER_CLASS;
export const PAGER_PREV_CLASS = PREV_CLASS;
export const PAGER_NEXT_CLASS = NEXT_CLASS;
