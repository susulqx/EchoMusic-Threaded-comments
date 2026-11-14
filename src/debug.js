/**
 * 调试出口：window.__echoTree。
 *
 * 宿主没有给插件留调试接口（DevTools 需要先在设置 → 实验性功能里打开，
 * 插件代码又跑在 Blob URL 里、行号映射不到源码），所以插件自己挂一个。
 *
 * 只做「看」和「重算」，不改设置、不发请求：
 *   __echoTree.containers()      列出当前接管的所有楼层及摘要
 *   __echoTree.rows(el?)         楼层里回复的真实 DOM 顺序、层级与标记
 *   __echoTree.tree(el?)         最近一次算出的回复树（父先子后）
 *   __echoTree.recompute(el?)    立刻重算（不传则全部楼层）
 *   __echoTree.settings()        当前生效的设置
 *   __echoTree.help()            把这份说明打到控制台
 *
 * 返回的都是副本：控制台里翻看对象不会改坏插件内部状态。
 */

import { applyContainer, describeContainers, refreshAllContainers } from "./container.js";
import { readReplies, readReplyKey } from "./dom.js";
import { describeGuides } from "./guides.js";
import { t } from "./i18n.js";
import { getSettings } from "./runtime.js";

/**
 * 排查样式时最常看的几项。列成清单而不是 dump 整份 computed style：
 * 控制台里一眼能扫完，也不会因为对象太大而被折叠。
 */
const STYLE_KEYS = [
  "display",
  "position",
  "z-index",
  "padding-inline-start",
  "border-top-width",
  "border-top-color",
  "border-top-style",
  "max-height",
  "overflow-y",
  "--echo-tree-step",
  "--echo-tree-depth",
  "--echo-tree-line",
  "--echo-tree-node-bg",
];

/** 读一个元素的关键计算样式；伪元素传 '::after' 之类 */
const computedOf = (element, pseudo) => {
  if (typeof getComputedStyle !== "function" || !element) return null;
  const style = getComputedStyle(element, pseudo || null);
  const out = {};
  for (const key of STYLE_KEYS) {
    const value = style.getPropertyValue(key);
    if (value) out[key] = value;
  }
  return out;
};

export const DEBUG_API_NAME = "__echoTree";

const DOM_HAS_WINDOW = () => typeof window !== "undefined";

/** 找到目标楼层：传元素就用它，传索引取第 n 个，不传取第一个 */
const pick = (target) => {
  const list = describeContainers();
  if (!list.length) return null;
  if (!target) return list[0];
  if (typeof target === "number") return list[target] || null;
  return list.find((entry) => entry.element === target) || null;
};

const rowsOf = (entry) => {
  const container = entry.element;
  return readReplies(container).map((element, index) => {
    const depth = Number(element.getAttribute("data-echo-tree-depth") || 0);
    return {
      index,
      key: readReplyKey(element),
      depth,
      hidden: element.hasAttribute("data-echo-tree-hidden"),
      collapsed: element.hasAttribute("data-echo-tree-collapsed"),
      fresh: element.hasAttribute("data-echo-tree-new"),
      boundary: element.hasAttribute("data-echo-tree-new-root"),
      element,
    };
  });
};

const summary = (entry) => ({
  element: entry.element,
  connected: entry.connected,
  replies: readReplies(entry.element).length,
  page: entry.page,
  pageCount: entry.pageCount,
  collapsed: entry.collapsed.length,
  fresh: entry.fresh.length,
});

export const installDebug = () => {
  if (!DOM_HAS_WINDOW()) return null;

  const api = {
    /** 当前接管的所有楼层 */
    containers: () => describeContainers().map(summary),

    /** 某个楼层的回复按真实 DOM 顺序列出，带层级与全部标记 */
    rows: (target) => {
      const entry = pick(target);
      return entry ? rowsOf(entry) : [];
    },

    /** 最近一次算出的回复树（父先子后） */
    tree: (target) => {
      const entry = pick(target);
      return entry ? entry.tree : [];
    },

    /** 立刻重算；不传目标就重算全部在线楼层 */
    recompute: (target) => {
      if (target === undefined) {
        refreshAllContainers();
        return describeContainers().length;
      }
      const entry = pick(target);
      if (!entry) return 0;
      applyContainer(entry.element);
      return 1;
    },

    settings: () => ({ ...getSettings() }),

    /**
     * 引导线的绘制快照：量出的矩形、viewBox、内联定位、每条分支的路径与节点。
     * 「线没画出来」时先看 anchors 里是不是有 null（说明那条回复量不到头像），
     * 再看 branches 是否为空（说明算出来没有可连的子回复）。
     */
    guides: (target) => {
      const entry = pick(target);
      return entry ? describeGuides(entry.element) : null;
    },

    /**
     * 样式排查：容器自己的计算样式 + 一个代表性子回复的（含 ::after 红点）。
     * 用来看注入的 CSS 到底有没有生效、缩进与分界线有没有被宿主覆盖。
     */
    css: (target) => {
      const entry = pick(target);
      if (!entry) return null;
      const container = entry.element;
      const reply = readReplies(container).find(
        (element) => element.hasAttribute("data-echo-tree-new") ||
          element.hasAttribute("data-echo-tree-new-root"),
      ) || readReplies(container)[0];

      return {
        container: computedOf(container),
        reply: reply ? computedOf(reply) : null,
        // 红点是伪元素，必须单独传伪元素参数才读得到
        replyBadge: reply ? computedOf(reply, "::after") : null,
        layer: { width: container.clientWidth, scrollTop: container.scrollTop },
      };
    },

    help: () => {
      console.log(t("debug.help"));
      return undefined;
    },
  };

  window[DEBUG_API_NAME] = api;
  return api;
};

/** 停用插件时摘掉，避免留一个指向死对象的全局 */
export const removeDebug = () => {
  if (!DOM_HAS_WINDOW()) return;
  delete window[DEBUG_API_NAME];
};
