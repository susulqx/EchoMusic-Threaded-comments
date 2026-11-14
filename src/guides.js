/**
 * 引导线图层：主干 + 圆角分支 + 折叠节点。
 *
 * 为什么用 SVG 而不是 CSS 伪元素：分支要落在「子头像左边缘」与「父头像正下方」之间，
 * 而且高度取决于上一行正文的实际排版；一条回复里有多个子回复时还要各自画一段圆弧。
 * 这些坐标只有量了真实矩形才知道，所以每次重算都现量一次。
 *
 * 几何口径与宿主无关：坐标系取容器 padding box 的左上角。
 */

import {
  AVATAR_CLASS,
  FOOTER_CLASS,
  REPLY_CLASS,
  ROOT_AVATAR_CLASS,
  ROOT_ITEM_CLASS,
} from "./constants.js";
import { t } from "./i18n.js";

export const GUIDES_CLASS = "echo-tree-guides";
export const BRANCH_CLASS = "echo-tree-branch";
export const PATH_CLASS = "echo-tree-branch-line";
export const HIT_PATH_CLASS = "echo-tree-branch-hit";
export const NODE_CLASS = "echo-tree-branch-node";
export const NODE_HIT_CLASS = "echo-tree-branch-node-hit";
export const NODE_FOCUS_CLASS = "echo-tree-branch-node-focus";
export const SYMBOL_CLASS = "echo-tree-branch-symbol";
export const ROOT_LINE_CLASS = "echo-tree-root-line";

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

/** 由头像矩形得到锚点；底栏缺失或高度为 0 时贴着头像底边 */
const anchorOfBox = (box, footerBox) => {
  const footerCenterY = footerBox && footerBox.height > 0 ? footerBox.centerY : box.bottom;
  return {
    bottom: box.bottom,
    centerX: box.centerX,
    centerY: box.centerY,
    left: box.left,
    toggleY: Math.max(box.bottom, footerCenterY),
  };
};

/** 读一个回复的锚点；拿不到头像矩形时返回 null，调用方跳过该行 */
const readAnchor = (element, local) => {
  const avatar = element.querySelector("." + AVATAR_CLASS);
  if (!avatar) return null;
  const box = local(avatar.getBoundingClientRect());
  // 被折叠或分页隐藏时矩形全为 0
  if (box.width <= 0 || box.height <= 0) return null;

  const footer = element.querySelector("." + FOOTER_CLASS);
  return anchorOfBox(box, footer ? local(footer.getBoundingClientRect()) : null);
};

/**
 * 主评论自己的头像。
 * 楼层容器在 .comment-main 里，主评论头像在它的兄弟列上，所以只能从容器往上找 .comment-item。
 */
const findRootAvatar = (container) => {
  let item = container.parentNode;
  while (item && !(item.classList && item.classList.contains(ROOT_ITEM_CLASS))) {
    item = item.parentNode;
  }
  if (!item) return null;
  for (const child of item.children) {
    if (child.classList && child.classList.contains(ROOT_AVATAR_CLASS)) return child;
  }
  return null;
};

const readRootAnchor = (container, local) => {
  const avatar = findRootAvatar(container);
  if (!avatar) return null;
  const box = local(avatar.getBoundingClientRect());
  if (box.width <= 0 || box.height <= 0) return null;
  return anchorOfBox(box, null);
};

/** 根分支只画线、不放节点：收起整层仍交给宿主的「收起回复」按钮 */
const syncRootLine = (svg, path) => {
  let line = svg.querySelector("." + ROOT_LINE_CLASS);
  if (!path) {
    if (line && line.parentNode) line.parentNode.removeChild(line);
    return;
  }
  if (!line) {
    line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("class", ROOT_LINE_CLASS);
    // 排在分支组之前，节点圆环才能盖住线头
    svg.insertBefore(line, svg.children[0] || null);
  }
  line.setAttribute("d", path);
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

  /*
   * 根分支：从主评论头像往下连到每一个一级回复。
   * 没有它，同层的一级回复之间就只剩各自的子树，彼此看起来毫无关系。
   * 只画线不放节点 —— 整层的收起仍由宿主的「收起回复」按钮负责。
   *
   * 固定高度容器模式下主评论在滚动区之外，而图层随内容一起滚，
   * 线头会跟着滚出视口，所以这种情况下不画。
   */
  const rootAnchor = settings.container ? null : readRootAnchor(container, local);
  const rootChildren = rootAnchor
    ? rows
        .filter((row) => row.depth === 0 && anchorByKey.has(row.key))
        .map((row) => anchorByKey.get(row.key))
        .filter((anchor) => anchor.left > rootAnchor.centerX)
    : [];
  const rootPath = rootAnchor && rootChildren.length > 0
    ? branchPath(rootAnchor, rootChildren, false, collapseParentBody)
    : null;

  const drawn = [];
  let maxY = 0;
  // 主评论头像在容器左侧与上方的容器外区域，线头会落到负坐标，图层要跟着扩出去
  let minX = 0;
  let minY = 0;
  if (rootPath) {
    minX = Math.min(minX, rootAnchor.centerX - HIT_RADIUS);
    minY = Math.min(minY, rootAnchor.bottom);
    for (const child of rootChildren) maxY = Math.max(maxY, child.centerY + HIT_RADIUS);
  }
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

  if (drawn.length === 0 && !rootPath) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layers.delete(container);
    return;
  }

  const svg = ensureLayer(container);
  const width = Math.max(1, container.clientWidth - minX);
  const height = Math.max(1, maxY - minY);
  svg.setAttribute("viewBox", [minX, minY, width, height].map(coord).join(" "));
  svg.setAttribute("preserveAspectRatio", "none");
  // 宽度与 viewBox 一致，缩放比恒为 1，线宽才不会被拉变形
  svg.style.left = coord(minX) + "px";
  svg.style.top = coord(minY) + "px";
  svg.style.width = coord(width) + "px";
  svg.style.height = coord(height) + "px";

  syncRootLine(svg, rootPath);

  // 根线是 svg 的第一个子节点，分支组只能从它后面开始对齐
  const existing = Array.from(svg.children).filter(
    (node) => !(node.classList && node.classList.contains(ROOT_LINE_CLASS)),
  );
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

/**
 * 绘制快照：给调试出口看「线为什么这样画（或者为什么没画）」。
 *
 * 返回量出来的原始矩形（容器局部坐标）与最终落在 SVG 上的属性，
 * 两者能对上说明几何没问题；对不上就看 viewBox 与内联 left/top 是否被别处改过。
 */
export const describeGuides = (container) => {
  const local = makeLocal(container);
  const anchors = [];
  for (const element of Array.from(container.children || [])) {
    if (!(element.classList && element.classList.contains(REPLY_CLASS))) continue;
    const avatar = element.querySelector("." + AVATAR_CLASS);
    const footer = element.querySelector("." + FOOTER_CLASS);
    anchors.push({
      element,
      depth: Number(element.getAttribute("data-echo-tree-depth") || 0),
      hidden: element.hasAttribute("data-echo-tree-hidden"),
      avatar: avatar ? local(avatar.getBoundingClientRect()) : null,
      footer: footer ? local(footer.getBoundingClientRect()) : null,
      anchor: readAnchor(element, local),
    });
  }

  const layer = layers.get(container);
  const rootAvatar = findRootAvatar(container);
  const branches = [];
  let rootPath = null;
  if (layer) {
    const rootLine = layer.querySelector("." + ROOT_LINE_CLASS);
    rootPath = rootLine ? rootLine.getAttribute("d") : null;
    for (const group of Array.from(layer.children)) {
      if (!(group.classList && group.classList.contains(BRANCH_CLASS))) continue;
      const line = group.querySelector("." + PATH_CLASS);
      const node = group.querySelector("." + NODE_CLASS);
      branches.push({
        key: group.getAttribute("data-echo-tree-key"),
        expanded: group.getAttribute("aria-expanded") !== "false",
        path: line ? line.getAttribute("d") : null,
        node: node
          ? { cx: node.getAttribute("cx"), cy: node.getAttribute("cy"), r: node.getAttribute("r") }
          : null,
      });
    }
  }

  return {
    // 图层是否真的挂上了，以及它的定位/尺寸（负坐标说明画到了容器外）
    layer: layer || null,
    viewBox: layer ? layer.getAttribute("viewBox") : null,
    box: layer
      ? {
          left: layer.style.left,
          top: layer.style.top,
          width: layer.style.width,
          height: layer.style.height,
        }
      : null,
    sizing: { clientWidth: container.clientWidth, clientLeft: container.clientLeft, clientTop: container.clientTop },
    rootAvatar: rootAvatar ? local(rootAvatar.getBoundingClientRect()) : null,
    rootPath,
    branches,
    anchors,
  };
};

/** 关闭功能或容器销毁时整层移除 */
export const clearGuides = (container) => {
  const layer = layers.get(container);
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  layers.delete(container);
};
