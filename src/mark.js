/**
 * 新加载回复的红点定位。
 *
 * 红点要落在「名字那一行的有效内容最右侧」后面 —— 名字行里还有 VIP 徽章、
 * 「回复某某」这类宽度随数据变化的节点，纯 CSS 只能贴到整条回复的右边缘，
 * 离内容常常隔着大半个屏。所以这里实际量一次，把坐标写进 CSS 变量。
 *
 * 只写变量不改节点：红点本身是回复上的 ::after，定位与绘制都在样式里。
 */

import { HEADER_CLASS, NEW_DOT_GAP, NEW_DOT_SIZE } from "./constants.js";
import { readReplies } from "./dom.js";

const round = (value) => Math.round(value * 100) / 100;

/**
 * 量出头行里「同一行」内容的右边界。
 *
 * 头行是 flex-wrap: wrap，窄屏时徽章会换到第二行。第二行的内容不该把红点
 * 推到下一行的右边，所以只认与第一个可见子节点同一行的那些（纵向偏差不超过
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

  return found ? { right, top, height } : null;
};

/**
 * 给这一批新回复写入红点坐标；不再标记的回复顺手清掉旧变量，
 * 因为宿主复用节点时旧坐标会残留，红点会出现在错误的位置。
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

    element.style.setProperty("--echo-tree-dot-x", round(row.right - left + NEW_DOT_GAP) + "px");
    element.style.setProperty("--echo-tree-dot-y", round(row.top - top + (row.height - NEW_DOT_SIZE) / 2) + "px");
  }
};
