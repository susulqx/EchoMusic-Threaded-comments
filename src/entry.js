/**
 * 评论区树状显示（threaded-comments）—— 插件入口。
 *
 * 本文件是「拼装层」：只做 activate / deactivate 的编排，具体逻辑都在 src/ 下。
 *
 *   src/constants.js     常量与宿主选择器说明
 *   src/i18n.js          全部面向用户的文案（多语言化入口）
 *   src/util.js          无副作用的小工具
 *   src/tree.js          回复树构建、分页切分、缩进步长（纯函数）
 *   src/settings.js      设置规整与读取
 *   src/meta-cache.js    /comment/* 响应 → 「昵称+时间」→ pid 关系缓存
 *   src/runtime.js       共享的响应式设置状态
 *   src/dom.js           宿主 DOM 读取与痕迹清理
 *   src/toggle.js        单条回复的折叠按钮
 *   src/pager.js         楼层内分页条
 *   src/interactions.js  点击意图解析
 *   src/container.js     楼层容器的装配与重算
 *   src/settings-page.js 设置页组件
 *   src/styles.css       全部样式
 *
 * 宿主通过 Blob URL 加载插件入口，入口里的相对 import 不会被解析，
 * 所以 index.js 由 build.mjs 把 src/ 打包成单文件 ESM。
 * 开发时只改 src/，改完执行 `node build.mjs`。
 */

import { COLLECTOR_PRIORITY, DEFAULT_SETTINGS, STORAGE_KEY } from "./constants.js";
import { setupContainer, teardownAllContainers } from "./container.js";
import { MESSAGES, setLocale, t } from "./i18n.js";
import { collectRelations, resetMetaCaches } from "./meta-cache.js";
import { createRuntime, disposeRuntime } from "./runtime.js";
import { normalizeSettings, readStoredSettings } from "./settings.js";
import { createSettingsComponent } from "./settings-page.js";
import {
  buildThreadTree,
  computeDepthCap,
  computeIndentStep,
  paginateTree,
  resolveMetaKey,
} from "./tree.js";
import STYLE from "./styles.css";

let styleDispose = null;
let settingsDispose = null;
let interceptDispose = null;
let observeDispose = null;

export async function activate(ctx) {
  const saved = await readStoredSettings(ctx);
  createRuntime(ctx.vue.reactive, saved);

  styleDispose = ctx.css.inject(STYLE, { id: "threaded-comments" });

  settingsDispose = ctx.ui.settings.define({
    title: t("settings.title"),
    description: t("settings.description"),
    component: createSettingsComponent(ctx),
  });

  // 只观察、不修改：原样返回 next() 的响应，采集失败也不影响宿主
  interceptDispose = ctx.server.intercept(
    async (request, next) => {
      const response = await next();
      try {
        if (response && response.body) collectRelations(response.body, 0);
      } catch (error) {
        console.warn(t("console.collectFailed"), error);
      }
      return response;
    },
    { match: /^\/comment\//, priority: COLLECTOR_PRIORITY, name: "threaded-comments-collector" },
  );

  observeDispose = ctx.dom.observe(".comment-floor-inline", (container) => setupContainer(container));
}

export function deactivate() {
  observeDispose?.();
  observeDispose = null;
  interceptDispose?.();
  interceptDispose = null;
  settingsDispose?.();
  settingsDispose = null;
  styleDispose?.();
  styleDispose = null;

  teardownAllContainers();
  resetMetaCaches();
  disposeRuntime();
}

/* 纯函数与常量对外暴露，单测可直接引用，行为与打包产物完全一致 */
export {
  normalizeSettings,
  buildThreadTree,
  paginateTree,
  computeDepthCap,
  computeIndentStep,
  resolveMetaKey,
  collectRelations,
  resetMetaCaches,
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  t,
  MESSAGES,
  setLocale,
};
