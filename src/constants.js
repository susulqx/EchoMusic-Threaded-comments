/**
 * 常量与固定配置。
 * 需要调参时优先改这里，其它模块只引用、不重复定义。
 *
 * 宿主选择器说明（改版时需要同步修改 styles.css 与 container.js）：
 *   楼层容器 .comment-floor-inline
 *   单条回复 .comment-floor-reply
 *   昵称     .comment-floor-reply-name
 *   时间     .comment-floor-reply-time      形如「2025-01-01 10:00:00 · 广东」
 *   回复头   .comment-floor-reply-header    折叠按钮插在它的末尾
 *   加载更多 .comment-floor-more > .comment-floor-more-btn
 *   主评论   .comment-item > .comment-avatar 容器在 .comment-main 里，主评论头像在它的兄弟列
 *   引用块   .comment-floor-quote          回复下方复述被回复评论正文的那一段
 */

export const STORAGE_KEY = "threaded-comments:settings";

/**
 * 宿主选择器。放在这里而不是 dom.js：guides.js 也要用，
 * 而 dom.js 依赖 guides.js（清理图层），选择器若留在 dom.js 会形成循环依赖。
 */
export const REPLY_CLASS = "comment-floor-reply";
export const NAME_CLASS = "comment-floor-reply-name";
export const TIME_CLASS = "comment-floor-reply-time";
export const HEADER_CLASS = "comment-floor-reply-header";
export const AVATAR_CLASS = "comment-floor-reply-avatar";
export const FOOTER_CLASS = "comment-floor-reply-footer";
export const MORE_CLASS = "comment-floor-more";
export const MORE_BUTTON_CLASS = "comment-floor-more-btn";

/** 主评论容器与它的头像列：根分支要从主评论头像往下一级回复连线 */
export const ROOT_ITEM_CLASS = "comment-item";
export const ROOT_AVATAR_CLASS = "comment-avatar";

export const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "lineKeepMain",
  container: false,
  containerHeight: 480,
  paginate: false,
  hideQuote: true,
  markNew: true,
  markDivider: true,
  dividerWidth: 3,
};

/**
 * 分界线粗细范围。
 * 宿主的原生分割线是 1px，默认给 3px —— 它要在一堆 2px 引导线之间被一眼认出来。
 */
export const MIN_DIVIDER_WIDTH = 1;
export const MAX_DIVIDER_WIDTH = 6;
export const DIVIDER_WIDTH_STEP = 1;

/** 红点尺寸与离内容右端的让位距离 */
export const NEW_DOT_SIZE = 8;
export const NEW_DOT_GAP = 2;

/** 固定高度容器：像素范围与滑块步进 */
export const MIN_CONTAINER_HEIGHT = 240;
export const MAX_CONTAINER_HEIGHT = 960;
export const DEFAULT_CONTAINER_HEIGHT = 480;
export const CONTAINER_HEIGHT_STEP = 20;

/** 缩进树最大层数，超过的层不再加深缩进 */
export const MAX_DEPTH = 10;

/** 关系缓存条数上限；在线楼层用到的键会被保护，见 meta-cache.js */
export const MAX_META_ENTRIES = 4800;

/** 单个楼层记录的最大折叠键数量 */
export const MAX_COLLAPSED_KEYS = 400;

/** 楼层内分页：每页的根回复数量 */
export const ROOTS_PER_PAGE = 20;

/**
 * 缩进步长：窄容器 24px、宽容器 32px。
 *
 * 下限 = 头像半径 + 4px 间隙：再小的话子头像会压在父头像的竖线上，
 * 分支没有水平空间可画，树看起来就是一列。宿主头像 30px 见 CommentList.vue 的
 * .comment-floor-reply-avatar，改尺寸时同步这里。
 */
export const AVATAR_SIZE = 30;
export const MIN_GUIDE_GAP = 4;
export const MIN_INDENT_STEP = AVATAR_SIZE / 2 + MIN_GUIDE_GAP;
export const NARROW_WIDTH = 640;
export const NARROW_INDENT_STEP = 24;
export const WIDE_INDENT_STEP = 32;
export const MIN_CONTENT_WIDTH = 150;

/** 关系采集时递归的最大对象层级，防止异常响应把栈打爆 */
export const MAX_RELATION_SCAN_DEPTH = 12;

/** 拦截器优先级：90 表示只观察、不改变数据（0 留给数据转换、-100 是 Mock） */
export const COLLECTOR_PRIORITY = 90;

/** 三种显示模式 */
export const MODES = ["lineCollapseMain", "lineKeepMain", "indentOnly"];
