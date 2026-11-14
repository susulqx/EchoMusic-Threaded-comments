/**
 * 打包脚本：把 src/ 下的小模块合成插件入口 index.js（单文件 ESM）。
 *
 * 为什么要打包：宿主通过 Blob URL 加载插件入口，入口里的 `import './x.js'`
 * 不会被解析到插件目录，所以交付物必须是自包含的单文件。
 *
 * 为什么用 esbuild：代码合并与压缩都交给它（业界标准、Go 写的、构建期快，
 * 产物运行时零额外开销）。自己写词法扫描容易在 CSS 选择器空格一类的细节上
 * 出错 —— `[data-x] .y` 被压成 `[data-x].y` 就永远匹配不上。
 *
 * 用法：
 *   node build.mjs          最大压缩（默认，产物就是交付物）
 *   node build.mjs --test   压缩但保留标识符与函数名，便于排查线上问题
 *   node build.mjs --out x  写到别的文件（测试对照用）
 *   node build.mjs --watch  改 src/ 后自动重建
 *
 * 两种模式生成的 CSS 相同，只有 JS 标识符是否重命名不同，
 * 所以 --test 产物可以直接替换 index.js 跑同一个问题，堆栈里还能看到函数名。
 *
 * CSS 与 JS 一起进图：src/styles.css 由本脚本的插件转成
 * `export default "<压缩后的 css>"`，所以产物里 CSS 是字符串常量，
 * 不出现任何 .css 引用。
 */

import { readFile, writeFile, watch } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(ROOT, "src/entry.js");

const argv = process.argv.slice(2);
// --test：仍压缩空白与语法，但不重命名任何标识符，堆栈与产物都能读
const TESTMODE = argv.includes("--test");
const WATCH = argv.includes("--watch");
// 默认写交付物 index.js；测试要另存一份对照产物时不污染交付物
const outFlag = argv.indexOf("--out");
const OUTPUT = outFlag === -1 ? resolve(ROOT, "index.js") : resolve(ROOT, argv[outFlag + 1]);

const toPosix = (path) => path.split("\\").join("/");

/* ------------------------------------------------------------------ *
 * CSS：压缩后变成默认导出的字符串
 * ------------------------------------------------------------------ */

const countChar = (text, char) => text.split(char).length - 1;

/** 压缩自检：花括号与 !important 数量必须与原文一致 */
const assertCssIntact = (raw, min) => {
  for (const char of ["{", "}"]) {
    if (countChar(raw, char) !== countChar(min, char)) {
      throw new Error(
        "CSS 压缩破坏了 " + char + " 的配对（原文 " + countChar(raw, char) + " / 压缩后 " + countChar(min, char) + "）",
      );
    }
  }
  if (countChar(raw, "!important") !== countChar(min, "!important")) {
    throw new Error("CSS 压缩丢失了 !important");
  }
};

const cssPlugin = {
  name: "css-as-string",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const raw = await readFile(args.path, "utf8");
      const out = await esbuild.transform(raw, { loader: "css", minify: true, charset: "utf8" });
      assertCssIntact(raw, out.code);
      return {
        contents: "export default " + JSON.stringify(out.code) + ";",
        loader: "js",
        resolveDir: dirname(args.path),
      };
    });
  },
};

/* ------------------------------------------------------------------ *
 * 构建
 * ------------------------------------------------------------------ */

const kB = (size) => (size / 1024).toFixed(1) + " KB";

const bundle = async (minify) =>
  esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    charset: "utf8",
    // 最大压缩；--test 只关掉标识符重命名并保留函数名
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: !TESTMODE,
    keepNames: TESTMODE,
    legalComments: "none",
    metafile: true,
    write: false,
    plugins: [cssPlugin],
    logLevel: "warning",
  });

const build = async () => {
  const result = await bundle(true);
  const label = TESTMODE ? "--test（压缩但保留标识符，用于排查）" : "最大压缩";
  const code = result.outputFiles[0].text;
  await writeFile(OUTPUT, code, "utf8");

  const inputs = Object.keys(result.metafile.inputs).length;
  console.log(
    "[build] " +
      inputs +
      " 个模块 -> " +
      toPosix(relative(ROOT, OUTPUT)) +
      "  " +
      kB(Buffer.byteLength(code)) +
      "  " +
      label,
  );
  return code;
};

const main = async () => {
  await build();
  if (!WATCH) return;
  console.log("[build] watching src/ ...");
  let timer = 0;
  const watcher = watch(resolve(ROOT, "src"), { recursive: true });
  for await (const _ of watcher) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((error) => console.error("[build] 失败：" + (error && error.message)));
    }, 120);
  }
};

main().catch((error) => {
  console.error("[build] 失败：" + (error && (error.message || error)));
  process.exitCode = 1;
});