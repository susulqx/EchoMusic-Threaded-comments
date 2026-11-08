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
 */

export const STORAGE_KEY = "threaded-comments:settings";

export const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "lineKeepMain",
  container: false,
  containerHeight: 480,
  paginate: false,
};

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

/** 缩进步长：窄容器 24px、宽容器 32px，拟合后不低于 19px */
export const MIN_INDENT_STEP = 19;
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
