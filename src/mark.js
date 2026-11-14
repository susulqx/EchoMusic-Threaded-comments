/**
 * 新加载回复的红点定位。
 *
 * 红点要落在「名字那一行的有效内容最右侧」后面 —— 名字行里还有 VIP 徽章、
 * 「回复某某」这类宽度随数据变化的节点，纯 CSS 只能贴到整条回复的右边缘，
 * 离内容常常隔着大半个屏。所以这里实际量一次，把坐标写进 CSS 变量。
 *
 * 只给坐标，不给尺寸：点的宽高与垂直居中在 styles.css 里。
 * 与内容的间隙例外 —— 它取宿主头行自己的 gap，这样红点与徽章之间的
 * 距离就和「名字与徽章」「徽章与徽章」之间的一模一样。
 */

import { HEADER_CLASS } from "./constants.js";
import { readReplies } from "./dom.js";

const round = (value) => Math.round(value * 100) / 100;

/** 头行量不到 gap 时的回落值，与宿主 CommentList.vue 的 .comment-floor-reply-header 一致 */
const FALLBACK_GAP = 8;

/**
 * 头行的列间距。宿主的头像行是 flex + gap，红点要接在同一个节奏上。
 * column-gap 的计算值是 "8px" 这类字符串，取不到数字就回落。
 */
const headerGap = (header) => {
  if (typeof getComputedStyle !== "function") return FALLBACK_GAP;
  const value = getComputedStyle(header, null).getPropertyValue("column-gap");
  const gap = Number.parseFloat(value);
  return Number.isFinite(gap) && gap >= 0 ? gap : FALLBACK_GAP;
};

/**
 * 量出头行里「同一行」内容的右边界与该行中线。
 *
 * 头行是 flex-wrap: wrap，窄屏时徽章会换到第二行。第二行的内容不该把红点
 * 推到下一行去，所以只认与第一个可见子节点同一行的那些（纵向偏差不超过
 * 自身高度的一半）。
 */
const headerRow = (header) => {
  let right = 0;
  let top = 0;
  let height = 0;
  let found = false;

  for (const child of Array.from(header.children || [])) {
    const box = child.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    if (!found) {
      found = true;
      top = box.top;
      height = box.height;
    } else if (Math.abs(box.top - top) > height / 2) {
      continue;
    }
    right = Math.max(right, box.right);
  }

  return found ? { right, centerY: top + height / 2 } : null;
};

/**
 * 给这一批新回复写入红点坐标。
 * 不再标记的回复顺手清掉旧变量 —— 宿主复用节点时旧坐标会残留，红点会画歪。
 */
export const placeNewDots = (container) => {
  for (const element of readReplies(container)) {
    if (!element.hasAttribute("data-echo-tree-new")) {
      if (element.style.getPropertyValue("--echo-tree-dot-x")) {
        element.style.removeProperty("--echo-tree-dot-x");
        element.style.removeProperty("--echo-tree-dot-y");
      }
      continue;
    }

    const header = element.querySelector("." + HEADER_CLASS);
    if (!header) continue;
    const row = headerRow(header);
    if (!row) continue;

    const box = element.getBoundingClientRect();
    if (box.width <= 0) continue;

    // ::after 的包含块是回复的 padding box，要补掉左侧边框
    const left = box.left + element.clientLeft;
    const top = box.top + element.clientTop;

    element.style.setProperty("--echo-tree-dot-x", round(row.right - left + headerGap(header)) + "px");
    element.style.setProperty("--echo-tree-dot-y", round(row.centerY - top) + "px");
  }
};
