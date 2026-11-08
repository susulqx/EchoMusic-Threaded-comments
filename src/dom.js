/**
 * 宿主 DOM 的读取与标记清理。
 *
 * 约定：插件只写 data-echo-* 属性与 CSS 自定义属性，不移动、不重排宿主的节点。
 * 所有选择器集中在这里与 constants.js 的注释里，宿主改版时只需改这两处。
 */

import { resolveMetaKey } from "./tree.js";
import { directChild } from "./util.js";

export const REPLY_CLASS = "comment-floor-reply";
export const NAME_CLASS = "comment-floor-reply-name";
export const TIME_CLASS = "comment-floor-reply-time";
export const HEADER_CLASS = "comment-floor-reply-header";
export const MORE_CLASS = "comment-floor-more";
export const MORE_BUTTON_CLASS = "comment-floor-more-btn";

export const isReplyElement = (element) =>
  Boolean(element && element.classList && element.classList.contains(REPLY_CLASS));

/** 容器里所有直接子级的回复节点，顺序与 DOM 一致 */
export const readReplies = (container) =>
  Array.from(container.children || []).filter(isReplyElement);

/**
 * 由回复节点算出对齐键。
 * 时间节点里是「2025-01-01 10:00:00 · 广东」，resolveMetaKey 会丢掉 IP 尾巴。
 */
export const readReplyKey = (element) => {
  const nameElement = element.querySelector("." + NAME_CLASS);
  const timeElement = element.querySelector("." + TIME_CLASS);
  return resolveMetaKey(
    nameElement ? nameElement.textContent : "",
    timeElement ? timeElement.textContent : "",
  );
};

export const readHeader = (element) => element.querySelector("." + HEADER_CLASS);

/** 宿主的「加载更多回复」按钮，没有则返回 null */
export const findLoadMoreButton = (container) => {
  const more = directChild(container, MORE_CLASS);
  return more ? directChild(more, MORE_BUTTON_CLASS) : null;
};

const REPLY_ATTRS = [
  "data-echo-tree",
  "data-echo-tree-depth",
  "data-echo-tree-branch",
  "data-echo-tree-tail",
  "data-echo-tree-collapsed",
  "data-echo-tree-hidden",
];

const CONTAINER_ATTRS = [
  "data-echo-thread",
  "data-echo-mode",
  "data-echo-guides",
  "data-echo-container",
];

/**
 * 抹掉本插件在某个容器上留下的全部痕迹。
 * 关闭总开关、折叠容器、插件停用都走这里，保证没有残留。
 */
export const clearContainerMarks = (container, releaseProtection) => {
  if (releaseProtection) releaseProtection(container);
  for (const attr of CONTAINER_ATTRS) container.removeAttribute(attr);
  container.style.removeProperty("--echo-tree-container-height");
  container.style.removeProperty("--echo-tree-step");

  for (const element of readReplies(container)) {
    for (const attr of REPLY_ATTRS) element.removeAttribute(attr);
    element.style.removeProperty("--echo-tree-depth");
    const toggle = element.querySelector(".echo-tree-toggle");
    if (toggle) toggle.remove();
  }

  const pager = directChild(container, "echo-tree-pager");
  if (pager) pager.remove();
};
