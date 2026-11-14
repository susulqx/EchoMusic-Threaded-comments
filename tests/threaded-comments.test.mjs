import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const api = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64"),
);

test("manifest 只声明 serverIntercept，并给出宿主版本下限", () => {
  assert.equal(manifest.id, "threaded-comments");
  assert.equal(manifest.main, "index.js");
  assert.deepEqual(Object.keys(manifest.capabilities), ["serverIntercept"]);
  assert.match(manifest.requires.echoMusicVersion, /2\.3\.2/);
});

test("容器高度被夹到 240–960", () => {
  assert.equal(api.normalizeSettings({ containerHeight: 9999 }).containerHeight, 960);
  assert.equal(api.normalizeSettings({ containerHeight: 100 }).containerHeight, 240);
});

test("非法设置回落到默认值", () => {
  const settings = api.normalizeSettings({ containerHeight: "abc", mode: "whatever" });
  assert.equal(settings.containerHeight, 480);
  assert.equal(settings.mode, "lineKeepMain");
  assert.equal(settings.enabled, true);
  assert.equal(settings.container, false);
  assert.equal(settings.paginate, false);
  assert.equal(settings.hideQuote, true);
  assert.deepEqual(api.normalizeSettings(null), {
    enabled: true,
    mode: "lineKeepMain",
    container: false,
    containerHeight: 480,
    paginate: false,
    hideQuote: true,
    markNew: true,
    markDivider: true,
  });
});

test("隐藏引用默认开启，显式关闭时保留 false", () => {
  assert.equal(api.normalizeSettings({}).hideQuote, true);
  assert.equal(api.normalizeSettings({ hideQuote: false }).hideQuote, false);
  assert.equal(api.normalizeSettings({ hideQuote: 0 }).hideQuote, false);
});

test("线性回复链得到递增深度，且父先子后", () => {
  const tree = api.buildThreadTree([
    { id: "a", pid: "", time: 1 },
    { id: "b", pid: "a", time: 2 },
    { id: "c", pid: "b", time: 3 },
  ]);
  assert.deepEqual(
    tree.map((node) => [node.id, node.depth]),
    [["a", 0], ["b", 1], ["c", 2]],
  );
  assert.equal(tree[0].hasChildren, true);
  assert.equal(tree[0].descendantCount, 2);
  assert.equal(tree[2].hasChildren, false);
});

test("父级不在集合内的回复视作根", () => {
  const tree = api.buildThreadTree([
    { id: "a", pid: "", time: 1 },
    { id: "z", pid: "missing", time: 2 },
  ]);
  assert.equal(tree.find((node) => node.id === "z").depth, 0);
});

test("成环的回复不会死循环，且降级为根", () => {
  const tree = api.buildThreadTree([
    { id: "a", pid: "b", time: 1 },
    { id: "b", pid: "a", time: 2 },
  ]);
  assert.equal(tree.length, 2);
  assert.deepEqual(tree.map((node) => node.depth), [0, 0]);
});

test("深度被上限截断到 10", () => {
  const items = [];
  for (let index = 0; index < 15; index += 1) {
    items.push({
      id: "n" + index,
      pid: index === 0 ? "" : "n" + (index - 1),
      time: index,
    });
  }
  const tree = api.buildThreadTree(items);
  assert.equal(tree.length, 15);
  assert.equal(Math.max(...tree.map((node) => node.depth)), 10);
  assert.equal(api.computeDepthCap(99), 10);
  assert.equal(api.computeDepthCap(-3), 0);
});

test("同级兄弟按时间升序排列", () => {
  const tree = api.buildThreadTree([
    { id: "root", pid: "", time: 0 },
    { id: "late", pid: "root", time: 30 },
    { id: "early", pid: "root", time: 10 },
  ]);
  assert.deepEqual(tree.map((node) => node.id), ["root", "early", "late"]);
  assert.equal(tree[1].depth, 1);
  assert.equal(tree[2].depth, 1);
});

test("对齐键规整空白并剥掉 IP 尾巴", () => {
  assert.equal(
    api.resolveMetaKey("  张   三 ", "2024-01-02 10:00:00 · 广东"),
    "张 三\u00002024-01-02 10:00:00",
  );
  assert.equal(api.resolveMetaKey("", "2024-01-02 10:00:00"), "");
  assert.equal(api.resolveMetaKey("张三", ""), "");
});

test("缩进步长随容器宽度收窄，但不低于头像半宽下限", () => {
  assert.equal(api.computeIndentStep(900, 2), 32);
  assert.equal(api.computeIndentStep(600, 2), 24);
  assert.equal(api.computeIndentStep(300, 10), 19);
});

/* ------------------------------------------------------------------ *
 * 多语言：文案只在 i18n.js 里，其它模块一律走 t()
 * ------------------------------------------------------------------ */

test("文案默认输出中文，并支持占位符", () => {
  assert.equal(api.t("pager.prev"), "上一页");
  assert.equal(api.t("pager.next"), "下一页");
  assert.equal(api.t("pager.loadMore"), "加载更多");
  assert.equal(api.t("pager.info", { page: 2, total: 5 }), "第 2 / 5 页");
  assert.equal(
    api.t("settings.containerHeight.desc", { min: 240, max: 960 }),
    "240–960 像素。",
  );
});

test("未知键原样返回，便于开发期发现遗漏", () => {
  assert.equal(api.t("nope.missing"), "nope.missing");
});

test("未知语言回落到中文", () => {
  api.setLocale("xx-YY");
  assert.equal(api.t("pager.prev"), "上一页");
  api.setLocale("zh-Hans");
  assert.equal(api.t("pager.prev"), "上一页");
});

test("界面文案都登记在 i18n 里，其它模块无中文字面量", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../src/", import.meta.url);
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".js") && name !== "i18n.js",
  );
  const offenders = [];
  for (const name of files) {
    const raw = await readFile(new URL(name, dir), "utf8");
    // 去掉块注释与行注释后，剩下的才是真正会进入运行时的字符串
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const hits = code.match(/["'`][^"'`]*[\u4e00-\u9fa5][^"'`]*["'`]/g);
    if (hits) offenders.push(name + " -> " + hits.join(" | "));
  }
  assert.deepEqual(offenders, []);
});

test("打包产物自包含：无相对 import，可直接经 Blob URL 加载", () => {
  assert.doesNotMatch(source, /^\s*import\s[^;]*from\s*["']\./m);
  assert.doesNotMatch(source, /from\s*["'][^"']*\.css["']/);
  // 产物为了最小体积不带任何文件头注释：首行就该是代码
  assert.doesNotMatch(source.slice(0, 200), /^\s*\/\*/);
  assert.ok(source.trimStart().startsWith("var ") || source.trimStart().startsWith("const "));
});
