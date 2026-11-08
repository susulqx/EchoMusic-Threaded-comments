/**
 * 单条回复上的折叠按钮（「−」/「+N」）。
 *
 * 按钮插在 .comment-floor-reply-header 末尾 —— 在「收起主评论」模式下，
 * 正文与底栏都会被 CSS 隐藏，只有 header 始终可见，按钮才不会跟着消失。
 */

import { t } from "./i18n.js";
import { readHeader } from "./dom.js";

export const TOGGLE_CLASS = "echo-tree-toggle";

/**
 * 幂等同步：需要则创建或更新，不需要则移除。
 * Vue 的 keyed patch 可能丢掉注入的节点，容器上的 MutationObserver 会再调一次这里补回。
 */
export const syncToggle = (element, node, settings, collapsed) => {
  const header = readHeader(element);
  const existing = header ? header.querySelector("." + TOGGLE_CLASS) : null;

  if (!header || !node || !node.hasChildren || settings.mode === "indentOnly") {
    if (existing) existing.remove();
    return;
  }

  let button = existing;
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = TOGGLE_CLASS;
    header.appendChild(button);
  }

  button.setAttribute("data-echo-tree-key", node.id);
  button.textContent = collapsed ? "+" + node.descendantCount : "−";
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = collapsed ? t("toggle.expand") : t("toggle.collapse");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
};
