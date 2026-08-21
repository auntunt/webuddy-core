/**
 * 把真实的 web/app.js 加载进来，让它的渲染函数可以直接调（§14.5）。
 *
 * 关键是"真实的"：验证必须打在会发货的那份代码上。
 * 照着渲染逻辑重写一份来测，测过了也说明不了什么——页面里那份没被碰过。
 * 所以这里不抄任何逻辑，只提供它跑起来需要的环境。
 *
 * app.js 是普通脚本（index.html 里 <script src>），没有 export。
 * 好处是在 vm 里跑完，所有 function 声明就直接挂在那个 context 的全局上，
 * 拿来就能调，一行都不用改 app.js。
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node } from './dom-shim.mjs';

// 用 fileURLToPath，别用 url.pathname——项目路径里可能有中文，
// pathname 是百分号转义的，直接拿去 readFileSync 会 ENOENT。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'web', 'app.js');

export function loadApp() {
  const code = fs.readFileSync(APP, 'utf8');

  /** 选择器 → 节点。同一个选择器必须拿到同一个节点，见下面 querySelector 的注释。 */
  const mounts = new Map();

  const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (t) => { const n = new Node('#text'); n.textContent = t; return n; },
    // 文件末尾那段 bootstrap 用 getElementById 挂按钮。
    // 一律返回 null，那几个 if 就都短路了，比造一堆假按钮干净。
    getElementById: () => null,
    // $() 到处在用。按选择器缓存同一个节点——
    // 每次给新的会让 drawAsk3 这种"往 #a-where 里写字"的函数写完就丢，
    // 检查读回来永远是空的，看着像文案没渲染出来，其实是这个 shim 的问题。
    querySelector: (sel) => {
      if (!mounts.has(sel)) mounts.set(sel, new Node('div'));
      return mounts.get(sel);
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new Node('body'),
  };

  const ctx = {
    document,
    console,
    JSON,
    Math,
    Date,
    Set,
    Map,
    RegExp,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    // api() 里有 `opt.body instanceof FormData`。vm 的新领域里没有这个类，
    // 少给一个就是 ReferenceError，而且报在 api() 里，看着像网络问题。
    FormData: class {
      constructor() { this._parts = []; }
      append(k, v) { this._parts.push([k, v]); }
    },
    // 末尾那个 bootstrap 一上来就 boot() → await api('/api/meta')。
    // 给个永远不 resolve 的 promise，它就停在那儿：不发请求，不刷看板，
    // 也不会留下 unhandled rejection。加载这个文件应该毫无副作用。
    fetch: () => new Promise(() => {}),
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { pathname: '/', search: '', href: 'http://127.0.0.1/' },
    alert: () => {},
    confirm: () => true,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.addEventListener = () => {};
  ctx.window.dispatchEvent = () => true;

  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'web/app.js' });
  // 有些函数不返回节点，直接往 $('#xxx') 里写（drawAsk3 就是）。
  // 把挂载点交出去，检查才读得到它们写了什么。
  ctx.__mount = (sel) => mounts.get(sel) || null;
  return ctx;
}
