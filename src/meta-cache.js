/**
 * 回复关系的旁路缓存。
 *
 * 宿主的楼层回复 DOM 上没有 id / pid，父子关系只能来自 /comment/* 的响应体。
 * 插件以观察者身份读 res.body（priority 90，不改请求也不改响应），把
 * 「昵称 + 时间」当作对齐键，缓存 键 -> { id, pid, timeMs }。
 *
 * 缓存必须有界，但也不能把用户正在看的楼层淘汰掉 —— 那些楼层往往最早加载，
 * 而后续楼层的 pid 仍指向它们。因此在线楼层用到的键（含其父键）做引用计数保护，
 * 淘汰时跳过；全被保护时退化为插入序淘汰，保证有界。
 */

import { MAX_META_ENTRIES, MAX_RELATION_SCAN_DEPTH } from "./constants.js";
import { resolveMetaKey } from "./tree.js";
import { parseTimeMs, pickString } from "./util.js";

const metaByKey = new Map();
const keyOfId = new Map();
const protectCounts = new Map();
const protectedByContainer = new Map();

export const lookupMeta = (key) => metaByKey.get(key) || null;

export const lookupKeyById = (id) => keyOfId.get(id) || "";

const dropMeta = (key) => {
  const entry = metaByKey.get(key);
  if (!entry) return;
  metaByKey.delete(key);
  if (entry.id && keyOfId.get(entry.id) === key) keyOfId.delete(entry.id);
};

const evictOne = () => {
  for (const key of metaByKey.keys()) {
    if (protectCounts.has(key)) continue;
    dropMeta(key);
    return true;
  }
  const oldest = metaByKey.keys().next().value;
  if (oldest === undefined) return false;
  dropMeta(oldest);
  return true;
};

const rememberRelation = (key, entry) => {
  if (!key || !entry || !entry.id) return;
  if (metaByKey.has(key)) metaByKey.delete(key);
  metaByKey.set(key, entry);
  keyOfId.set(entry.id, key);
  // guard：全被保护时 evictOne 退化为插入序淘汰，可能一次删不完，避免死循环。
  let guard = metaByKey.size;
  while (metaByKey.size > MAX_META_ENTRIES && guard-- > 0) {
    if (!evictOne()) break;
  }
};

/**
 * 把某个楼层正在展示的键（以及它们的父键）标记为受保护。
 * 同一容器重复调用会先释放上一次的保护，避免计数泄漏。
 */
export const protectKeys = (container, keys) => {
  releaseProtection(container);
  const set = new Set();
  for (const key of keys) {
    if (!key) continue;
    set.add(key);
    const entry = metaByKey.get(key);
    const parentKey = entry && entry.pid ? keyOfId.get(entry.pid) || "" : "";
    if (parentKey) set.add(parentKey);
  }
  if (set.size === 0) return;
  protectedByContainer.set(container, set);
  for (const key of set) protectCounts.set(key, (protectCounts.get(key) || 0) + 1);
};

export const releaseProtection = (container) => {
  const previous = protectedByContainer.get(container);
  if (!previous) return;
  protectedByContainer.delete(container);
  for (const key of previous) {
    const next = (protectCounts.get(key) || 0) - 1;
    if (next > 0) protectCounts.set(key, next);
    else protectCounts.delete(key);
  }
};

/**
 * 递归扫响应体，收下所有能识别的评论节点。
 * 层级上限防止异常结构把栈打爆；字段名兼容酷狗接口常见的几种写法。
 */
export const collectRelations = (node, depth) => {
  if (!node || typeof node !== "object" || (depth || 0) > MAX_RELATION_SCAN_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRelations(item, depth || 0);
    return;
  }
  const id = pickString(node.comment_id, node.id);
  const author = pickString(node.user_name, node.nickname, node.userName);
  const stamp = pickString(node.addtime, node.add_time, node.time);
  if (id && author && stamp) {
    const key = resolveMetaKey(author, stamp);
    if (key) {
      rememberRelation(key, {
        id,
        pid: pickString(node.pid, node.parent_id, ""),
        timeMs: parseTimeMs(stamp),
      });
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectRelations(value, (depth || 0) + 1);
  }
};

/** 插件停用时一次性清空，避免残留引用 */
export const resetMetaCaches = () => {
  metaByKey.clear();
  keyOfId.clear();
  protectCounts.clear();
  protectedByContainer.clear();
};
