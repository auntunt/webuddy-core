/**
 * 够用就好的 DOM（从 ref/webuddy-console/check/dom-shim.mjs 移植，§14.5）。
 *
 * 为什么要它：web/app.js 里那些渲染函数是这个项目最容易出错的地方——
 * 判断条件写反了不会报错，只会让某一行少显示一个词。而验证它原来只有一条路：
 * 开浏览器截图然后自己眯眼看。那套东西启动要几秒、会锁住浏览器的用户目录，
 * 最后还是靠肉眼；而且它是外部依赖，本仓库零依赖（铁律）装不了。
 *
 * 真正要验的是"这一行会显示哪几个字"，那是文本问题，不是像素问题。
 * 所以这里造一份最小的 DOM，让真实的 app.js 跑在上面，把渲染结果读成文本。
 *
 * 刻意不实现的：布局、样式、事件派发、选择器查询。
 * 那些确实得用真浏览器；但它们不是这些函数在做的事。
 *
 * 只覆盖 app.js 真的用到的那几样：createElement / className / textContent /
 * appendChild / insertBefore / classList / dataset / disabled / title / hidden /
 * replaceChildren / onclick。用到别的会直接抛错，那是好事——
 * 悄悄返回 undefined 才会让验证假过。
 */

class ClassList {
  constructor(node) { this.node = node; }

  add(...cs) { for (const c of cs) this.node._cls.add(c); }

  remove(...cs) { for (const c of cs) this.node._cls.delete(c); }

  contains(c) { return this.node._cls.has(c); }

  toggle(c, on) {
    const want = on === undefined ? !this.node._cls.has(c) : Boolean(on);
    if (want) this.node._cls.add(c); else this.node._cls.delete(c);
    return want;
  }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this._text = '';
    this.dataset = {};
    this.classList = new ClassList(this);
    this.disabled = false;
    this.hidden = false;
    this.title = '';
    this.onclick = null;
    this.onchange = null;
    this._events = [];
    // 收下就行，不参与判断。文案检查不看样式；
    // 但少了这个，gateRow 那种 dot.style.marginTop = '7px' 会直接抛。
    this.style = {};
  }

  get className() { return [...this._cls].join(' '); }

  set className(v) {
    this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }

  /**
   * 先 textContent 写了字、再 appendChild 塞子节点时，把那段字固化成一个文本子节点。
   *
   * 真 DOM 里 textContent = 'x' 建的是一个文本节点，再 append 一个 span 就是两个孩子，
   * 读回来两段都在。ref 那份垫片没做这一步（它的 app.js 没有这种写法），
   * 照抄过来会让 humanCard 里 `label` 的问题原文被后加的 hint 顶掉——
   * 界面上问题明明显示着，检查却说没渲染出来。
   */
  _solidify() {
    if (this._text === '' || this.children.length) return;
    const t = new Node('#text');
    t._text = this._text;
    t.parentNode = this;
    this.children.push(t);
    this._text = '';
  }

  appendChild(n) {
    if (!n) throw new Error('appendChild(null)：渲染函数往里塞了个空节点');
    this._solidify();
    n.parentNode = this;
    this.children.push(n);
    return n;
  }

  insertBefore(n, ref) {
    this._solidify();
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }

  replaceChildren(...ns) {
    this.children = [];
    // 自带的那段字也要清掉。留着的话下面 appendChild 会把它固化成子节点又冒出来，
    // 而真 DOM 里 replaceChildren 是连文本一起换掉的。
    this._text = '';
    for (const n of ns) this.appendChild(n);
  }

  get firstChild() { return this.children[0] || null; }

  // 记下绑了什么，但不派发。真要验点击行为得用浏览器，那不是这套东西的活；
  // 记名字是为了 §14.5 判据 3——数"事件绑定层级"，得知道哪个节点上挂了东西。
  addEventListener(type) { this._events.push(String(type)); }

  removeEventListener(type) {
    const i = this._events.indexOf(String(type));
    if (i >= 0) this._events.splice(i, 1);
  }

  /** 这个节点上有没有挂交互（含 on* 属性和 addEventListener）。 */
  get isInteractive() {
    return this._events.length > 0
      || typeof this.onclick === 'function'
      || typeof this.onchange === 'function';
  }

  // 光标落在哪儿是真浏览器的事，这里只要"调了不崩"。
  // 缺这个的表现是渲染函数整个抛错，看着像界面坏了，其实是шим少一个方法。
  focus() {}

  blur() {}

  scrollIntoView() {}

  /** 这一段渲染出来的字。空白折叠掉——要比的是内容，不是缩进。 */
  text() { return this.textContent.replace(/\s+/g, ' ').trim(); }

  /** 带 class 的树状文本，用来看结构：哪个节点上挂了 slock / ssoft。 */
  dump(depth = 0) {
    const pad = '  '.repeat(depth);
    const cls = this.className ? `.${this.className.split(' ').join('.')}` : '';
    const own = this.children.length ? '' : this._text.replace(/\s+/g, ' ').trim();
    const flags = [this.disabled ? 'disabled' : '', this.hidden ? 'hidden' : '']
      .filter(Boolean).join(' ');
    const head = `${pad}${this.tagName.toLowerCase()}${cls}${flags ? ` [${flags}]` : ''}`;
    const lines = [own ? `${head} "${own}"` : head];
    for (const c of this.children) lines.push(c.dump(depth + 1));
    return lines.join('\n');
  }
}

export { Node, ClassList };
