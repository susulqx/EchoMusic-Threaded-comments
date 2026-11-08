/**
 * 回复树与版式计算。全部是纯函数，不碰 DOM、不碰宿主状态。
 */

import {
  MAX_DEPTH,
  MIN_CONTENT_WIDTH,
  MIN_INDENT_STEP,
  NARROW_INDENT_STEP,
  NARROW_WIDTH,
  ROOTS_PER_PAGE,
  WIDE_INDENT_STEP,
} from "./constants.js";
import { toFiniteNumber } from "./util.js";

/**
 * 对齐键：「昵称 + 时间」。
 * 宿主的楼层回复节点上没有 id，只能靠人类可读字段回连接口数据。
 * 时间取 IP 归属地之前的片段（形如「2025-01-01 10:00:00 · 广东」）。
 * 任一为空时返回空串，调用方应把该条按根级处理。
 */
export function resolveMetaKey(name, time) {
  const collapse = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const author = collapse(name);
  const stamp = collapse(String(time == null ? "" : time).split("·")[0]);
  if (!author || !stamp) return "";
  return author + "\u0000" + stamp;
}

export const computeDepthCap = (depth) => {
  const value = Math.floor(toFiniteNumber(depth, 0));
  return Math.max(0, Math.min(MAX_DEPTH, value));
};

/**
 * 由 [{ id, pid, time }] 生成 [{ id, depth, parentId, hasChildren, descendantCount }]。
 * 输出按「父先子后」的深度优先顺序；同级按 time 升序、时间相同时按输入顺序。
 * pid 指向不存在的节点时视作根；成环的节点全部降级为根，避免死循环。
 */
export function buildThreadTree(items, maxDepth) {
  const cap = maxDepth === undefined ? MAX_DEPTH : computeDepthCap(maxDepth);
  const input = Array.isArray(items) ? items : [];
  const byId = new Map();
  input.forEach((item, index) => {
    const id = String(item && item.id != null ? item.id : "");
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      pid: item && item.pid != null ? String(item.pid) : "",
      time: toFiniteNumber(item && item.time, 0),
      index,
    });
  });

  const parentOf = new Map();
  for (const node of byId.values()) {
    const pid = node.pid;
    parentOf.set(node.id, pid && pid !== node.id && byId.has(pid) ? pid : null);
  }

  // 断环：沿父链上溯，遇到本次上溯已访问的节点即视为成环，环上所有节点降级为根。
  const settled = new Set();
  for (const node of byId.values()) {
    if (settled.has(node.id)) continue;
    const path = [];
    const onPath = new Set();
    let cursor = node.id;
    while (cursor && !settled.has(cursor)) {
      if (onPath.has(cursor)) break;
      onPath.add(cursor);
      path.push(cursor);
      cursor = parentOf.get(cursor) || null;
    }
    if (cursor && onPath.has(cursor)) {
      for (const id of path) parentOf.set(id, null);
    }
    for (const id of path) settled.add(id);
  }

  const children = new Map();
  const roots = [];
  for (const node of byId.values()) {
    const pid = parentOf.get(node.id);
    if (pid) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(node.id);
    } else {
      roots.push(node.id);
    }
  }

  const compare = (left, right) => {
    const diff = byId.get(left).time - byId.get(right).time;
    return diff !== 0 ? diff : byId.get(left).index - byId.get(right).index;
  };
  roots.sort(compare);
  for (const list of children.values()) list.sort(compare);

  const out = [];
  const visited = new Set();
  const walk = (id, depth) => {
    if (visited.has(id)) return;
    visited.add(id);
    const kids = children.get(id) || [];
    const level = Math.min(depth, cap);
    out.push({
      id,
      depth: level,
      parentId: depth === 0 ? null : parentOf.get(id) || null,
      hasChildren: kids.length > 0,
      descendantCount: 0,
    });
    for (const kid of kids) walk(kid, level + 1);
  };
  for (const id of roots) walk(id, 0);
  for (const node of byId.values()) if (!visited.has(node.id)) walk(node.id, 0);

  const countDescendants = (id) => {
    let total = 0;
    const stack = (children.get(id) || []).slice();
    while (stack.length > 0) {
      const current = stack.pop();
      total += 1;
      stack.push(...(children.get(current) || []));
    }
    return total;
  };
  for (const node of out) node.descendantCount = countDescendants(node.id);

  return out;
}

/**
 * 把 buildThreadTree 的输出按「根回复」切成固定大小的页。
 * 返回 [{ id, page }]，page 从 0 开始；子回复与其根同页，保证一页内不出现断链。
 */
export function paginateTree(tree, perPage) {
  const size = Math.max(1, Math.floor(toFiniteNumber(perPage, ROOTS_PER_PAGE)));
  const out = [];
  let rootIndex = -1;
  for (const node of Array.isArray(tree) ? tree : []) {
    if (!node || !node.id) continue;
    if (node.depth === 0) rootIndex += 1;
    const page = rootIndex < 0 ? 0 : Math.floor(rootIndex / size);
    out.push({ id: node.id, page });
  }
  const pageCount = rootIndex < 0 ? 1 : Math.floor(rootIndex / size) + 1;
  return { pages: out, pageCount };
}

/**
 * 缩进步长：容器越窄步长越小，同时按最大层数拟合，避免深层把正文挤没。
 * 下限 MIN_INDENT_STEP 与「头像半宽 + 4」对齐。
 */
export const computeIndentStep = (width, maxDepth) => {
  const preferred =
    !Number.isFinite(width) || width <= NARROW_WIDTH ? NARROW_INDENT_STEP : WIDE_INDENT_STEP;
  if (!Number.isFinite(width) || width <= 0) return preferred;
  const depth = Math.max(1, computeDepthCap(maxDepth || 0));
  const fitted = (width - MIN_CONTENT_WIDTH) / depth;
  if (!Number.isFinite(fitted) || fitted <= 0) return preferred;
  const step = Math.max(MIN_INDENT_STEP, Math.min(preferred, fitted));
  return Math.round(step * 100) / 100;
};
