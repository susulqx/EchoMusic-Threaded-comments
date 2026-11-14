import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');


const splitSel = (sel) => sel.split(/\s+/).filter(Boolean).map((part) => {
  const child = part.startsWith('>');
  return { child, cls: part.replace(/^>/, '').replace(/^\.[\w-]+/, (m) => m.slice(1)) };
});

const walk = (node, visit) => {
  for (const kid of node.children) { if (visit(kid) === false) continue; walk(kid, visit); }
};

const matches = (el, cls) => el.classList && el.classList.contains(cls);

/*
 * 桩里的几何：真实浏览器有排版，桩没有，所以按「每条回复占 ROW_HEIGHT」合成一套。
 * 缩进步长按 data-echo-tree-depth 推，引导线才能算出真实的父子相对位置。
 * 被 data-echo-tree-hidden 标记的行给零矩形且不占位，等价于 display:none。
 */
const ROW_HEIGHT = 96;
const INDENT_STEP = 32;
const rects = new WeakMap();

const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

const findContainer = (el) => {
  let cur = el;
  while (cur) {
    if (matches(cur, 'comment-floor-inline')) return cur;
    cur = cur.parent;
  }
  return null;
};

const layoutContainer = (container) => {
  let top = 0;
  for (const child of container.children) {
    if (!matches(child, 'comment-floor-reply')) continue;
    if (child.hasAttribute('data-echo-tree-hidden')) {
      rects.set(child, EMPTY_RECT);
      continue;
    }
    const depth = Number(child.getAttribute('data-echo-tree-depth') || 0);
    const left = depth * INDENT_STEP;
    rects.set(child, rect(left, top, 600, ROW_HEIGHT));
    const avatar = child.querySelector('.comment-floor-reply-avatar');
    if (avatar) rects.set(avatar, rect(left + 16, top + 14, 30, 30));
    const footer = child.querySelector('.comment-floor-reply-footer');
    if (footer) rects.set(footer, rect(left + 58, top + 66, 120, 18));
    // 名字行：昵称与徽章横向排开，红点要落在这一行最右侧那块内容之后
    const header = child.querySelector('.comment-floor-reply-header');
    if (header) {
      let cursor = left + 58;
      for (const node of header.children) {
        const wide = matches(node, 'comment-floor-reply-name') ? 48 : 34;
        rects.set(node, rect(cursor, top + 14, wide, 16));
        cursor += wide + 8;
      }
    }
    top += ROW_HEIGHT;
  }
  rects.set(container, rect(0, 0, 800, top));
};

/**
 * 主评论头像不在楼层容器内（容器只是 .comment-main 里的一块），
 * 它没有容器可换算出局部坐标，桩里直接给一个固定在容器左上方的矩形。
 */
const ROOT_AVATAR_RECT = rect(-45, -96, 36, 36);
const isRootAvatar = (el) => {
  if (!matches(el, 'comment-avatar')) return false;
  const item = el.parent;
  return Boolean(item && matches(item, 'comment-item'));
};

const measureRect = (el) => {
  if (isRootAvatar(el)) return ROOT_AVATAR_RECT;
  const container = findContainer(el);
  if (!container) return null;
  layoutContainer(container);
  return rects.get(el) || null;
};

const queryAllIn = (root, cls) => {
  const out = [];
  walk(root, (el) => { if (matches(el, cls)) out.push(el); });
  return out;
};

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.className = '';
    this.textContent = '';
    this.clientWidth = 800;
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.isConnected = true;
    this._listeners = [];
    this.style = {
      _props: new Map(),
      setProperty(k, v) { this._props.set(k, String(v)); },
      removeProperty(k) { this._props.delete(k); },
      getPropertyValue(k) { return this._props.get(k) ?? ''; },
    };
    this.classList = {
      _set: () => new Set(String(this.className).split(/\s+/).filter(Boolean)),
      contains(c) { return this._set().has(c); },
      add(c) { const s = this._set(); s.add(c); this.className = [...s].join(' '); },
      remove(c) { const s = this._set(); s.delete(c); this.className = [...s].join(' '); },
    };
  }
  get parentNode() { return this.parent; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  // 真实 DOM 里 setAttribute('class') 与 className 是同一个东西，桩必须一致，
  // 否则 guides.js 用 setAttribute 建的 SVG 组永远查不到。
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === 'class') this.className = String(v);
  }
  removeAttribute(k) {
    this.attrs.delete(k);
    if (k === 'class') this.className = '';
  }
  hasAttribute(k) { return this.attrs.has(k); }
  getBoundingClientRect() {
    const rect = measureRect(this);
    return rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
  // 真实 DOM 的 appendChild / insertBefore 都是「移动」语义：先把节点从原位置摘掉，
  // 桩若只是 push 会产生同一节点出现两次的假象，排序相关的断言就废了。
  detach(child) {
    if (child.parent) {
      const i = child.parent.children.indexOf(child);
      if (i >= 0) child.parent.children.splice(i, 1);
    }
    const j = this.children.indexOf(child);
    if (j >= 0) this.children.splice(j, 1);
  }
  appendChild(child) {
    this.detach(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  }
  insertBefore(child, ref) {
    this.detach(child);
    const index = ref ? this.children.indexOf(ref) : -1;
    child.parent = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
    this.isConnected = false;
  }
  addEventListener(type, fn, capture) { this._listeners.push({ type, fn, capture }); }
  removeEventListener(type, fn, capture) {
    this._listeners = this._listeners.filter((l) => !(l.type === type && l.fn === fn && !!l.capture === !!capture));
  }
  contains(node) { let cur = node; while (cur) { if (cur === this) return true; cur = cur.parent; } return false; }
  querySelectorAll(sel) {
    const parts = splitSel(sel);
    const last = parts[parts.length - 1].cls;
    return queryAllIn(this, last);
  }
  querySelector(sel) {
    // 支持 ".a" 与 ".a > .b"
    const parts = splitSel(sel);
    if (parts.length === 1) return queryAllIn(this, parts[0].cls)[0] ?? null;
    const [parentSel, childSel] = parts;
    for (const parent of queryAllIn(this, parentSel.cls)) {
      for (const kid of parent.children) if (matches(kid, childSel.cls)) return kid;
    }
    return null;
  }
  closest(sel) {
    const parts = splitSel(sel);
    const last = parts[parts.length - 1].cls;
    let cur = this;
    while (cur) {
      if (matches(cur, last)) {
        if (parts.length === 1) return cur;
        const parentSel = parts[0].cls;
        if (cur.parent && matches(cur.parent, parentSel)) return cur;
      }
      cur = cur.parent;
    }
    return null;
  }
  dispatch(type, event = {}) {
    for (const l of this._listeners.filter((x) => x.type === type)) l.fn(event);
  }
  // 宿主按钮是真实 <button>，插件用 element.click() 转发；桩需要同样的入口。
  click() {
    this.dispatch('click', { target: this, preventDefault() {}, stopPropagation() {} });
  }
}

globalThis.document = {
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => new El(tag),
  body: new El('body'),
};

// 调试出口挂在 window 上，桩必须提供；计算样式按「读内联 + 属性」给个最小实现，
// 足够验证 __echoTree.css() 真的取到了值，不校验浏览器排版结果
globalThis.window = globalThis;
globalThis.getComputedStyle = (el, pseudo) => {
  const read = (key) => {
    if (pseudo) return el.__pseudoStyle?.[pseudo]?.[key] || '';
    if (key.startsWith('--')) return el.style.getPropertyValue(key);
    return el.__computed?.[key] || '';
  };
  return { getPropertyValue: read };
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
};
// 真实的 rAF 是异步的：同步执行会让插件内部的 frame 标记永远清不掉。
globalThis.requestAnimationFrame = (fn) => { queueMicrotask(fn); return 1; };
globalThis.cancelAnimationFrame = () => {};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));


const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const store = new Map();
const interceptors = [];
const observers = [];
const injectedCss = [];
let settingsPage = null;

const noopVue = {
  reactive: (value) => value,
  computed: (fn) => ({ get value() { return fn(); } }),
  defineComponent: (options) => options,
  defineAsyncComponent: (component) => component,
  h: () => ({}),
};

const makeCtx = () => ({
  vue: noopVue,
  storage: {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value) { store.set(key, value); },
  },
  css: { inject(css, options) { injectedCss.push({ css, id: options && options.id }); return () => {}; } },
  ui: {
    components: { Switch: {}, Select: {}, Slider: {} },
    settings: { define(definition) { settingsPage = definition; return () => {}; } },
  },
  server: { intercept(handler, options) { interceptors.push({ handler, options }); return () => {}; } },
  dom: { observe(selector, handler) { observers.push({ selector, handler }); return () => {}; } },
  toast: { info() {}, success() {}, warning() {}, danger() {} },
  dispose() {},
});

const reset = () => {
  store.clear();
  interceptors.length = 0;
  observers.length = 0;
  injectedCss.length = 0;
  settingsPage = null;
  mod.deactivate();
};

const makeReply = (name, time) => {
  const reply = new El('div');
  reply.className = 'comment-floor-reply';
  const avatar = new El('div');
  avatar.className = 'comment-floor-reply-avatar';
  reply.appendChild(avatar);
  const body = new El('div');
  body.className = 'comment-floor-reply-body';
  const header = new El('div');
  header.className = 'comment-floor-reply-header';
  const nameEl = new El('span');
  nameEl.className = 'comment-floor-reply-name';
  nameEl.textContent = name;
  header.appendChild(nameEl);
  body.appendChild(header);
  const content = new El('div');
  content.className = 'comment-floor-reply-content';
  content.textContent = name + ' 的正文';
  body.appendChild(content);
  const footer = new El('div');
  footer.className = 'comment-floor-reply-footer';
  const timeEl = new El('span');
  timeEl.className = 'comment-floor-reply-time';
  timeEl.textContent = time + ' · 广东';
  footer.appendChild(timeEl);
  body.appendChild(footer);
  // 宿主会在回复正文下方复述被回复评论；插件按设置隐藏它
  const quote = new El('blockquote');
  quote.className = 'comment-floor-quote';
  quote.textContent = '被回复的正文';
  body.appendChild(quote);
  reply.appendChild(body);
  return reply;
};

// 甲(10:00) <- 乙(10:01) <- 丙(10:02)，丁(10:03) 也挂在甲下
const buildFloor = () => {
  const container = new El('div');
  container.className = 'comment-floor-inline';
  const replies = [
    makeReply('甲', '2025-01-01 10:00:00'),
    makeReply('乙', '2025-01-01 10:01:00'),
    makeReply('丙', '2025-01-01 10:02:00'),
    makeReply('丁', '2025-01-01 10:03:00'),
  ];
  for (const reply of replies) container.appendChild(reply);
  return { container, replies };
};

const floorBody = () => ({
  status: 1,
  list: [
    { comment_id: '11', pid: '10', user_name: '甲', addtime: '2025-01-01 10:00:00' },
    { comment_id: '12', pid: '11', user_name: '乙', addtime: '2025-01-01 10:01:00' },
    { comment_id: '13', pid: '12', user_name: '丙', addtime: '2025-01-01 10:02:00' },
    { comment_id: '14', pid: '11', user_name: '丁', addtime: '2025-01-01 10:03:00' },
  ],
});

test('activate 注册拦截器、观察器、设置页与样式', async () => {
  reset();
  await mod.activate(makeCtx());
  assert.equal(interceptors.length, 1);
  assert.equal(interceptors[0].options.priority, 90);
  assert.equal(interceptors[0].options.name, 'threaded-comments-collector');
  assert.ok(interceptors[0].options.match instanceof RegExp);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].selector, '.comment-floor-inline');
  assert.equal(settingsPage.title, '评论区树状显示');
  assert.equal(settingsPage.component.name, 'ThreadedCommentsSettings');
  assert.equal(injectedCss.length, 1);
  assert.equal(injectedCss[0].id, 'threaded-comments');
});

test('拦截器旁路采集关系并原样透传响应', async () => {
  reset();
  await mod.activate(makeCtx());
  const body = floorBody();
  const response = { status: 200, body };
  const returned = await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => response);
  assert.equal(returned, response);
});

test('容器按关系缩进，兄弟不共享子树', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  observers[0].handler(container);

  assert.equal(container.getAttribute('data-echo-thread'), 'on');
  assert.equal(container.getAttribute('data-echo-mode'), 'lineKeepMain');
  // 引用块默认隐藏：宿主那句复述在树状缩进后与父评论重复
  assert.equal(container.getAttribute('data-echo-quote-off'), 'on');
  assert.equal(container.style.getPropertyValue('--echo-tree-step'), '32px');

  const depths = replies.map((reply) => reply.getAttribute('data-echo-tree-depth'));
  assert.deepEqual(depths, ['0', '1', '2', '1']);
  // 折叠入口是 SVG 分支组：甲、乙各有子回复，丙没有
  assert.deepEqual(branchKeys(container), [keyOf('甲', '2025-01-01 10:00:00'), keyOf('乙', '2025-01-01 10:01:00')]);
  assert.equal(container.querySelectorAll('.echo-tree-branch').length, 2);
});

/** 分支组的 data-echo-tree-key 即「昵称\0时间」 */
const keyOf = (name, time) => name + '\u0000' + time;

/** 容器里回复节点的实际 DOM 顺序，按昵称读，便于直接对照期望 */
const replyOrder = (container) =>
  Array.from(container.children)
    .filter((child) => child.classList.contains('comment-floor-reply'))
    .map((child) => child.querySelector('.comment-floor-reply-name').textContent);

const branchKeys = (container) =>
  container.querySelectorAll('.echo-tree-branch').map((group) => group.getAttribute('data-echo-tree-key'));

const branchOf = (container, name, time) =>
  container.querySelectorAll('.echo-tree-branch').find((group) => group.getAttribute('data-echo-tree-key') === keyOf(name, time)) || null;

test('折叠父级隐藏子孙但保留兄弟', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  observers[0].handler(container);

  const toggle = branchOf(container, '乙', '2025-01-01 10:01:00');
  assert.ok(toggle, '乙有子回复 → 有折叠节点');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  container.dispatch('click', { target: toggle, preventDefault() {}, stopPropagation() {} });
  await tick();

  assert.equal(replies[1].getAttribute('data-echo-tree-collapsed'), 'on');
  assert.equal(replies[2].getAttribute('data-echo-tree-hidden'), 'on');
  assert.equal(replies[3].getAttribute('data-echo-tree-hidden'), null, '兄弟不受影响');
  assert.equal(branchOf(container, '乙', '2025-01-01 10:01:00').getAttribute('aria-expanded'), 'false');

  container.dispatch('click', { target: branchOf(container, '乙', '2025-01-01 10:01:00'), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(replies[2].getAttribute('data-echo-tree-hidden'), null);
});

test('子回复紧跟父评论：ABCD 且 D 是 A 的回复 → ADCB', async () => {
  reset();
  await mod.activate(makeCtx());
  // 宿主按接口顺序平铺：A B C D，D 挂在 A 下
  const container = new El('div');
  container.className = 'comment-floor-inline';
  const replies = [
    makeReply('A', '2025-01-01 10:00:00'),
    makeReply('B', '2025-01-01 10:01:00'),
    makeReply('C', '2025-01-01 10:02:00'),
    makeReply('D', '2025-01-01 10:03:00'),
  ];
  for (const reply of replies) container.appendChild(reply);
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({
    status: 200,
    body: {
      status: 1,
      list: [
        { comment_id: '1', pid: '0', user_name: 'A', addtime: '2025-01-01 10:00:00' },
        { comment_id: '2', pid: '0', user_name: 'B', addtime: '2025-01-01 10:01:00' },
        { comment_id: '3', pid: '0', user_name: 'C', addtime: '2025-01-01 10:02:00' },
        { comment_id: '4', pid: '1', user_name: 'D', addtime: '2025-01-01 10:03:00' },
      ],
    },
  }));
  await flush(container);

  assert.deepEqual(replyOrder(container), ['A', 'D', 'B', 'C'], '真实 DOM 顺序也必须是父先子后');
  // DOM 顺序变了，层级标注不能跟着错乱：D 在 A 之下占第二格
  const depthInDom = () => Array.from(container.children)
    .filter((child) => child.classList.contains('comment-floor-reply'))
    .map((child) => child.querySelector('.comment-floor-reply-name').textContent + ':' + child.getAttribute('data-echo-tree-depth'));
  assert.deepEqual(depthInDom(), ['A:0', 'D:1', 'B:0', 'C:0']);
  mod.deactivate();
  assert.deepEqual(replyOrder(container), ['A', 'B', 'C', 'D'], '停用后还原宿主的原始次序');
});

/**
 * 带主评论的楼层：.comment-item > (.comment-avatar, .comment-main > .comment-floor-inline)。
 * 主评论本身不是 .comment-floor-reply，容器里只有它的一级回复。
 */
const buildFloorWithRoot = () => {
  const item = new El('div');
  item.className = 'comment-item';
  const avatar = new El('div');
  avatar.className = 'comment-avatar';
  item.appendChild(avatar);
  const main = new El('div');
  main.className = 'comment-main';
  item.appendChild(main);
  const container = new El('div');
  container.className = 'comment-floor-inline';
  main.appendChild(container);

  const replies = [
    makeReply('A', '2025-01-01 10:00:00'),
    makeReply('B', '2025-01-01 10:01:00'),
    makeReply('C', '2025-01-01 10:02:00'),
    makeReply('D', '2025-01-01 10:03:00'),
    makeReply('E', '2025-01-01 10:04:00'),
  ];
  for (const reply of replies) container.appendChild(reply);
  return { container, replies };
};

/** A（BC）DE：根评论下 A、D、E 是一级回复，B、C 挂在 A 下 */
const rootSiblingBody = () => ({
  status: 1,
  list: [
    { comment_id: '1', pid: '0', user_name: 'A', addtime: '2025-01-01 10:00:00' },
    { comment_id: '2', pid: '1', user_name: 'B', addtime: '2025-01-01 10:01:00' },
    { comment_id: '3', pid: '1', user_name: 'C', addtime: '2025-01-01 10:02:00' },
    { comment_id: '4', pid: '0', user_name: 'D', addtime: '2025-01-01 10:03:00' },
    { comment_id: '5', pid: '0', user_name: 'E', addtime: '2025-01-01 10:04:00' },
  ],
});

test('一级回复之间由主评论的根分支串起来', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloorWithRoot();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({
    status: 200,
    body: rootSiblingBody(),
  }));
  await flush(container);

  assert.deepEqual(replies.map((reply) => reply.getAttribute('data-echo-tree-depth')), [
    '0', '1', '1', '0', '0',
  ], 'A、D、E 是一级回复，B、C 在 A 下');

  const rootLine = container.querySelector('.echo-tree-root-line');
  assert.ok(rootLine, '一级回复之间要有从主评论接下来的线');
  const path = rootLine.getAttribute('d');
  // 主干从头像正下方出发，往每一条一级回复各画一段
  assert.match(path, /^M -27 -60 V /);
  assert.equal(path.split(' H ').length - 1, 3, 'A、D、E 各一段水平分支');
  // 根线只是线，不带折叠节点：折叠按钮仍然只有 A 一个
  assert.deepEqual(branchKeys(container), [keyOf('A', '2025-01-01 10:00:00')]);
});

test('主评论结构不明时不画根分支，也不影响子树', async () => {
  reset();
  await mod.activate(makeCtx());
  // buildFloor 的容器没有 .comment-item 祖先，量不到主评论头像
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(container.querySelector('.echo-tree-root-line'), null);
  assert.equal(container.querySelectorAll('.echo-tree-branch').length, 2, '子树照旧');
});

test('无法对齐的回复保持根级平铺，不误挂', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  // 只有丙的关系，其余三条无接口数据
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({
    status: 200,
    body: { status: 1, list: [{ comment_id: '13', pid: '12', user_name: '丙', addtime: '2025-01-01 10:02:00' }] },
  }));
  observers[0].handler(container);
  assert.deepEqual(replies.map((reply) => reply.getAttribute('data-echo-tree-depth')), ['0', '0', '0', '0']);
  assert.equal(container.querySelector('.echo-tree-branch'), null, '没有父子关系就不该有折叠节点');
});

test('设置项持久化后重开按新配置生效，indentOnly 不注入按钮', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, mode: 'indentOnly', container: true, containerHeight: 600 });
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  observers[0].handler(container);

  assert.equal(container.getAttribute('data-echo-mode'), 'indentOnly');
  assert.equal(container.getAttribute('data-echo-container'), 'on');
  assert.equal(container.style.getPropertyValue('--echo-tree-container-height'), '600px');
  assert.equal(container.querySelector('.echo-tree-guides'), null, 'indentOnly 不画引导线');
  assert.deepEqual(replies.map((reply) => reply.getAttribute('data-echo-tree-depth')), ['0', '1', '2', '1']);
});

test('总开关关闭时不加任何标记', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: false });
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  observers[0].handler(container);
  assert.equal(container.getAttribute('data-echo-thread'), null);
  assert.equal(replies[0].getAttribute('data-echo-tree'), null);
});

test('deactivate 清除全部属性、按钮与自定义属性', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  observers[0].handler(container);
  assert.ok(container.querySelector('.echo-tree-guides'));

  mod.deactivate();

  assert.equal(container.getAttribute('data-echo-thread'), null);
  assert.equal(container.getAttribute('data-echo-mode'), null);
  assert.equal(container.style.getPropertyValue('--echo-tree-step'), '');
  for (const reply of replies) {
    assert.equal(reply.getAttribute('data-echo-tree'), null);
    assert.equal(reply.getAttribute('data-echo-tree-depth'), null);
    assert.equal(reply.getAttribute('data-echo-tree-collapsed'), null);
    assert.equal(reply.getAttribute('data-echo-tree-hidden'), null);
    assert.equal(reply.style.getPropertyValue('--echo-tree-depth'), '');
  }
  assert.equal(container.querySelector('.echo-tree-guides'), null, '停用后引导线图层整层移除');
});
// ---------- P1：加载更多后折叠保持 / 分页 / 缓存保护 ----------

/** 追加一批回复到容器末尾，模拟宿主「加载更多」追加节点。 */
const appendReplies = (container, list) => {
  const added = list.map(([name, time]) => makeReply(name, time));
  for (const reply of added) container.appendChild(reply);
  return added;
};

const flush = async (container) => {
  await tick();
  observers[0].handler(container);
  await tick();
};

test('加载更多写入新节点后，已折叠的分支仍然保持折叠', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  container.dispatch('click', { target: branchOf(container, '乙', '2025-01-01 10:01:00'), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(replies[2].getAttribute('data-echo-tree-hidden'), 'on');

  const moreBody = {
    status: 1,
    list: [
      ...floorBody().list,
      { comment_id: '15', pid: '12', user_name: '戊', addtime: '2025-01-01 10:04:00' },
    ],
  };
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: moreBody }));
  const added = appendReplies(container, [['戊', '2025-01-01 10:04:00']]);
  await flush(container);

  assert.equal(replies[1].getAttribute('data-echo-tree-collapsed'), 'on', '折叠状态按 name\0time 键保留');
  assert.equal(replies[2].getAttribute('data-echo-tree-hidden'), 'on', '旧子孙仍然隐藏');
  assert.equal(added[0].getAttribute('data-echo-tree-hidden'), 'on', '新来的子孙也隐藏');
  assert.equal(added[0].getAttribute('data-echo-tree-depth'), '2');
});

test('后到的回复按关系算深度，不按 DOM 顺序', async () => {
  reset();
  await mod.activate(makeCtx());
  const container = new El('div');
  container.className = 'comment-floor-inline';
  const replies = [makeReply('甲', '2025-01-01 10:00:00'), makeReply('乙', '2025-01-01 10:01:00')];
  for (const reply of replies) container.appendChild(reply);
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.deepEqual(replies.map((r) => r.getAttribute('data-echo-tree-depth')), ['0', '1']);

  const added = appendReplies(container, [['丙', '2025-01-01 10:02:00']]);
  await flush(container);
  assert.equal(added[0].getAttribute('data-echo-tree-depth'), '2');
});

test('分页：每页按根回复切分，子回复跟随所属根', () => {
  const tree = mod.buildThreadTree([
    { id: 'a', pid: '', time: 1 },
    { id: 'a1', pid: 'a', time: 2 },
    { id: 'b', pid: '', time: 3 },
    { id: 'b1', pid: 'b', time: 4 },
    { id: 'c', pid: '', time: 5 },
  ]);
  const paged = mod.paginateTree(tree, 2);
  assert.equal(paged.pageCount, 2);
  assert.deepEqual(
    paged.pages.map((entry) => [entry.id, entry.page]),
    [['a', 0], ['a1', 0], ['b', 0], ['b1', 0], ['c', 1]],
  );
});

/** 构造 n 个互不相关的根回复（pid 指向集合外的 10）。 */
const buildManyRoots = (n) => {
  const container = new El('div');
  container.className = 'comment-floor-inline';
  const replies = [];
  for (let i = 0; i < n; i += 1) {
    const stamp = '2025-01-01 10:' + String(i).padStart(2, '0') + ':00';
    const reply = makeReply('根' + i, stamp);
    replies.push(reply);
    container.appendChild(reply);
  }
  return { container, replies };
};

const manyRootsBody = (n) => ({
  status: 1,
  list: Array.from({ length: n }, (_, i) => ({
    comment_id: String(1000 + i),
    pid: '10',
    user_name: '根' + i,
    addtime: '2025-01-01 10:' + String(i).padStart(2, '0') + ':00',
  })),
});

test('分页只显示当前页的根，翻页切页', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, paginate: true });
  await mod.activate(makeCtx());
  const { container, replies } = buildManyRoots(21);
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: manyRootsBody(21) }));
  await flush(container);

  const pager = container.querySelector('.echo-tree-pager');
  assert.ok(pager, '21 个根 → 每页 20 个根 → 2 页');
  assert.equal(pager.querySelector('.echo-tree-pager-info').textContent, '第 1 / 2 页');
  assert.equal(replies[0].getAttribute('data-echo-tree-hidden'), null);
  assert.equal(replies[19].getAttribute('data-echo-tree-hidden'), null);
  assert.equal(replies[20].getAttribute('data-echo-tree-hidden'), 'on', '第 21 个根属于第 2 页');

  const next = pager.querySelector('.echo-tree-pager-next');
  container.dispatch('click', { target: next, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(container.querySelector('.echo-tree-pager-info').textContent, '第 2 / 2 页');
  assert.equal(replies[0].getAttribute('data-echo-tree-hidden'), 'on');
  assert.equal(replies[20].getAttribute('data-echo-tree-hidden'), null);

  const prev = container.querySelector('.echo-tree-pager-prev');
  container.dispatch('click', { target: prev, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(container.querySelector('.echo-tree-pager-info').textContent, '第 1 / 2 页');
  assert.equal(replies[0].getAttribute('data-echo-tree-hidden'), null);
  assert.equal(replies[20].getAttribute('data-echo-tree-hidden'), 'on');
});

test('末页的下一页转发给宿主的加载更多按钮', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, paginate: true });
  await mod.activate(makeCtx());
  const { container } = buildManyRoots(21);
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: manyRootsBody(21) }));
  await flush(container);

  // 宿主在楼层末尾渲染「加载更多回复」
  const moreWrap = new El('div');
  moreWrap.className = 'comment-floor-more';
  const moreBtn = new El('button');
  moreBtn.className = 'comment-floor-more-btn';
  moreWrap.appendChild(moreBtn);
  container.appendChild(moreWrap);
  await flush(container);

  let clicked = 0;
  moreBtn.addEventListener('click', () => { clicked += 1; });

  const order = container.children.map((child) => child.className);
  assert.ok(order.indexOf('echo-tree-pager') < order.indexOf('comment-floor-more'), '分页条排在加载更多之前');

  const next = () => container.querySelector('.echo-tree-pager-next');
  container.dispatch('click', { target: next(), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(container.querySelector('.echo-tree-pager-info').textContent, '第 2 / 2 页');
  assert.equal(next().textContent, '加载更多', '末页且宿主还有更多时按钮改文案');

  container.dispatch('click', { target: next(), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(clicked, 1, '末页翻页转成宿主加载更多');
});

test('关闭分页后分页条消失、全部根可见', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, paginate: false });
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(container.querySelector('.echo-tree-pager'), null);
  assert.equal(replies[0].getAttribute('data-echo-tree-hidden'), null);
});

test('隐藏引用默认开启，关掉开关后容器标记撤除', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, hideQuote: false });
  await mod.activate(makeCtx());
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(container.getAttribute('data-echo-quote-off'), null, '关掉开关就不写标记');
});

test('停用插件时撤掉引用标记，宿主原有引用块复原', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(container.getAttribute('data-echo-quote-off'), 'on');
  // 插件只写标记，不改 quote 节点：节点仍在，由 CSS 决定是否显示
  assert.ok(replies[0].querySelector('.comment-floor-quote'), '引用节点由宿主保留');

  mod.deactivate();
  assert.equal(container.getAttribute('data-echo-quote-off'), null);
});

// ---------- P2：新加载回复的红点与分界线 ----------

/** 追加一批回复 + 对应关系，模拟宿主「加载更多」 */
const loadMore = async (container, extra, replies) => {
  const body = { status: 1, list: [...floorBody().list, ...extra.body] };
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body }));
  const added = appendReplies(container, extra.replies);
  await flush(container);
  return added;
};

/** 新来的一条一级回复 + 一条挂在乙下面的二级回复 */
const moreBatch = {
  // 庚 pid=10：与甲同级，是这次新来的一级回复
  // 戊 pid=11：挂在乙下面，是这次新来的二级回复
  body: [
    { comment_id: '15', pid: '10', user_name: '庚', addtime: '2025-01-01 10:04:00' },
    { comment_id: '16', pid: '11', user_name: '戊', addtime: '2025-01-01 10:05:00' },
  ],
  replies: [['庚', '2025-01-01 10:04:00'], ['戊', '2025-01-01 10:05:00']],
};

test('新加载的二级回复打红点，一级回复画分界线，旧回复两者都没有', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  // 首屏的回复只是既有内容，不该被标成新增
  for (const reply of replies) {
    assert.equal(reply.getAttribute('data-echo-tree-new'), null, '首屏不标红点');
    assert.equal(reply.getAttribute('data-echo-tree-new-root'), null, '首屏不画分界线');
  }
  const [geng, wu] = await loadMore(container, moreBatch, replies);

  // 戊挂在乙下面（depth 1）：红点，且不是一级回复，不画分界线
  assert.equal(wu.getAttribute('data-echo-tree-depth'), '1');
  assert.equal(wu.getAttribute('data-echo-tree-new'), 'on', '新来的子回复打红点');
  assert.equal(wu.getAttribute('data-echo-tree-new-root'), null, '子回复不画分界线');

  // 庚是这次新来的一级回复（depth 0）：画分界线，不点红点
  assert.equal(geng.getAttribute('data-echo-tree-depth'), '0');
  assert.equal(geng.getAttribute('data-echo-tree-new-root'), 'on', '新来的一级回复画分界线');
  assert.equal(geng.getAttribute('data-echo-tree-new'), null, '一级回复只画线，不点红点');

  // 旧回复一个都不能被误标
  for (const reply of replies) {
    assert.equal(reply.getAttribute('data-echo-tree-new'), null);
    assert.equal(reply.getAttribute('data-echo-tree-new-root'), null);
  }
});

test('重算不会让红点自己消失，只有下一次加载才换批', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  const [geng, wu] = await loadMore(container, moreBatch, replies);

  // 宿主的任意一次 patch（改文案、折叠、翻页）都会触发重算，红点必须留存
  await flush(container);
  assert.equal(wu.getAttribute('data-echo-tree-new'), 'on', '重算后红点仍在');
  assert.equal(geng.getAttribute('data-echo-tree-new-root'), 'on', '重算后分界线仍在');

  // 折叠再展开也算重算
  container.dispatch('click', { target: branchOf(container, '乙', '2025-01-01 10:01:00'), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(wu.getAttribute('data-echo-tree-new'), 'on');
  container.dispatch('click', { target: branchOf(container, '乙', '2025-01-01 10:01:00'), preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(wu.getAttribute('data-echo-tree-new'), 'on');
});

test('两个提醒各自可关，关掉后连属性都不写', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, markNew: false, markDivider: false });
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const [geng, wu] = await loadMore(container, moreBatch, replies);
  assert.equal(wu.getAttribute('data-echo-tree-new'), null, '关掉红点后不写属性');
  assert.equal(geng.getAttribute('data-echo-tree-new-root'), null, '关掉分界线后不写属性');
});

test('只关一个开关时另一个照常工作', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, markNew: false, markDivider: true });
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  const [geng, wu] = await loadMore(container, moreBatch, replies);
  assert.equal(wu.getAttribute('data-echo-tree-new'), null, '红点已关');
  assert.equal(geng.getAttribute('data-echo-tree-new-root'), 'on', '分界线仍然画');

  reset();
  store.set('threaded-comments:settings', { enabled: true, markNew: true, markDivider: false });
  await mod.activate(makeCtx());
  const floor2 = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(floor2.container);
  const [, wu2] = await loadMore(floor2.container, moreBatch, floor2.replies);
  assert.equal(wu2.getAttribute('data-echo-tree-new'), 'on', '红点仍然打');
});

test('分界线只画在新旧交界的第一条一级回复上', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  // 这一次来了两条新的一级回复
  const added = await loadMore(
    container,
    {
      body: [
        { comment_id: '15', pid: '10', user_name: '庚', addtime: '2025-01-01 10:04:00' },
        { comment_id: '16', pid: '10', user_name: '辛', addtime: '2025-01-01 10:05:00' },
      ],
      replies: [['庚', '2025-01-01 10:04:00'], ['辛', '2025-01-01 10:05:00']],
    },
    replies,
  );

  const roots = added.filter((reply) => reply.getAttribute('data-echo-tree-depth') === '0');
  assert.equal(roots.length, 2);
  assert.equal(roots[0].getAttribute('data-echo-tree-new-root'), 'on', '第一条新的画线');
  assert.equal(roots[1].getAttribute('data-echo-tree-new-root'), null, '第二条不重复画');
});

test('停用插件时清掉红点与分界线的全部标记', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  const [geng, wu] = await loadMore(container, moreBatch, replies);
  assert.equal(wu.getAttribute('data-echo-tree-new'), 'on');

  mod.deactivate();
  assert.equal(container.getAttribute('data-echo-mark-new'), null);
  assert.equal(container.getAttribute('data-echo-mark-divider'), null);
  assert.equal(wu.getAttribute('data-echo-tree-new'), null);
  assert.equal(geng.getAttribute('data-echo-tree-new-root'), null);
  // 红点坐标是量出来写在回复上的，标记撤掉时必须一起撤
  assert.equal(wu.style.getPropertyValue('--echo-tree-dot-x'), '');
  assert.equal(wu.style.getPropertyValue('--echo-tree-dot-y'), '');
  assert.equal(container.style.getPropertyValue('--echo-tree-divider-width'), '');
});

test('红点落在名字行有效内容的最右侧，而不是整条回复的右边缘', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  // 给乙（甲的子回复）加一个 VIP 徽章：红点必须让到徽章之后，而不是昵称之后
  const yi = replies[1];
  const badge = new El('span');
  badge.className = 'comment-badge comment-badge-floor';
  yi.querySelector('.comment-floor-reply-header').appendChild(badge);

  const [geng, wu] = await loadMore(container, moreBatch, replies);
  assert.equal(wu.getAttribute('data-echo-tree-depth'), '1', '戊挂在乙下面');

  const header = wu.querySelector('.comment-floor-reply-header');
  const rowRight = Math.max(
    ...header.children.map((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 ? box.right : 0;
    }),
  );
  const replyBox = wu.getBoundingClientRect();
  const dotX = Number.parseFloat(wu.style.getPropertyValue('--echo-tree-dot-x'));

  // 间隙取宿主头行自己的 gap（CommentList.vue:1081 是 8px），
  // 这样红点与徽章之间的距离和「名字与徽章」之间的一致
  const gap = Number.parseFloat(
    globalThis.getComputedStyle(header, null).getPropertyValue('column-gap'),
  ) || 8;
  assert.equal(dotX, Math.round((rowRight - replyBox.left + gap) * 100) / 100, '红点应紧跟这一行最右侧的内容');
  assert.equal(gap, 8, '桩里的头行间距应与宿主一致，否则这条断言失去意义');
  assert.ok(dotX > 0, '红点坐标应为正数');
  assert.ok(
    Number.parseFloat(wu.style.getPropertyValue('--echo-tree-dot-y')) >= 0,
    '红点纵坐标应落在名字行上',
  );

  // 一级回复由分界线表达，不该有红点坐标
  assert.equal(geng.style.getPropertyValue('--echo-tree-dot-x'), '', '一级回复不点红点');
  for (const reply of replies) {
    assert.equal(reply.style.getPropertyValue('--echo-tree-dot-x'), '', '旧回复不点红点');
  }
});

test('红点与内容的间隙跟随宿主头行的 gap，而不是写死的数值', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const [, wu] = await loadMore(container, moreBatch, replies);
  const header = wu.querySelector('.comment-floor-reply-header');
  const readDot = () => Number.parseFloat(wu.style.getPropertyValue('--echo-tree-dot-x'));
  const rowRight = Math.max(...header.children.map((node) => node.getBoundingClientRect().right));
  const left = wu.getBoundingClientRect().left;

  const before = readDot();
  assert.equal(before, Math.round((rowRight - left + 8) * 100) / 100, '默认取宿主的 8px');

  // 宿主把间距调大（或换主题改了 gap），红点必须跟着退开，不能还贴 8px
  header.__computed = { 'column-gap': '14px' };
  await flush(container);
  assert.equal(readDot(), Math.round((rowRight - left + 14) * 100) / 100, 'gap 变了红点跟着走');
});

test('名字行多出一个徽章后，红点跟着右移', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const [, wu] = await loadMore(container, moreBatch, replies);
  const before = Number.parseFloat(wu.style.getPropertyValue('--echo-tree-dot-x'));
  assert.ok(before > 0, '先要有坐标');

  // 宿主的徽章是异步补上的（VIP、勋章），宽进来之后红点必须重算
  const badge = new El('span');
  badge.className = 'comment-badge comment-badge-floor';
  wu.querySelector('.comment-floor-reply-header').appendChild(badge);
  await flush(container);

  const after = Number.parseFloat(wu.style.getPropertyValue('--echo-tree-dot-x'));
  assert.ok(after > before, '徽章进来后红点应右移：' + before + ' -> ' + after);
});

test('分界线粗细写进容器变量，关掉开关后撤除', async () => {
  reset();
  store.set('threaded-comments:settings', { enabled: true, markDivider: true, dividerWidth: 5 });
  await mod.activate(makeCtx());
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(container.style.getPropertyValue('--echo-tree-divider-width'), '5px');

  store.set('threaded-comments:settings', { enabled: true, markDivider: false, dividerWidth: 5 });
  mod.deactivate();
  await mod.activate(makeCtx());
  await flush(container);
  assert.equal(container.style.getPropertyValue('--echo-tree-divider-width'), '', '关掉分界线就不写线宽');
});

// ---------- P3：调试出口 window.__echoTree ----------

test('activate 挂上调试出口，deactivate 摘掉', async () => {
  reset();
  await mod.activate(makeCtx());
  assert.ok(globalThis.__echoTree, 'activate 后应有 __echoTree');
  for (const name of ['containers', 'rows', 'tree', 'recompute', 'settings', 'guides', 'css', 'help']) {
    assert.equal(typeof globalThis.__echoTree[name], 'function', '缺少方法：' + name);
  }
  mod.deactivate();
  assert.equal(globalThis.__echoTree, undefined, '停用后不应留下全局');
});

test('调试出口看得到楼层、回复顺序与标记', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const list = globalThis.__echoTree.containers();
  assert.equal(list.length, 1);
  assert.equal(list[0].element, container);
  assert.equal(list[0].replies, 4);

  const rows = globalThis.__echoTree.rows(container);
  assert.deepEqual(rows.map((row) => row.depth), [0, 1, 2, 1]);
  assert.equal(rows[0].key, keyOf('甲', '2025-01-01 10:00:00'));

  const tree = globalThis.__echoTree.tree(container);
  assert.deepEqual(tree.map((node) => node.id), rows.map((row) => row.key));
});

test('调试出口的 recompute 会立刻重算', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.equal(globalThis.__echoTree.recompute(container), 1);
  assert.equal(globalThis.__echoTree.recompute(), 1, '不传目标则重算全部');
});

test('调试出口返回副本，改它不影响插件内部状态', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const settings = globalThis.__echoTree.settings();
  settings.mode = 'indentOnly';
  assert.equal(globalThis.__echoTree.settings().mode, 'lineKeepMain', '改副本不该影响实际设置');

  const tree = globalThis.__echoTree.tree(container);
  if (tree.length) tree[0].depth = 99;
  assert.equal(globalThis.__echoTree.tree(container)[0].depth, 0, '改副本不该影响树');
});

test('调试出口能给出引导线的绘制快照', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  const guides = globalThis.__echoTree.guides(container);
  assert.ok(guides, '应返回绘制快照');
  assert.ok(guides.viewBox, '图层应带 viewBox');
  assert.ok(guides.box.width.endsWith('px'), '内联宽度应是像素值');
  assert.equal(guides.branches.length, 2, '甲与乙各有子回复');
  assert.ok(guides.branches[0].path.startsWith('M '), '分支应带路径');
  assert.equal(guides.anchors.length, 4, '每条回复都要量到锚点');
  assert.ok(guides.anchors[0].avatar, '锚点里应含头像矩形');
});

test('调试出口能给出关键计算样式', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);

  // 桩里没有真实排版，这里只验证取的是「插件写进去的那几个变量」
  replies[0].style.setProperty('--echo-tree-depth', '0');
  const css = globalThis.__echoTree.css(container);
  assert.ok(css, '应返回样式快照');
  assert.equal(css.container['--echo-tree-step'], '32px', '容器上应读到缩进步长');
  assert.equal(css.reply['--echo-tree-depth'], '0', '回复上应读到层级变量');
});

test('缓存淘汰不会挤掉正在展示的楼层锚点', async () => {
  reset();
  await mod.activate(makeCtx());
  const { container, replies } = buildFloor();
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: floorBody() }));
  await flush(container);
  assert.deepEqual(replies.map((r) => r.getAttribute('data-echo-tree-depth')), ['0', '1', '2', '1']);

const flood = { status: 1, list: [] };
  for (let i = 0; i < 5200; i += 1) {
    flood.list.push({
      comment_id: String(900000 + i),
      pid: String(900000 + i - 1),
      user_name: '路人' + i,
      addtime: '2025-02-02 10:00:00',
    });
  }
  await interceptors[0].handler({ method: 'GET', url: '/comment/floor' }, async () => ({ status: 200, body: flood }));

  await flush(container);
  assert.deepEqual(replies.map((r) => r.getAttribute('data-echo-tree-depth')), ['0', '1', '2', '1']);
});
