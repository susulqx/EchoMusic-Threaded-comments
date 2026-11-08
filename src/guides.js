/**
 * 引导线图层：主干 + 圆角分支 + 折叠节点。
 *
 * 为什么用 SVG 而不是 CSS 伪元素：分支要落在「子头像左边缘」与「父头像正下方」之间，
 * 而且高度取决于上一行正文的实际排版；一条回复里有多个子回复时还要各自画一段圆弧。
 * 这些坐标只有量了真实矩形才知道，所以每次重算都现量一次。
 *
 * 几何口径与宿主无关：坐标系取容器 padding box 的左上角。
 */

import { AVATAR_CLASS, FOOTER_CLASS } from "./constants.js";
import { t } from "./i18n.js";

export const GUIDES_CLASS = "echo-tree-guides";
export const BRANCH_CLASS = "echo-tree-branch";
export const PATH_CLASS = "echo-tree-branch-line";
export const HIT_PATH_CLASS = "echo-tree-branch-hit";
export const NODE_CLASS = "echo-tree-branch-node";
export const NODE_HIT_CLASS = "echo-tree-branch-node-hit";
export const NODE_FOCUS_CLASS = "echo-tree-branch-node-focus";
export const SYMBOL_CLASS = "echo-tree-branch-symbol";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 分支圆弧半径，与宿主的圆角卡片一致 */
const BRANCH_RADIUS = 12;
/** 节点命中半径，同时也是主干与节点、节点与子回复之间的最小间距 */
const HIT_RADIUS = 12;
/** 节点圆点半径 */
const NODE_RADIUS = 6;
/** 节点里 +/− 符号的半长 */
const SYMBOL_HALF = 3;

/** 坐标保留两位小数，避免长浮点数字符串反复触发重排 */
const coord = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
};

/**
 * 展开状态下的节点纵坐标：优先落在父回复底栏中心，但不越过最后一个子回复的命中圈。
 * 子回复只有一条时上下都受限，取中点。
 */
export const expandedToggleY = (parent, children) => {
  if (children.length === 0) return Math.max(parent.bottom + HIT_RADIUS, parent.toggleY);
  const branchEndY = children[children.length - 1].centerY;
  const minimumY = parent.bottom + HIT_RADIUS;
  const maximumY = branchEndY - HIT_RADIUS;
  if (maximumY <= minimumY) return parent.bottom + (branchEndY - parent.bottom) / 2;
  return Math.min(Math.max(parent.toggleY, minimumY), maximumY);
};

/**
 * 折叠后的节点纵坐标。
 * 收起主评论时父回复被压成一行，节点贴在头像中心；否则贴着父回复底部，不再看子回复。
 */
export const collapsedToggleY = (parent, collapseParentBody) => {
  if (collapseParentBody) return parent.centerY;
  return Math.max(parent.bottom + HIT_RADIUS, parent.toggleY);
};

/**
 * 分支路径。返回 null 表示这条分支不需要画线。
 * 展开时主干止于最后一段圆弧的起点，避免竖线在拐角处多出一截。
 */
export const branchPath = (parent, children, collapsed, collapseParentBody) => {
  const x = parent.centerX;

  if (collapsed) {
    // 收起主评论时父回复被压成一行，线没有长度，只留一个退化起点给节点定位用
    if (collapseParentBody) return "M " + coord(x) + " " + coord(parent.centerY);
    const from = parent.bottom;
    const to = Math.max(collapsedToggleY(parent, false) + HIT_RADIUS, from + HIT_RADIUS * 2);
    return "M " + coord(x) + " " + coord(from) + " V " + coord(to);
  }

  if (children.length === 0) return null;

  const radii = children.map((child) => {
    const horizontalGap = child.left - x;
    if (horizontalGap <= 0) return 0;
    const verticalRoom = Math.max(0, child.centerY - parent.bottom);
    if (verticalRoom <= 0) return 0;
    return Math.min(BRANCH_RADIUS, horizontalGap, verticalRoom);
  });

  const last = children.length - 1;
  const trunkEndY = children[last].centerY - radii[last];
  const parts = [];
  if (trunkEndY > parent.bottom + 0.5) {
    parts.push("M " + coord(x) + " " + coord(parent.bottom), "V " + coord(trunkEndY));
  }

  children.forEach((child, index) => {
    if (child.left - x <= 0) return;
    const radius = radii[index];
    if (radius <= 0) {
      parts.push(
        "M " + coord(x) + " " + coord(child.centerY),
        "H " + coord(child.left),
      );
      return;
    }
    // 1/4 圆弧：从竖线上的 (x, cy-r) 转到水平线上的 (x+r, cy)
    parts.push(
      "M " + coord(x) + " " + coord(child.centerY - radius),
      "A " + coord(radius) + " " + coord(radius) + " 0 0 0 " + coord(x + radius) + " " + coord(child.centerY),
      "H " + coord(child.left),
    );
  });

  return parts.length > 0 ? parts.join(" ") : null;
};

/** +/− 符号：始终一条横线，折叠时补一条竖线 */
export const symbolPath = (x, y, collapsed) => {
  const horizontal = "M " + coord(x - SYMBOL_HALF) + " " + coord(y) + " H " + coord(x + SYMBOL_HALF);
  if (!collapsed) return horizontal;
  return horizontal + " M " + coord(x) + " " + coord(y - SYMBOL_HALF) + " V " + coord(y + SYMBOL_HALF);
};

/** container -> svg 图层，整个容器只保留一个 */
const layers = new Map();
/** g 元素 -> 内部引用，避免每次重算都重新查子节点 */
const refs = new WeakMap();

const ensureLayer = (container) => {
  let layer = layers.get(container);
  if (layer && layer.parentNode === container) return layer;

  layer = document.createElementNS(SVG_NS, "svg");
  layer.setAttribute("class", GUIDES_CLASS);
  layer.setAttribute("focusable", "false");
  layer.setAttribute("aria-hidden", "true");
  container.appendChild(layer);
  layers.set(container, layer);
  return layer;
};

/** 建一个分支节点组（含线条、命中区、节点圆环与符号），结构固定，后续只改属性 */
const createBranch = () => {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", BRANCH_CLASS);
  group.setAttribute("role", "button");
  group.setAttribute("tabindex", "0");

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", PATH_CLASS);
  group.appendChild(line);

  const hit = document.createElementNS(SVG_NS, "path");
  hit.setAttribute("class", HIT_PATH_CLASS);
  group.appendChild(hit);

  const nodeHit = document.createElementNS(SVG_NS, "circle");
  nodeHit.setAttribute("class", NODE_HIT_CLASS);
  group.appendChild(nodeHit);

  const focus = document.createElementNS(SVG_NS, "circle");
  focus.setAttribute("class", NODE_FOCUS_CLASS);
  group.appendChild(focus);

  const node = document.createElementNS(SVG_NS, "circle");
  node.setAttribute("class", NODE_CLASS);
  group.appendChild(node);

  const symbol = document.createElementNS(SVG_NS, "path");
  symbol.setAttribute("class", SYMBOL_CLASS);
  group.appendChild(symbol);

  return { group, line, hit, focus, node, nodeHit, symbol };
};

/**
 * 量出容器的局部坐标换算函数。
 *
 * 图层是容器的绝对定位子元素，包含块是 padding box；容器滚动时图层跟着内容一起滚，
 * 所以原点只需算到「padding box 左上角」，不能再补 scrollTop —— 补了反而在滚动时错位。
 */
const makeLocal = (container) => {
  const base = container.getBoundingClientRect();
  const originX = base.left + container.clientLeft;
  const originY = base.top + container.clientTop;
  return (rect) => ({
    left: rect.left - originX,
    top: rect.top - originY,
    width: rect.width,
    height: rect.height,
    bottom: rect.top + rect.height - originY,
    centerX: rect.left + rect.width / 2 - originX,
    centerY: rect.top + rect.height / 2 - originY,
  });
};

/** 读一个回复的锚点；拿不到头像矩形时返回 null，调用方跳过该行 */
const readAnchor = (element, local) => {
  const avatar = element.querySelector("." + AVATAR_CLASS);
  if (!avatar) return null;
  const box = local(avatar.getBoundingClientRect());
  // 被折叠或分页隐藏时矩形全为 0
  if (box.width <= 0 || box.height <= 0) return null;

  const footer = element.querySelector("." + FOOTER_CLASS);
  const footerBox = footer ? local(footer.getBoundingClientRect()) : null;
  const footerCenterY = footerBox && footerBox.height > 0 ? footerBox.centerY : box.bottom;

  return {
    bottom: box.bottom,
    centerX: box.centerX,
    centerY: box.centerY,
    left: box.left,
    toggleY: Math.max(box.bottom, footerCenterY),
  };
};

/**
 * 重算一个楼层的引导线。
 * rows: [{ element, key, depth, parentKey, hasChildren, collapsed }]
 */
export const syncGuides = (container, rows, settings) => {
  const draw = settings.enabled && settings.mode !== "indentOnly";
  const layer = layers.get(container);

  if (!draw) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layers.delete(container);
    return;
  }

  const local = makeLocal(container);
  const anchorByKey = new Map();
  for (const row of rows) {
    const anchor = readAnchor(row.element, local);
    if (anchor) anchorByKey.set(row.key, anchor);
  }

  const collapseParentBody = settings.mode === "lineCollapseMain";
  const childrenOf = new Map();
  for (const row of rows) {
    if (!row.parentKey) continue;
    if (!childrenOf.has(row.parentKey)) childrenOf.set(row.parentKey, []);
    childrenOf.get(row.parentKey).push(row);
  }

  const drawn = [];
  let maxY = 0;
  for (const row of rows) {
    if (!row.hasChildren) continue;
    const parent = anchorByKey.get(row.key);
    if (!parent) continue;

    const kids = (childrenOf.get(row.key) || [])
      .map((child) => anchorByKey.get(child.key))
      .filter((anchor) => Boolean(anchor) && anchor.left > parent.centerX);
    // 收起主评论时子回复全被隐藏，锚点为空，仍要保留节点用于展开
    const children = row.collapsed ? [] : kids;

    const path = branchPath(parent, children, row.collapsed, collapseParentBody);
    // 没有路径就没有节点：连不对齐到子头像的分支都不该出现按钮
    if (!path) continue;
    const toggleY = row.collapsed
      ? collapsedToggleY(parent, collapseParentBody)
      : expandedToggleY(parent, children);

    drawn.push({ key: row.key, parent, path, toggleY, collapsed: row.collapsed });
    maxY = Math.max(maxY, toggleY + HIT_RADIUS, parent.bottom);
    for (const child of children) maxY = Math.max(maxY, child.centerY + HIT_RADIUS);
  }

  if (drawn.length === 0) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layers.delete(container);
    return;
  }

  const svg = ensureLayer(container);
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, maxY);
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.width = "100%";
  svg.style.height = height + "px";

  const existing = Array.from(svg.children);
  for (let index = 0; index < drawn.length; index += 1) {
    const entry = drawn[index];
    let group = existing[index];
    if (!group) {
      const parts = createBranch();
      group = parts.group;
      refs.set(group, parts);
      svg.appendChild(group);
    }
    const { line, hit, focus, node, nodeHit, symbol } = refs.get(group);

    group.setAttribute("data-echo-tree-key", entry.key);
    group.setAttribute("aria-expanded", entry.collapsed ? "false" : "true");
    group.setAttribute(
      "aria-label",
      entry.collapsed ? t("toggle.expand") : t("toggle.collapse"),
    );

    if (entry.path) {
      line.setAttribute("d", entry.path);
      hit.setAttribute("d", entry.path);
      line.style.display = "";
      hit.style.display = "";
    } else {
      line.removeAttribute("d");
      hit.removeAttribute("d");
      line.style.display = "none";
      hit.style.display = "none";
    }

    for (const circle of [node, nodeHit, focus]) {
      circle.setAttribute("cx", coord(entry.parent.centerX));
      circle.setAttribute("cy", coord(entry.toggleY));
    }
    node.setAttribute("r", String(NODE_RADIUS));
    nodeHit.setAttribute("r", String(HIT_RADIUS));
    focus.setAttribute("r", String(HIT_RADIUS - 2));
    symbol.setAttribute("d", symbolPath(entry.parent.centerX, entry.toggleY, entry.collapsed));
  }

  for (let index = drawn.length; index < existing.length; index += 1) {
    const extra = existing[index];
    if (extra.parentNode) extra.parentNode.removeChild(extra);
  }
};

/** 关闭功能或容器销毁时整层移除 */
export const clearGuides = (container) => {
  const layer = layers.get(container);
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  layers.delete(container);
};
