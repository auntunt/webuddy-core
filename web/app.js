/**
 * 看板前端。普通脚本，不是模块——渲染函数要能在 node 里被 check/load-app.mjs
 * 拿 vm 加载后直接调（§14.5 的渲染检查靠这个）。所以：不写 import/export，
 * 函数都声明在顶层。
 *
 * 三条纪律，改这个文件时都得守住：
 * 1. 静态文案直接写大白话，不写术语再翻译；动态文案（从接口来的 say/how/lead）
 *    过 g()，因为那些字是包作者写的，包里可能还留着行业术语。
 * 2. 日期一律相对时间。绝对时间戳对"这事拖了多久"没有帮助，还占一行。
 * 3. 每个可空区域都要有空状态文案。空白区域会让人以为界面坏了。
 */

/* ---------- 一点点工具 ---------- */

function $(sel) { return document.querySelector(sel); }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/**
 * 术语替换。整词、长词优先，跟内核 applyGlossary 同一套规则。
 *
 * 为什么前端也要有一份：接口回来的 say/how/lead 是包作者写的原话，
 * 内核那边只在人读的 CLI 输出上替换，HTTP 一路永不替换（要给 CI diff）。
 * 看板正是人读的那一路，所以替换发生在这里。
 */
let GLOSSARY = {};

function g(text) {
  const s = text == null ? '' : String(text);
  const pairs = Object.entries(GLOSSARY)
    .filter(([k, v]) => k && typeof v === 'string')
    .sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length || !s) return s;
  let out = '';
  let i = 0;
  outer: while (i < s.length) {
    for (let p = 0; p < pairs.length; p += 1) {
      if (s.startsWith(pairs[p][0], i)) {
        out += pairs[p][1];
        i += pairs[p][0].length;
        continue outer;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** 相对时间。字节数、hash、绝对时间都不进正文（§14.4）。 */
function ago(iso) {
  if (!iso) return '刚刚';
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 0)) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return Math.floor(d / 30) + ' 个月前';
}

/** 路径渲染成「项目里的 xxx」，不露分隔符细节（§14.4） */
function filePhrase(p) {
  const s = String(p || '').replace(/^\.?\//, '');
  return '项目里的 ' + s;
}

/* ---------- 三问区（§14.2 第 1 区）---------- */

/**
 * 第一问：现在走到哪儿了。
 * stage 缺失也要出一句话——这一区永远存在，空着比说错更糟。
 */
function whereLine(stage) {
  if (!stage || !stage.current) return '现在走到：还没开始';
  const name = stage.name ? ' · ' + g(stage.name) : '';
  return '现在走到：第 ' + stage.current + ' 步' + name;
}

/**
 * 第二问：卡在哪儿。
 *
 * 优先级是定死的（§14.2）：顺序反了 > 第一条拦路的 > 第一条要你回答的 > 没卡点。
 * 这个顺序不能改成"按严重度排"——顺序反了这件事一旦发生，
 * 后面所有的红灯都是它的后果，先修后果等于白干。
 */
function stuckLine(v) {
  if (v.inversion && v.inversion.say) return '卡在：' + g(v.inversion.say);
  if (v.blockers && v.blockers.length) return '卡在：' + g(v.blockers[0].say);
  if (v.humanPending && v.humanPending.length) return '卡在：' + g(v.humanPending[0].lead);
  return '卡在：没有卡点';
}

/** 第三问：下一步干什么。跟第二问同一条线索，给的是动作。 */
function nextLine(v, stage) {
  if (v.inversion && v.inversion.currentStage) {
    return '下一步：回去把第 ' + v.inversion.currentStage + ' 步缺的东西补上';
  }
  if (v.blockers && v.blockers.length && v.blockers[0].how) {
    return '下一步：' + g(v.blockers[0].how);
  }
  const hp = (v.humanPending || [])[0];
  if (hp) {
    const ask = (hp.asks || [])[0];
    if (ask && ask.q) return '下一步：' + g(ask.q);
    return '下一步：在下面「要你回答」里点一下确认';
  }
  const cur = stage && stage.current ? stage.current : 1;
  const total = stage && stage.total ? stage.total : 0;
  if (total && cur >= total) return '下一步：都做完了，可以交活了';
  return '下一步：继续往下做第 ' + cur + ' 步';
}

/** 画三问区。三行都写，一行都不能空。 */
function drawAsk3(v, stage) {
  $('#a-where').textContent = whereLine(stage);
  $('#a-stuck').textContent = stuckLine(v);
  $('#a-next').textContent = nextLine(v, stage);
}

/* ---------- 红灯区（§14.2 第 2 区）---------- */

/** 一条拦路的事：说什么事 + 怎么办 + 去看哪个文件 */
function blockerCard(b) {
  const card = el('div', 'card block');
  card.appendChild(el('p', 'say', g(b.say)));
  card.appendChild(el('p', 'how', '怎么办：' + g(b.how || '找技术同事看一下')));
  if (b.evidence) {
    const p = el('p', 'file');
    p.appendChild(el('span', null, '去看这个文件：' + filePhrase(b.evidence)));
    card.appendChild(p);
  }
  return card;
}

function drawBlockers(v) {
  const box = $('#blockers');
  const kids = [];
  if (!v.blockers || v.blockers.length === 0) {
    kids.push(el('div', 'empty', '没有拦着你的事。'));
  } else {
    for (let i = 0; i < v.blockers.length; i += 1) kids.push(blockerCard(v.blockers[i]));
  }
  box.replaceChildren.apply(box, kids);
}

/* ---------- 要你回答区（§14.2 第 3 区）---------- */

/**
 * 一条要你回答的：领句 + 每问一个框 + 确认按钮（带选填备注）+ 需要文件时的拖拽框。
 *
 * 点击深度封顶两层（§2.5 铁律 3、§14.5 判据 3）：卡片是展开的，按钮直接挂在卡片上。
 * 不做「先点开详情再点确认再点确认对话框」那种三层结构。
 */
function humanCard(h, opts) {
  const o = opts || {};
  const card = el('div', 'card human');
  card.dataset.gateId = h.id;
  card.appendChild(el('p', 'say', g(h.lead || '这一条要你自己看一眼')));

  const asks = h.asks || [];
  const boxes = [];
  for (let i = 0; i < asks.length; i += 1) {
    const a = asks[i];
    const lab = el('label', null, g(a.q || ''));
    if (a.why) lab.appendChild(el('span', 'hint', '（' + g(a.why) + '）'));
    card.appendChild(lab);
    const ta = el('textarea');
    ta.dataset.key = a.key || String(i);
    card.appendChild(ta);
    boxes.push(ta);
  }

  const noteLab = el('label', null, '想补一句就写这儿（不写也行）');
  card.appendChild(noteLab);
  const note = el('input');
  note.type = 'text';
  note.dataset.role = 'note';
  card.appendChild(note);

  const btn = el('button', 'confirm', '我确认做了');
  btn.dataset.gateId = h.id;
  const msg = el('p', 'msg');
  btn.onclick = function () {
    const answers = {};
    for (let i = 0; i < boxes.length; i += 1) answers[boxes[i].dataset.key] = boxes[i].value || '';
    if (o.onConfirm) o.onConfirm(h.id, note.value || '', answers, msg);
  };
  card.appendChild(btn);
  // 出错的话话说在这张卡上。弹窗说完就没了，人回头找不到刚才那句是哪一条的。
  card.appendChild(msg);

  // 要交文件的那些条目，把上传框嵌在同一张卡里——
  // 单开一页会让"回答"和"交照片"变成两件事，人只会做第一件。
  if (h.needsEvidence) card.appendChild(dropBox(h.id, o));
  return card;
}

/** 拖拽上传框。也给一个文件选择框：拖拽在触屏上做不了。 */
function dropBox(gateId, opts) {
  const o = opts || {};
  const box = el('div', 'drop');
  box.dataset.gateId = gateId;
  box.appendChild(el('span', null, '把照片或文件拖到这里'));
  const inp = el('input');
  inp.type = 'file';
  inp.dataset.role = 'pick';
  inp.multiple = true;
  box.appendChild(inp);
  const msg = el('p', 'msg');
  box.appendChild(msg);

  inp.onchange = function () {
    if (o.onUpload) o.onUpload(gateId, inp.files, msg);
  };
  box.addEventListener('dragover', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    box.classList.add('over');
  });
  box.addEventListener('dragleave', function () { box.classList.remove('over'); });
  box.addEventListener('drop', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    box.classList.remove('over');
    const fl = e && e.dataTransfer ? e.dataTransfer.files : null;
    if (o.onUpload) o.onUpload(gateId, fl, msg);
  });
  return box;
}

function drawHumans(v, opts) {
  const box = $('#humans');
  const kids = [];
  if (!v.humanPending || v.humanPending.length === 0) {
    kids.push(el('div', 'empty', '现在没有要你回答的事。'));
  } else {
    for (let i = 0; i < v.humanPending.length; i += 1) {
      kids.push(humanCard(v.humanPending[i], opts));
    }
  }
  box.replaceChildren.apply(box, kids);
}

/* ---------- 建议区（§14.2 第 4 区）---------- */

/**
 * 一条建议：后端算好的大白话 diff + 采纳 / 先不用。
 *
 * 采纳按钮的确认框必须写清后果（§2.5 铁律 7）：清单换版之后，
 * 之前答过的确认全部不作数——不说这句，人点完才发现要重答一遍，
 * 下一次就再也不敢点了。
 */
function propCard(p, opts) {
  const o = opts || {};
  const card = el('div', 'card prop');
  card.dataset.proposalId = p.id;
  const lines = String(p.text || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    card.appendChild(el('p', 'say', g(lines[i])));
  }

  const next = (p.instanceVersion || 0) + 1;
  const msg = el('p', 'msg');
  const take = el('button', 'take', '采纳');
  take.dataset.proposalId = p.id;
  take.onclick = function () {
    const warn = '采纳后，检查清单会变成第 ' + next + ' 版，之前答过的确认要重新答。确定吗？';
    if (!confirm(warn)) return;
    if (o.onApply) o.onApply(p.id, msg);
  };
  card.appendChild(take);

  const skip = el('button', 'ghost skip', '先不用');
  skip.dataset.proposalId = p.id;
  skip.onclick = function () { if (o.onReject) o.onReject(p.id, msg); };
  card.appendChild(skip);
  card.appendChild(msg);
  return card;
}

/** 有待处理建议才显示这一区（§14.2）。没有就整区藏起来。 */
function drawProps(list, opts) {
  const zone = $('#zone-prop');
  const box = $('#props');
  if (!list || list.length === 0) {
    zone.hidden = true;
    box.replaceChildren();
    return;
  }
  zone.hidden = false;
  const kids = [];
  for (let i = 0; i < list.length; i += 1) kids.push(propCard(list[i], opts));
  box.replaceChildren.apply(box, kids);
}

/* ---------- 谁在干活区（§14.2 第 5 区）---------- */

function roundCard(r) {
  const card = el('div', 'card');
  const who = r.sessionId || '一个助手';
  const n = (r.files || []).length;
  const what = n > 0 ? '正在改 ' + n + ' 个文件' : '在干活，还没说要改哪些文件';
  const gate = r.gateId ? '（' + g(r.gateId) + '）' : '';
  card.appendChild(el('p', 'say', who + ' ' + what + gate + '，从 ' + ago(r.startedAt) + ' 开始'));
  const vs = r.violations || [];
  for (let i = 0; i < vs.length; i += 1) {
    card.appendChild(el('p', 'bad', g(vs[i].say || vs[i].kind || '有一处不太对')));
  }
  return card;
}

function drawRounds(rounds) {
  const box = $('#rounds');
  const live = [];
  const all = rounds || [];
  for (let i = 0; i < all.length; i += 1) {
    if (!all[i].endedAt && !all[i].aborted) live.push(all[i]);
  }
  const kids = [];
  if (live.length === 0) {
    kids.push(el('div', 'empty', '现在没有助手在干活。'));
  } else {
    for (let i = 0; i < live.length; i += 1) kids.push(roundCard(live[i]));
  }
  box.replaceChildren.apply(box, kids);
}

/* ---------- 项目列表页（§14.2）---------- */

/**
 * 一张项目卡，卡上只有四样：名字、一句话状态、最要紧的一件事、进去看。
 * 多了就得读，读就得挑，挑就会挑错——这一页的活是"告诉我该管哪个"。
 */
function projectCard(row, opts) {
  const o = opts || {};
  const card = el('button', 'pcard');
  card.dataset.projectId = row.id;
  card.appendChild(el('span', 'pn', row.alias || row.dir));

  if (row.error) {
    card.appendChild(el('p', 'pstate', g(row.error)));
    card.appendChild(el('p', 'pfirst', '要紧的事：找技术同事看一下这个项目'));
  } else {
    card.appendChild(el('p', 'pstate', whereLine(row.stage)));
    card.appendChild(el('p', 'pfirst', stuckLine(row.verdict)));
  }
  card.appendChild(el('p', 'pgo', '进去看'));
  card.onclick = function () { if (o.onOpen) o.onOpen(row.id, row.dir); };
  return card;
}

function drawList(rows, opts) {
  const box = $('#cards');
  const emptyBox = $('#list-empty');
  if (!rows || rows.length === 0) {
    emptyBox.hidden = false;
    // 这句话是给不懂技术的人看的，所以不写命令行（§2.5 铁律 2 禁词零命中）。
    // 要跑哪几条命令写在包的 README 里，技术同事看那儿。
    emptyBox.textContent =
      '还没有项目。把这句话转给帮你装的技术同事就行：'
      + '「请帮我把项目文件夹挂上检查清单，再把它加到看板上。」'
      + '装好之后这一页就会出现项目卡片，点进去看该做什么。';
    box.replaceChildren();
    return;
  }
  emptyBox.hidden = true;
  const kids = [];
  for (let i = 0; i < rows.length; i += 1) kids.push(projectCard(rows[i], opts));
  box.replaceChildren.apply(box, kids);
}

/* ---------- 跟服务说话 ---------- */

let TOKEN = '';
let CURRENT = null;   // 当前打开的项目目录
let TIMER = null;

async function api(pathname, init) {
  const opt = init || {};
  const headers = opt.headers || {};
  headers.Authorization = 'Bearer ' + TOKEN;
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(pathname, {
    method: opt.method || 'GET',
    headers: headers,
    body: opt.body,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const e = new Error((data && (data.error || data.why)) || '这一步没做成');
    e.data = data;
    throw e;
  }
  return data;
}

function showPage(which) {
  $('#boot').hidden = true;
  $('#page-list').hidden = which !== 'list';
  $('#page-project').hidden = which !== 'project';
}

function saveErr(msg, box) {
  if (!box) { alert(msg); return; }
  box.className = 'msg err';
  box.textContent = msg;
}

/* ---------- 项目页：拉一次，画五区 ---------- */

async function loadProject(dir) {
  CURRENT = dir;
  // 三样一起拉。走 /v1/projects?project= 而不是判定接口，
  // 因为「第几步 · 这步叫什么」的名字在清单里，判定结果里没有。
  const [one, rd, props] = await Promise.all([
    api('/v1/projects?project=' + encodeURIComponent(dir)),
    api('/v1/rounds?project=' + encodeURIComponent(dir)),
    api('/v1/proposals?project=' + encodeURIComponent(dir)),
  ]);

  GLOSSARY = one.glossary || GLOSSARY;
  const row = (one.projects || [])[0] || {};

  const name = row.alias || String(dir || '').split('/').pop() || '这个项目';
  $('#pname').textContent = name;
  $('#crumb').textContent = name;

  if (row.error || !row.verdict) {
    $('#a-where').textContent = '现在走到：说不上来';
    $('#a-stuck').textContent = '卡在：' + g(row.error || '这个项目还没挂上检查清单');
    $('#a-next').textContent = '下一步：把上面这句话转给帮你装的技术同事';
    drawBlockers({ blockers: [] });
    drawHumans({ humanPending: [] }, {});
    drawProps([], {});
    drawRounds(rd.rounds || []);
    showPage('project');
    return;
  }

  const v = row.verdict;
  const stage = row.stage || null;

  drawAsk3(v, stage);
  drawBlockers(v);
  drawHumans(v, {
    onConfirm: async function (gateId, note, answers, msg) {
      try {
        // 先存回答再存确认：确认那一步会当场重判这一条，
        // 顺序反了的话重判时看不到刚写的答案，屏上会闪一下"还没答"。
        if (Object.keys(answers).length) {
          await api('/v1/answers', {
            method: 'POST',
            body: JSON.stringify({ project: dir, promptId: gateId, answers: answers }),
          });
        }
        await api('/v1/human-confirm', {
          method: 'POST',
          body: JSON.stringify({ project: dir, gateId: gateId, note: note }),
        });
        await loadProject(dir);
      } catch (e) {
        saveErr('这条没存上：' + e.message, msg);
      }
    },
    onUpload: async function (gateId, files, msg) {
      if (!files || !files.length) return;
      const fd = new FormData();
      fd.append('project', dir);
      fd.append('gateId', gateId);
      for (let i = 0; i < files.length; i += 1) fd.append('files', files[i]);
      try {
        const r = await api('/v1/evidence', { method: 'POST', body: fd });
        msg.className = 'msg';
        msg.textContent = '收下了 ' + (r.saved || []).length + ' 个文件。';
        await loadProject(dir);
      } catch (e) {
        saveErr(e.message, msg);
      }
    },
  });

  drawProps(props.proposals || [], {
    onApply: async function (id, msg) {
      try {
        await api('/v1/proposals/' + encodeURIComponent(id) + '/apply', {
          method: 'POST',
          body: JSON.stringify({ project: dir, approvedBy: '看板' }),
        });
        await loadProject(dir);
      } catch (e) {
        saveErr('没采纳成：' + e.message, msg);
      }
    },
    onReject: async function (id, msg) {
      try {
        await api('/v1/proposals/' + encodeURIComponent(id) + '/reject', {
          method: 'POST',
          body: JSON.stringify({ project: dir }),
        });
        await loadProject(dir);
      } catch (e) {
        saveErr('这条没放下：' + e.message, msg);
      }
    },
  });

  drawRounds(rd.rounds || []);
  showPage('project');
}

/* ---------- 列表页 ---------- */

async function loadList() {
  CURRENT = null;
  $('#crumb').textContent = '';
  const r = await api('/v1/projects');
  GLOSSARY = r.glossary || GLOSSARY;
  drawList(r.projects || [], {
    onOpen: function (id, dir) { loadProject(dir); },
  });
  showPage('list');
}

/* ---------- 起手 ---------- */

async function boot() {
  try {
    // 口令和术语表一起来。这个地址只认同源，跨站的脚本读不到返回值。
    const meta = await api('/api/meta');
    TOKEN = meta.token || '';
    GLOSSARY = meta.glossary || {};
  } catch (e) {
    // 拿不到口令就没法往下走了。说清怎么办，别停在空白页（§2.5 空状态即引导）。
    $('#boot').textContent = '看板打不开。请让技术同事在项目文件夹里重新跑一次 webuddy open。';
    return;
  }

  try {
    await loadList();
  } catch (e) {
    $('#boot').textContent = '项目列表读不出来：' + e.message
      + ' 请让技术同事重新跑一次 webuddy open。';
    return;
  }

  // 每 5 秒轻刷一次。服务端 3 秒内同 scope 直接回缓存，
  // 所以连点也不会把机器算爆（§14.2）。
  if (TIMER) clearInterval(TIMER);
  TIMER = setInterval(function () {
    if (CURRENT) loadProject(CURRENT).catch(function () {});
    else loadList().catch(function () {});
  }, 5000);
}

if (typeof document !== 'undefined' && document.getElementById) {
  const home = document.getElementById('home');
  if (home) {
    home.onclick = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      loadList().catch(function () {});
    };
  }
  const go = document.getElementById('add-go');
  if (go) {
    go.onclick = async function () {
      const dir = (document.getElementById('add-dir') || {}).value || '';
      const alias = (document.getElementById('add-alias') || {}).value || '';
      const msg = document.getElementById('add-msg');
      if (!dir.trim()) { saveErr('先把项目文件夹的路径贴进来。', msg); return; }
      try {
        await api('/v1/projects', {
          method: 'POST',
          body: JSON.stringify({ dir: dir.trim(), alias: alias.trim() }),
        });
        if (msg) { msg.className = 'msg'; msg.textContent = '加进来了。'; }
        await loadList();
      } catch (e) {
        saveErr(e.message, msg);
      }
    };
  }
  boot();
}
