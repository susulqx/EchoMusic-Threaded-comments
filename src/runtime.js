/**
 * 插件运行期的共享状态。
 *
 * 单独成模块，是为了让「容器处理」与「设置页」都能读写同一份设置，
 * 而不至于互相 import 形成环。
 */

import { DEFAULT_SETTINGS } from "./constants.js";

/** { settings } —— 由入口在 activate 时用 ctx.vue.reactive 包一层 */
let runtimeState = null;

export const createRuntime = (reactive, settings) => {
  runtimeState = reactive({ settings });
  return runtimeState;
};

export const disposeRuntime = () => {
  runtimeState = null;
};

/** 读当前设置；插件未激活时给默认值，避免调用方到处判空 */
export const getSettings = () => (runtimeState ? runtimeState.settings : DEFAULT_SETTINGS);
