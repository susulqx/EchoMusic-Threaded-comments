/**
 * 设置的规整与持久化。非法值一律回落到默认，调用方不必再校验。
 */

import {
  DEFAULT_CONTAINER_HEIGHT,
  DEFAULT_SETTINGS,
  MAX_CONTAINER_HEIGHT,
  MIN_CONTAINER_HEIGHT,
  MODES,
  STORAGE_KEY,
} from "./constants.js";
import { clamp, toFiniteNumber } from "./util.js";

const clampHeight = (value) =>
  clamp(Math.round(value), MIN_CONTAINER_HEIGHT, MAX_CONTAINER_HEIGHT);

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const mode = MODES.includes(source.mode) ? source.mode : DEFAULT_SETTINGS.mode;
  const height = toFiniteNumber(source.containerHeight, DEFAULT_CONTAINER_HEIGHT);
  return {
    enabled: source.enabled === undefined ? DEFAULT_SETTINGS.enabled : Boolean(source.enabled),
    mode,
    container: Boolean(source.container),
    containerHeight: clampHeight(height),
    paginate: Boolean(source.paginate),
    hideQuote: source.hideQuote === undefined ? DEFAULT_SETTINGS.hideQuote : Boolean(source.hideQuote),
    markNew: source.markNew === undefined ? DEFAULT_SETTINGS.markNew : Boolean(source.markNew),
    markDivider:
      source.markDivider === undefined ? DEFAULT_SETTINGS.markDivider : Boolean(source.markDivider),
  };
}

/** 读一次设置；读失败按默认值处理，不阻塞插件启动 */
export const readStoredSettings = async (ctx) => {
  const saved = await ctx.storage.get(STORAGE_KEY).catch(() => null);
  return normalizeSettings(saved);
};
