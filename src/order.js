/**
 * 回复排序：把宿主平铺的回复列表按树序落回真实 DOM。
 *
 * 宿主按接口返回顺序追加节点（A B C D），而语义顺序要求子回复紧跟父评论（A D B C）。
 * 只改视觉顺序（flex order / transform）不够：跨条拖选与复制走的是 DOM 顺序，
 * 视觉与 DOM 不一致时复制出来就是乱序文本。所以这里真的移动节点。
 *
 * 与宿主的协作边界：节点归宿主所有，`:key` 的 keyed list 只保证复用、不保证顺序，
 * 宿主下次 patch 会把顺序拨回它自己的口径；本插件靠容器的 MutationObserver 再拨一次，
 * 两边都不会坏。停用或关闭时按「首次见到的顺序」插回原位，用户看到的仍是原生排列。
 */

import { REPLY_CLASS } from "./constants.js";

const isReply = (element) =>
  Boolean(element && element.classList && element.classList.contains(REPLY_CLASS));

/** container -> Map(回复节点 -> 首次见到的次序) */
const originals = new WeakMap();

/**
 * 记下「第一次看到这条回复」的次序；之后的移动不影响它。
 *
 * 新出现的节点一律排在已有节点之后，而不是按它此刻在 DOM 里的位置编号。
 * 宿主加载更多时会按时间把整份列表重排，更早的新回复会被插到最前面——
 * 按位置编号的话它反而拿到最小号，排序时又跑到最前，等于跟着宿主漂。
 *
 * ponytail: 停用时按这套序号插回，若某批新回复被宿主插在前面，会落到末尾；
 * 宿主下一次 patch 会自己拨回它的顺序。要精确还原就得另外记宿主每次给的
 * 顺序（hostOrder），目前不值得为这一帧的偏差付这份复杂度。
 */
export const rememberOrder = (container, elements) => {
  let order = originals.get(container);
  if (!order) {
    order = new Map();
    originals.set(container, order);
  }
  let next = 0;
  for (const value of order.values()) if (value >= next) next = value + 1;
  for (const element of elements) {
    if (order.has(element)) continue;
    order.set(element, next);
    next += 1;
  }
};

/**
 * 容器里的「首次见到次序」表：回复节点 -> 序号。
 *
 * 排序主键用它而不是真实时间：宿主加载更多时会把整份列表按时间重排再渲染，
 * 更早的新回复会被插到旧回复中间，跟着时间排就等于跟着宿主漂。按首见序排，
 * 旧回复位置不动、新回复连续收尾，分界线的「新旧交界」才站得住。
 *
 * 返回值只读，调用方不要改。
 */
export const orderOf = (container) => originals.get(container) || null;

/**
 * 按 ordered 给出的顺序重排回复节点，其余回复保持原有相对顺序排在最后。
 * 返回最终 DOM 顺序（含未参与排序的回复），调用方据此继续算层级。
 *
 * ordered 之外的非回复节点（标题、加载更多、分页条、引导线图层）原位不动：
 * 插入锚点取「最后一个回复节点之后的那一个」。
 */
export const syncReplyOrder = (container, ordered) => {
  const children = Array.from(container.children || []);
  const current = children.filter(isReply);

  const present = new Set(current);
  const target = ordered.filter((element) => present.has(element));
  const picked = new Set(target);
  for (const element of current) if (!picked.has(element)) target.push(element);

  const settled = target.length === current.length && target.every((el, i) => el === current[i]);
  if (settled || target.length < 2) return target;

  let reference = children[children.indexOf(current[current.length - 1]) + 1] || null;
  // 倒序插入：每插一个就把它当成下一个的锚点，一次遍历即可摆平
  for (let index = target.length - 1; index >= 0; index -= 1) {
    container.insertBefore(target[index], reference);
    reference = target[index];
  }
  return target;
};

/** 按记录的原始次序把回复插回去；容器销毁或功能关闭时调用 */
export const restoreReplies = (container) => {
  const order = originals.get(container);
  if (!order) return;
  originals.delete(container);

  const elements = Array.from(order.keys()).filter((element) => element.parentNode === container);
  if (elements.length < 2) return;
  elements.sort((left, right) => order.get(left) - order.get(right));

  const children = Array.from(container.children || []);
  const current = children.filter(isReply);
  let reference = children[children.indexOf(current[current.length - 1]) + 1] || null;
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    container.insertBefore(elements[index], reference);
    reference = elements[index];
  }
};
