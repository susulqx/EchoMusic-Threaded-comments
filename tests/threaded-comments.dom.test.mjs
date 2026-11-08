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
    top += ROW_HEIGHT;
  }
  rects.set(container, rect(0, 0, 800, top));
};

const measureRect = (el) => {
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
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  }
  insertBefore(child, ref) {
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
  assert.equal(container.style.getPropertyValue('--echo-tree-step'), '32px');

  const depths = replies.map((reply) => reply.getAttribute('data-echo-tree-depth'));
  assert.deepEqual(depths, ['0', '1', '2', '1']);
  // 折叠入口是 SVG 分支组：甲、乙各有子回复，丙没有
  assert.deepEqual(branchKeys(container), [keyOf('甲', '2025-01-01 10:00:00'), keyOf('乙', '2025-01-01 10:01:00')]);
  assert.equal(container.querySelectorAll('.echo-tree-branch').length, 2);
});

/** 分支组的 data-echo-tree-key 即「昵称\0时间」 */
const keyOf = (name, time) => name + '\u0000' + time;

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
