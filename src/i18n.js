/**
 * 全部面向用户的文案。
 *
 * 多语言化准备：文案按 locale 分组，组件里只写 t("key")，不再出现中文硬编码。
 * 新增语言时在 MESSAGES 里加一个 locale 分组即可；缺失的键会回落到 FALLBACK_LOCALE。
 * 占位符写成 {name}，由 t(key, { name: ... }) 替换。
 */

export const FALLBACK_LOCALE = "zh-Hans";

/** 当前语言。宿主暂未向插件暴露语言设置，先固定；接入后可在此处按宿主语言改写 */
export let currentLocale = "zh-Hans";

export const setLocale = (locale) => {
  currentLocale = MESSAGES[locale] ? locale : FALLBACK_LOCALE;
};

export const MESSAGES = {
  "zh-Hans": {
    "settings.title": "评论区树状显示",
    "settings.description": "把楼层回复按回复关系缩进成树，支持引导线与分支折叠。",
    "settings.note": "调整后立即生效，评论楼层无需重新展开。",

    "settings.enabled.label": "评论区树状显示",
    "settings.enabled.desc": "把楼层回复按回复关系缩进展示。",

    "settings.container.label": "固定高度回复容器",
    "settings.container.desc": "回复较多时在固定高度内滚动，较少时自动收缩。",

    "settings.containerHeight.label": "容器最大高度",
    "settings.containerHeight.desc": "{min}–{max} 像素。",

    "settings.mode.label": "显示模式",
    "settings.mode.option.lineCollapseMain": "线条模式 · 收起主评论",
    "settings.mode.option.lineKeepMain": "线条模式 · 不收起主评论",
    "settings.mode.option.indentOnly": "仅缩进",
    "settings.mode.hint.lineCollapseMain": "折叠时连父评论正文一起收起，只保留作者行与恢复按钮。",
    "settings.mode.hint.lineKeepMain": "折叠时保留父评论正文，只隐藏它下面的回复。",
    "settings.mode.hint.indentOnly": "只做缩进，不显示引导线与折叠按钮。",

    "settings.hideQuote.label": "隐藏回复下方的引用",
    "settings.hideQuote.desc": "树状缩进后父评论就在上方，不再重复展示被回复评论的正文。",

    "settings.markNew.label": "新加载的子回复显示红点",
    "settings.markNew.desc": "点击「加载更多」后，这次新来的二级及以下回复在名字那一行右侧标一个红点。",

    "settings.markDivider.label": "新加载的回复前加分界线",
    "settings.markDivider.desc": "这条新加载的一级回复与旧回复之间画一条带 NEW 字样的灰色横线，区分批次。",

    "settings.dividerWidth.label": "分界线粗细",
    "settings.dividerWidth.desc": "{min}–{max} 像素，默认 3 像素。",

    "settings.paginate.label": "楼层内分页",
    "settings.paginate.desc": "每个根回复及其子回复算一页，每页 {perPage} 个根回复；末页可继续加载。",

    "toggle.expand": "展开回复",
    "toggle.collapse": "收起回复",

    "pager.prev": "上一页",
    "pager.next": "下一页",
    "pager.loadMore": "加载更多",
    "pager.info": "第 {page} / {total} 页",

    // 多行说明用模板串：调试出口打给开发者看，不进 UI
    "debug.help": `__echoTree 调试出口：
  containers()    当前接管的楼层与摘要
  rows(el?)       回复的真实 DOM 顺序、层级与标记
  tree(el?)       最近一次算出的回复树
  recompute(el?)  立刻重算（不传=全部）
  settings()      当前生效的设置
  guides(el?)     引导线绘制快照：量出的矩形、viewBox、每条分支的路径
  css(el?)        关键计算样式（容器 / 回复 / 红点伪元素）`,

    "toast.saveFailed": "树状评论设置保存失败：{message}",
    "console.collectFailed": "[threaded-comments] 回复关系采集失败",
  },
};

const interpolate = (template, params) => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
};

/**
 * 取文案。键不存在时原样返回键名，便于开发期一眼看出遗漏。
 */
export const t = (key, params) => {
  const table = MESSAGES[currentLocale] || MESSAGES[FALLBACK_LOCALE];
  const fallback = MESSAGES[FALLBACK_LOCALE];
  const template = table[key] ?? fallback[key];
  if (template === undefined) return key;
  return interpolate(template, params);
};
