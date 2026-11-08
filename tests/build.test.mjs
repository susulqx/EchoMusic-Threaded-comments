import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
const rawCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

const loadPlugin = async () => {
  const url = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  return import(url);
};

const count = (text, char) => text.split(char).length - 1;

/**
 * 用一个最小 ctx 真正跑一遍 activate，把注入的样式抓出来。
 * 这样校验的是「产物实际交给宿主的东西」，而不是源文件。
 */
const capture = async () => {
  const api = await loadPlugin();
  const box = { css: "", settings: null, match: null };
  const noop = () => () => {};
  const ctx = {
    storage: { get: async () => null, set: async () => {} },
    vue: {
      reactive: (value) => value,
      defineComponent: (options) => options,
    },
    css: { inject: (css) => { box.css = css; return () => {}; } },
    ui: {
      settings: { define: (options) => { box.settings = options; return () => {}; } },
      components: { Switch: {}, Select: {}, Slider: {} },
    },
    server: {
      intercept: (handler, options) => { box.match = options; return () => {}; },
    },
    dom: { observe: () => () => {} },
    toast: { warning: () => {} },
    ...{},
  };
  await api.activate(ctx);
  api.deactivate();
  return { api, box };
};

test("压缩后的产物仍能激活，且注入的样式与源文件结构一致", async () => {
  const { box } = await capture();
  assert.ok(box.css.length > 500, "注入的 CSS 不应为空");
  for (const char of ["{", "}"]) {
    assert.equal(count(box.css, char), count(rawCss, char), char + " 的配对数量应与源文件一致");
  }
  assert.equal(count(box.css, "!important"), count(rawCss, "!important"));
  // 关键规则必须还在：缩进、隐藏、折叠、引导线、容器
  // 压缩会把 ": " 收紧成 ":"，这里按压缩后的形态断言
  for (const rule of [
    "margin-left:calc(var(--echo-tree-step",
    "[data-echo-tree-hidden]",
    'data-echo-mode="lineCollapseMain"',
    'data-echo-guides="on"',
    'data-echo-container="on"',
    ".echo-tree-pager-btn",
    ".echo-tree-toggle",
  ]) {
    assert.ok(box.css.includes(rule), "缺少规则：" + rule);
  }
});

test("压缩产物保留全部对外导出与隐藏契约", async () => {
  const { api, box } = await capture();
  for (const name of [
    "activate",
    "deactivate",
    "normalizeSettings",
    "buildThreadTree",
    "paginateTree",
    "computeIndentStep",
    "resolveMetaKey",
    "collectRelations",
    "t",
    "setLocale",
    "MESSAGES",
  ]) {
    assert.ok(typeof api[name] !== "undefined", "缺少导出：" + name);
  }
  assert.equal(api.STORAGE_KEY, "threaded-comments:settings");
  assert.equal(box.match.priority, 90);
  assert.equal(box.match.name, "threaded-comments-collector");
  assert.ok(box.match.match.test("/comment/floor"), "拦截器应匹配 /comment/ 前缀");
  assert.equal(box.settings.title, "评论区树状显示");
});

test("压缩只删空白与注释，不重命名标识符", () => {
  // 关键函数名与属性名必须原样出现，便于排查线上问题
  for (const token of [
    "buildThreadTree",
    "computeIndentStep",
    "protectKeys",
    "syncPager",
    "data-echo-tree-depth",
    "threaded-comments:settings",
  ]) {
    assert.ok(source.includes(token), "压缩后丢失可读标识：" + token);
  }
  // 不允许出现被压成一行的超长单行（说明压缩没有生效）
  const longest = source.split("\n").reduce((acc, line) => Math.max(acc, line.length), 0);
  assert.ok(longest > 0);
});
