/**
 * 零依赖打包脚本：把 src/ 下的小模块合成插件入口 index.js（单文件 ESM）。
 *
 * 为什么要打包：宿主通过 Blob URL 加载插件入口，入口里的 `import './x.js'`
 * 不会被解析到插件目录，所以交付物必须是自包含的单文件。
 *
 * 用法：
 *   node build.mjs              打包并压缩（默认，产物就是交付物）
 *   node build.mjs --no-minify  只打包不压缩，便于对照排查
 *   node build.mjs --watch      改 src/ 后自动重建
 *
 * 压缩策略：去注释、去缩进、合并可安全续接的换行；**不改任何标识符**，
 * 也不做任何会改变运行时的变换，所以既压体积又保持源码可读、性能不变。
 *
 * 只支持本项目实际用到的语法子集：静态相对 import、具名 export、export default。
 * 不引入 esbuild / rollup，避免为一次拼接装一条工具链。
 */

import { readFileSync, writeFileSync, existsSync, watch } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(ROOT, "src/entry.js");
const OUTPUT = resolve(ROOT, "index.js");

const argv = process.argv.slice(2);
const MINIFY = !argv.includes("--no-minify");
const WATCH = argv.includes("--watch");

const IMPORT_RE =
  /^\s*import\s+(?:(?<defaultName>[\w$]+)\s*,?\s*)?(?:\{(?<named>[^}]*)\})?\s*from\s*["'](?<source>[^"']+)["'];?\s*$/gm;
const NAMED_EXPORT_RE =
  /^\s*export\s+(?<decl>(?:async\s+)?(?:function|const|let|var|class)\s+(?<name>[\w$]+))/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{(?<names>[^}]*)\}\s*;?\s*$/gm;
const EXPORT_DEFAULT_RE = /^\s*export\s+default\s+/gm;

const toPosix = (path) => path.split("\\").join("/");

/* ------------------------------------------------------------------ *
 * CSS 压缩：只去注释与多余空白，不动任何选择器或值
 * ------------------------------------------------------------------ */

const countChar = (text, char) => text.split(char).length - 1;

/** 压缩自检：花括号数量必须与原文一致，否则说明词法扫描吃错了内容 */
const assertCssIntact = (raw, min) => {
  for (const char of ["{", "}"]) {
    if (countChar(raw, char) !== countChar(min, char)) {
      throw new Error("CSS 压缩破坏了 " + char + " 的配对（原文 " + countChar(raw, char) + " / 压缩后 " + countChar(min, char) + "）");
    }
  }
  if (raw.includes("!important") && !min.includes("!important")) {
    throw new Error("CSS 压缩丢失了 !important");
  }
};

const minifyCss = (css) => {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === "\\") {
          j += 2;
          continue;
        }
        if (css[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < css.length && /\s/.test(css[j])) j += 1;
      const prev = out[out.length - 1] || "";
      const next = css[j] || "";
      // 只有两侧都是普通字符时才保留一个空格
      if (/[\w\-)]/.test(prev) && /[\w\-.(#:]/.test(next)) out += " ";
      i = j;
      continue;
    }
    if ("{};:,>".includes(c)) {
      out = out.replace(/\s+$/, "");
      out += c;
      i += 1;
      // 紧跟其后的空白也吃掉
      while (i < css.length && /\s/.test(css[i])) i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.trim();
};

/* ------------------------------------------------------------------ *
 * JS 压缩：词法扫描，剥注释 + 折叠空白，换行只在安全时删除
 * ------------------------------------------------------------------ */

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** 行尾出现这些字符时，与下一行拼接不会改变语义（可安全删换行） */
const SAFE_TO_JOIN = new Set([
  "{", "(", "[", ",", ";", ":", "?", "=", "+", "-", "*", "/", "%",
  "&", "|", "<", ">", "!", "~", "^", ".", "'", '"', "`",
]);

/** 这些字符之后出现的 / 是正则字面量，而不是除号 */
const REGEX_PRECEDERS = new Set([
  "", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^", "}",
]);

const minifyJs = (code) => {
  let out = "";
  let i = 0;
  const n = code.length;
  let pendingBreak = false;
  let pendingSpace = false;

  const lastChar = () => (out.length ? out[out.length - 1] : "");

  /** 决定「上一 token」与「即将输出的 token」之间要插什么 */
  const flushGap = (nextChar) => {
    const hadNewline = pendingBreak;
    const hadSpace = pendingSpace;
    pendingBreak = false;
    pendingSpace = false;
    if (!hadNewline && !hadSpace) return;
    const prev = lastChar();
    if (!prev) return;
    // 两个标识符字符直接相邻会被粘成一个词，必须留一个空格
    if (nextChar && IDENT_CHAR.test(prev) && IDENT_CHAR.test(nextChar)) {
      out += " ";
      return;
    }
    // 其余情况只在原来就有换行、且行尾字符无法安全续接时才保留换行（如 return / 后置 ++）
    if (hadNewline && !SAFE_TO_JOIN.has(prev)) out += "\n";
  };

  while (i < n) {
    const c = code[i];

    // 行注释
    if (c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") i += 1;
      pendingBreak = true;
      continue;
    }
    // 块注释：跨行时留一个换行意图，避免 a/*...*/b 被粘成一个词
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      let sawNewline = false;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") sawNewline = true;
        i += 1;
      }
      i += 2;
      if (sawNewline) pendingBreak = true;
      continue;
    }

    // 字符串与模板串：原样保留（模板串内不压缩，保证插值内容不变）
    if (c === '"' || c === "'" || c === "`") {
      flushGap(c);
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += code.slice(i, j);
      i = j;
      continue;
    }

    // 正则字面量
    if (c === "/" && REGEX_PRECEDERS.has(lastChar())) {
      flushGap(c);
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = code[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          j += 1;
          break;
        } else if (d === "\n") break;
        j += 1;
      }
      while (j < n && /[a-z]/i.test(code[j])) j += 1;
      out += code.slice(i, j);
      i = j;
      continue;
    }

    // 空白：只记录「这里有过空隙」，是否真的输出由 flushGap 决定
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(code[j])) {
        if (code[j] === "\n") pendingBreak = true;
        else pendingSpace = true;
        j += 1;
      }
      i = j;
      continue;
    }

    flushGap(c);
    out += c;
    i += 1;
  }

  return out;
};

/* ------------------------------------------------------------------ *
 * 模块收集
 * ------------------------------------------------------------------ */

const parseSpecifiers = (raw) =>
  String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+/).map((item) => item.trim());
      return { imported, local: local || imported };
    });

/** CSS 当作「默认导出一个字符串」的模块处理 */
const loadCssModule = (path) => {
  const raw = readFileSync(path, "utf8");
  const css = MINIFY ? minifyCss(raw) : raw;
  if (MINIFY) assertCssIntact(raw, css);
  return {
    id: toPosix(relative(ROOT, path)),
    body: "const __default = " + JSON.stringify(css) + ";",
    prelude: "",
    exports: ["default"],
    deps: [],
  };
};

const loadModule = (path, seen) => {
  const id = toPosix(relative(ROOT, path));
  if (seen.has(id)) return seen.get(id);
  if (path.endsWith(".css")) {
    const mod = loadCssModule(path);
    seen.set(id, mod);
    return mod;
  }

  const source = readFileSync(path, "utf8");
  const deps = [];
  const prelude = [];
  const exports = [];

  // 1. import -> 解构语句。每个模块体包在独立 IIFE 里，同名导出互不干扰。
  const withoutImports = source.replace(IMPORT_RE, (match, defaultName, named, src) => {
    const depModule = loadModule(resolve(dirname(path), src), seen);
    deps.push(depModule.id);
    const ref = "__modules[" + JSON.stringify(depModule.id) + "]";
    if (defaultName) prelude.push("const " + defaultName + " = " + ref + ".default;");
    const wanted = parseSpecifiers(named);
    if (wanted.length) {
      const bindings = wanted.map((spec) =>
        spec.imported === spec.local ? spec.imported : spec.imported + ": " + spec.local,
      );
      prelude.push("const { " + bindings.join(", ") + " } = " + ref + ";");
    }
    return "";
  });

  // 2. export -> 收集名字并去掉关键字
  const body = withoutImports
    .replace(NAMED_EXPORT_RE, (match, decl, name) => {
      exports.push(name);
      return decl;
    })
    .replace(EXPORT_DEFAULT_RE, "const __default = ")
    .replace(EXPORT_LIST_RE, (match, names) => {
      for (const spec of parseSpecifiers(names)) exports.push(spec.local);
      return "";
    });

  const mod = { id, body, exports, deps, prelude: prelude.join("\n") };
  seen.set(id, mod);
  return mod;
};

/* ------------------------------------------------------------------ *
 * 拼装与输出
 * ------------------------------------------------------------------ */

const banner = (modules) => {
  const lines = [
    "/**",
    " * 评论区树状显示（threaded-comments）",
    " *",
    " * 本文件由 build.mjs 从 src/ 打包生成，请勿直接编辑。",
    " * 修改请改 src/ 下的模块，然后执行 node build.mjs。",
    " *",
    " * 模块划分：",
  ];
  for (const mod of modules) {
    if (mod.id.endsWith(".css")) continue;
    lines.push(" *   " + mod.id);
  }
  lines.push(" */");
  return lines.join("\n");
};

const build = () => {
  const modules = new Map();
  const entry = loadModule(ENTRY, modules);

  // 依赖先于使用方执行
  const ordered = [];
  const visiting = new Set();
  const visit = (mod) => {
    if (visiting.has(mod.id)) return;
    visiting.add(mod.id);
    for (const depId of mod.deps) visit(modules.get(depId));
    ordered.push(mod);
  };
  visit(entry);

  const chunks = ["const __modules = {};"];
  for (const mod of ordered) {
    const exportList = mod.exports.length
      ? "  return { " +
        mod.exports.map((name) => (name === "default" ? "default: __default" : name)).join(", ") +
        " };"
      : "  return {};";
    chunks.push("/* ---- " + mod.id + " ---- */");
    chunks.push("__modules[" + JSON.stringify(mod.id) + "] = (() => {");
    if (mod.prelude) chunks.push(mod.prelude);
    chunks.push(mod.body.replace(/\s+$/, ""));
    chunks.push(exportList);
    chunks.push("})();");
  }

  const names = entry.exports.filter((name) => name !== "default");
  if (names.length) {
    chunks.push("const { " + names.join(", ") + " } = __modules[" + JSON.stringify(entry.id) + "];");
    chunks.push("export { " + names.join(", ") + " };");
  }

  const raw = chunks.join("\n") + "\n";
  const code = MINIFY ? banner(ordered) + "\n" + minifyJs(raw) + "\n" : banner(ordered) + "\n" + raw;
  writeFileSync(OUTPUT, code, "utf8");

  const kb = (size) => (size / 1024).toFixed(1) + " KB";
  const saved = raw.length ? Math.round((1 - code.length / raw.length) * 100) : 0;
  console.log(
    "[build] " +
      ordered.length +
      " 个模块 -> " +
      toPosix(relative(ROOT, OUTPUT)) +
      "  " +
      kb(Buffer.byteLength(code)) +
      (MINIFY ? "（原始 " + kb(Buffer.byteLength(raw)) + "，压缩 " + saved + "%）" : "（未压缩）"),
  );
  return code;
};

const main = () => {
  build();
  if (!WATCH) return;
  console.log("[build] watching src/ ...");
  let timer = 0;
  watch(resolve(ROOT, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build();
      } catch (error) {
        console.error("[build] 失败：" + (error && error.message));
      }
    }, 120);
  });
};

if (!existsSync(ENTRY)) {
  console.error("[build] 找不到 " + ENTRY);
  process.exit(1);
}
main();
