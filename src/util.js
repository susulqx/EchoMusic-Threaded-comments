/**
 * 通用小工具。均为无副作用的纯函数。
 */

/** 转数字，NaN / Infinity / 非数字串一律回退 */
export const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 数值钳制到 [min, max] */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 依次取第一个非空字符串，全部为空时返回空串 */
export const pickString = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

/** 解析「2025-01-01 10:00:00 · 广东」这类时间串，失败返回 0 */
export const parseTimeMs = (value) => {
  const text = String(value == null ? "" : value)
    .replace(/-/g, "/")
    .split("·")[0]
    .trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 取直接子元素里第一个带指定 class 的节点（不用 :scope，桩 DOM 与旧引擎都稳） */
export const directChild = (parent, className) => {
  const children = Array.from((parent && parent.children) || []);
  return children.find((child) => child.classList && child.classList.contains(className)) || null;
};
