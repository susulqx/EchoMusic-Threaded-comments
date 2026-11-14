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

/**
 * esbuild 压缩 CSS 时会把属性值里的引号去掉（[data-x="on"] -> [data-x=on]），
 * 所以断言前先做同样的归一化，否则测的是压缩风格而不是规则是否还在。
 */
const normalizeCss = (css) => css.replace(/(\[[-\w]+)=["']([^"']*)["']\]/g, "$1=$2]");

test("压缩后的产物仍能激活，且注入的样式与源文件结构一致", async () => {
  const { box } = await capture();
  assert.ok(box.css.length > 500, "注入的 CSS 不应为空");
  for (const char of ["{", "}"]) {
    assert.equal(count(box.css, char), count(rawCss, char), char + " 的配对数量应与源文件一致");
  }
  assert.equal(count(box.css, "!important"), count(rawCss, "!important"));
  // 关键规则必须还在：缩进、隐藏、折叠、引导线、容器
  const css = normalizeCss(box.css);
  for (const rule of [
    "padding-inline-start:calc(var(--echo-tree-step",
    "[data-echo-tree-hidden]",
    "data-echo-mode=lineCollapseMain",
    "data-echo-container=on",
    "data-echo-quote-off=on",
    ".echo-tree-pager-btn",
    ".echo-tree-guides",
    ".echo-tree-branch-node",
  ]) {
    assert.ok(css.includes(rule), "缺少规则：" + rule);
  }
});

/**
 * 压缩只该删多余的空白，不能删有语义的空白。
 * 选择器里两个复合选择器之间的空格是后代组合子：`[data-x] .y` 压成
 * `[data-x].y` 就成了同一元素的复合条件，规则永远匹配不上 —— 这类回归
 * 在花括号计数里看不出来，必须逐条比对选择器。
 */
test("压缩不破坏选择器里的后代组合子空格", async () => {
  const { box } = await capture();
  // 逗号两侧与组合子两侧的空白本就多余，归一化时一并抹掉；其余空白原样保留
  const scan = (text) =>
    normalizeCss(text)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*([>+~])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  const selectors = (css) =>
    scan(css)
      .split("{")
      .map((part, index) => (index === 0 ? part : part.slice(part.lastIndexOf("}") + 1)))
      .map((part) => part.trim())
      .filter(Boolean);

  const got = new Set(selectors(box.css));
  for (const selector of selectors(rawCss)) {
    if (!selector.includes(" ")) continue;
    assert.ok(got.has(selector), "压缩后的选择器丢了后代组合子空格：" + selector);
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

test("最大压缩保留了会出现在运行时字符串里的标识", () => {
  // 这些不是局部变量名，压缩不能也不该动它们
  for (const token of [
    "data-echo-tree-depth",
    "data-echo-tree-key",
    "threaded-comments:settings",
    "threaded-comments-collector",
  ]) {
    assert.ok(source.includes(token), "压缩后丢失运行时字符串：" + token);
  }
});

/**
 * --test 是排查线上问题用的构建模式：仍然压缩空白，但保留函数名，
 * 这样生产环境崩溃的堆栈能直接对上 src/ 里的代码。
 */
test("--test 模式保留函数名，便于对照堆栈", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const run = promisify(execFile);

  const dir = await mkdtemp(join(tmpdir(), "echo-tree-"));
  const out = join(dir, "index.test-mode.js");
  try {
    await run(process.execPath, ["build.mjs", "--test", "--out", out], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    const debugSource = await readFile(out, "utf8");
    for (const token of ["buildThreadTree", "computeIndentStep", "protectKeys", "syncPager"]) {
      assert.ok(debugSource.includes(token), "--test 产物丢了可读标识：" + token);
    }
    // 仍然是压过的：--test 不能退回源码原样
    assert.ok(debugSource.length < source.length * 2, "--test 产物应仍然经过压缩");
    // 必须同样能加载并激活，否则排查时换上去就跑不起来
    const api = await import("data:text/javascript;base64," + Buffer.from(debugSource).toString("base64"));
    assert.equal(typeof api.activate, "function");
    assert.equal(typeof api.buildThreadTree, "function");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
