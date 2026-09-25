/* ============================================================
   钟氏族谱数字知识库 · 应用逻辑
   ============================================================ */
(function () {
  "use strict";
  var D = window.GENEA || {};
  var P = D.persons || [];
  var IDX = {};
  P.forEach(function (p) { IDX[p.id] = p; });

  var ANCHOR = D.anchorIds || [];
  var ANCHOR_SET = {};
  ANCHOR.forEach(function (id) { if (id) ANCHOR_SET[id] = true; });

  /* 房支 → 该支最早一代且有子嗣的人物（世系树「按房支选根」用） */
  var BRANCHROOT = {};
  (function () {
    var byB = {};
    P.forEach(function (p) { if (p.branch) (byB[p.branch] = byB[p.branch] || []).push(p); });
    Object.keys(byB).forEach(function (b) {
      var arr = byB[b].slice().sort(function (a, c) { return (a.gen || 0) - (c.gen || 0); });
      var cand = arr.filter(function (p) { return (p.childIds || []).length > 0; });
      BRANCHROOT[b] = (cand[0] || arr[0] || {}).id || null;
    });
  })();

  /* ---------------- 过继承嗣关系网络数据 ---------------- */
  /* 唯一直实、可追溯的信号是原文「为嗣」句式（已逐条核对样例，与已知事实吻合）：
     ① 父亲侧：某人 raw 中「承继[源][嗣子名]为嗣」→ 该人=嗣父，[嗣子名]=嗣子；
        例：大云 raw「承继堂兄大同第二子万铎 第三子万鉴为嗣」⇒ 大云承 大同之子 万铎/万鉴 为嗣。
     ② 儿子侧：某人 raw 中「[嗣子名]出继[目标]为嗣」→ [嗣子名]=嗣子(该人之子)，[目标]=嗣父；
        例：万怀 raw「出继胞兄大伦为嗣」⇒ 万怀 入嗣 大伦。
     ③ 种子边：father 字段「嗣父（本生父X）」→ 高置信 (嗣父→嗣子)；
        例：万怀.father="大伦（本生父大伸）" ⇒ 万怀 入嗣 大伦（本生父 大伸）。
     旧逻辑曾把「inst 含承继者的所有 childIds 当嗣子」——但那些多为亲生子，致 99% 边虚假，已弃用。 */
  var byName2 = {};
  P.forEach(function (p) { (byName2[p.name] = byName2[p.name] || []).push(p); });
  function resolvePerson(nm, opts) {
    if (!nm) return null;
    var cand = byName2[nm] || [];
    if (!cand.length) return null;
    if (opts && opts.childOf) { var h = cand.filter(function (x) { return (opts.childOf.childIds || []).indexOf(x.id) >= 0; })[0]; if (h) return h; }
    if (opts && opts.nearGen != null) { var hg = cand.filter(function (x) { return Math.abs((x.gen || 0) - opts.nearGen) <= 2; })[0]; if (hg) return hg; }
    if (opts && opts.inst) { var hi = cand.filter(function (x) { return (x.inst || []).indexOf(opts.inst) >= 0; })[0]; if (hi) return hi; }
    return cand[0];
  }
  function stripRel(s) {
    return (s || "").replace(/[（(][^)）]*[)）]/g, "")
      .replace(/^(胞|堂|再从|三从|族|本房|本|房)?(兄|弟|姊|妹|伯|叔|侄|孙|太|太公|太位下|太系下)?/g, "")
      .replace(/^(之)?(长|次|三|四|五|六|七|八|九|十)?(子|女)?/g, "").trim();
  }
  var ADOPT = [];                 // {sonId,sonN,gen,adoptiveId,adoptiveN,bioId,bioN,src}
  var ADOPT_MAP = {};             // sonId|adoptiveId -> edge（按 嗣子+嗣父 去重）
  function addEdge(e) {
    if (!e.sonId || !e.adoptiveId || e.sonId === e.adoptiveId) return;
    var k = e.sonId + "|" + e.adoptiveId;
    if (ADOPT_MAP[k]) {
      var o = ADOPT_MAP[k];
      if (!o.bioN && e.bioN) o.bioN = e.bioN;
      if (!o.bioId && e.bioId) o.bioId = e.bioId;
      if (!o.src) o.src = e.src;
      return;
    }
    ADOPT_MAP[k] = e; ADOPT.push(e);
  }
  /* ③ 种子边：本生父字段（最高置信） */
  P.forEach(function (p) {
    var m = (p.father || "").match(/^(.+?)（本生父(.+?)）$/);
    if (!m) return;
    var ado = resolvePerson(m[1].trim(), { childOf: p, nearGen: (p.gen || 0) - 1 });
    var bio = resolvePerson(m[2].trim(), { nearGen: (p.gen || 0) - 1 });
    addEdge({ sonId: p.id, sonN: p.name, gen: p.gen, adoptiveId: ado ? ado.id : null, adoptiveN: m[1].trim(), bioId: bio ? bio.id : null, bioN: m[2].trim(), src: "father" });
  });
  /* ① 父亲侧：承继…为嗣 */
  P.forEach(function (p) {
    var raw = p.raw || "", re = /承继([\s\S]*?)为嗣/g, m;
    while ((m = re.exec(raw))) {
      var seg = m[1], names = [], q, qre = /第[一二三四五六七八九十]+子([\u4e00-\u9fa5]{1,3})/g;
      while ((q = qre.exec(seg))) names.push(q[1]);
      if (!names.length) {
        var af = raw.slice(m.index + m[0].length).match(/^[\s：:]*([\u4e00-\u9fa5]{1,3})/);
        if (af && !/为嗣/.test(af[1])) names.push(af[1]);
      }
      if (!names.length) {
        var b = seg.replace(/[（(][^)）]*[)）]/g, "").match(/([\u4e00-\u9fa5]{1,3})(?:为嗣|$)/);
        if (b) names.push(b[1]);
      }
      names.forEach(function (nn) {
        var s = resolvePerson(nn, { childOf: p, nearGen: (p.gen || 0) + 1 });
        if (s) addEdge({ sonId: s.id, sonN: s.name, gen: s.gen, adoptiveId: p.id, adoptiveN: p.name, bioId: null, bioN: null, src: "raw-cheng" });
      });
    }
  });
  /* ② 儿子侧：X出继…为嗣 */
  P.forEach(function (p) {
    var raw = p.raw || "", re = /([\u4e00-\u9fa5]{1,3})出继([\s\S]*?)为嗣/g, m;
    while ((m = re.exec(raw))) {
      var sonNm = m[1], seg = m[2];
      var s = resolvePerson(sonNm, { childOf: p, nearGen: (p.gen || 0) + 1 });
      if (!s) continue;
      var tgt = seg.replace(/第[一二三四五六七八九十]+子/g, "").replace(/[（(][^)）]*[)）]/g, "").match(/([\u4e00-\u9fa5]{1,3})$/);
      var tgtN = tgt ? stripRel(tgt[1]) : null;
      var tp = tgtN ? resolvePerson(tgtN, { inst: "承继", nearGen: p.gen }) : null;
      if (tp) addEdge({ sonId: s.id, sonN: s.name, gen: s.gen, adoptiveId: tp.id, adoptiveN: tp.name, bioId: null, bioN: null, src: "raw-chu" });
    }
  });
  /* 节点角色：father=嗣父 / son=嗣子（一身兼二者称「兼祧/兼两角」） */
  var ADOPT_NODE = {};            // id -> {father,son,edges:[idx]}
  ADOPT.forEach(function (e, i) {
    if (e.adoptiveId) { var a = ADOPT_NODE[e.adoptiveId] = ADOPT_NODE[e.adoptiveId] || { father: false, son: false, edges: [] }; a.father = true; a.edges.push(i); }
    if (e.sonId) { var s = ADOPT_NODE[e.sonId] = ADOPT_NODE[e.sonId] || { father: false, son: false, edges: [] }; s.son = true; s.edges.push(i); }
  });
  /* 房支过继标签人数（出＝本房有成员被出继 / 入＝本房有成员承继或双祧；此为标签计数，非边流向） */
  var BRANCH_FLOW = {};
  P.forEach(function (p) {
    if (!p.branch) return;
    var bf = BRANCH_FLOW[p.branch] = BRANCH_FLOW[p.branch] || { out: 0, in: 0 };
    if ((p.inst || []).indexOf("出继") >= 0) bf.out++;
    if ((p.inst || []).indexOf("承继") >= 0) bf.in++;
  });
  var SHUANG = P.filter(function (p) { return (p.raw || "").indexOf("双祧") >= 0; }).length;
  var adoptState = { branch: "", type: "all", q: "", sel: null, tx: 0, ty: 0, scale: 1 };

  /* ---------------- 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cn(n) {
    var d = "〇一二三四五六七八九";
    if (n <= 0 || n > 99) return String(n);
    if (n < 10) return d[n];
    var t = Math.floor(n / 10), o = n % 10;
    return (t === 1 ? "十" : d[t] + "十") + (o ? d[o] : "");
  }
  function genLabel(g) { return g ? "第" + cn(g) + "世" : "—"; }
  function num(v) { return v == null ? "" : String(v); }
  /* 千分位：5410 -> 5,410（用于文案里的数字，避免硬编码与数据脱节） */
  function thou(v) { return String(v == null ? 0 : v).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* 自定义悬浮提示：替代 SVG 原生 <title>（原生提示有延迟且不可排版）。
     给任意元素加 data-tip="可见 HTML" 即可；bindTips 在每次渲染后绑定。 */
  function tattr(s) { return ' data-tip="' + String(s).replace(/"/g, "&quot;") + '"'; }
  function bindTips(root) {
    if (!root) return;
    var tip = document.getElementById("tip");
    if (!tip) { tip = document.createElement("div"); tip.id = "tip"; tip.className = "tip"; document.body.appendChild(tip); }
    Array.prototype.slice.call(root.querySelectorAll("[data-tip]")).forEach(function (el) {
      el.addEventListener("mousemove", function (e) {
        tip.innerHTML = el.getAttribute("data-tip");
        tip.style.display = "block";
        var x = e.clientX + 14, y = e.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
        tip.style.left = x + "px"; tip.style.top = y + "px";
      });
      el.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    });
  }

  var GENCHAR = { 1: "永", 2: "明", 3: "崇", 4: "友", 5: "祖", 6: "宗", 7: "诚", 8: "受", 9: "绍", 10: "金",
    11: "宜", 12: "思", 13: "建", 14: "惟", 15: "嘉", 16: "大", 17: "万", 18: "先", 19: "上", 20: "林",
    21: "世", 22: "德", 23: "延", 24: "枝", 25: "秀", 26: "隆", 27: "学", 28: "起", 29: "昌", 30: "文", 31: "英" };

  var VOLS = [
    { name: "总目录", a: 1, b: 2, note: "七修族谱总编目录（十一本编目）" },
    { name: "族谱（一）", a: 3, b: 88, note: "修谱序、祠图、祭祀礼仪、远兴堂祠宇记、字派、服制图、坟图、田山记、例规族规、修谱芳名、合约" },
    { name: "族谱（二）", a: 89, b: 99, note: "钟姓始祖由来的说明、钟姓远系历代世祖生平源流考" },
    { name: "族谱（三）", a: 100, b: 229, note: "第一世至第二十世世系录（按上房/中房/前房分列）" },
    { name: "族谱（四）", a: 230, b: 351, note: "十六至二十世世系（林宝房等）" },
    { name: "族谱（五）", a: 352, b: 476, note: "十六至二十世世系（思字派各房续录）" },
    { name: "族谱（六）", a: 477, b: 579, note: "第二十一世至三十一世世系（含本支：世礼→德松→延鑫→枝鹏，第 493-495 页）" },
    { name: "族谱（七）", a: 580, b: 710, note: "二十一至三十一世前房（金壁太、金龙太房）" },
    { name: "族谱（八）", a: 711, b: 831, note: "二十一至三十一世前房金广太、受旭太房" },
    { name: "族谱（九）", a: 832, b: 983, note: "二十一至三十一世前房金炼太（兰田新屋片）" },
    { name: "族谱（十）", a: 984, b: 1141, note: "二十一至三十一世前房金炼太（青龙、沙里扩片）" },
    { name: "族谱（十一）", a: 1142, b: 1210, note: "人文传略、领谱字号、跋、新添人丁册、余人册" }
  ];

  var KEYPAGES = [
    { p: 1, t: "总编目录（一）", d: "十一本编目总览" },
    { p: 2, t: "总编目录（二）", d: "各本内容与字派范围" },
    { p: 93, t: "钟姓始祖由来的说明", d: "得姓源流：钟离昧→接公受姓" },
    { p: 94, t: "钟姓远系历代世祖源流考", d: "一世接公→四十二世玚公" },
    { p: 102, t: "族谱（三）目录 · 一世至四世", d: "永健公传下世系" },
    { p: 111, t: "十一世 宣都 · 十二世 思珞", d: "★本支房祖思珞太位下" },
    { p: 112, t: "十四世 惟铎 · 十五世 嘉迎", d: "★嘉迎公，十六世大义之父" },
    { p: 165, t: "十六世 大义 · 十七世 万巡", d: "★上房思珞太位下世系起始" },
    { p: 167, t: "十九世 上琇", d: "例授登仕郎，寿八十九" },
    { p: 168, t: "二十世 林宝 正系", d: "★林宝公，子六" },
    { p: 493, t: "大义太位下世系（枫树坪）", d: "族谱（六）本支分支首页" },
    { p: 494, t: "★ 世礼 · 德松 · 延鑫 · 枝鹏", d: "本支二十一至二十四世" },
    { p: 495, t: "枝旗", d: "本支同辈" }
  ];

  /* ---------------- 主题 ---------------- */
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("zsh-theme", t); } catch (e) {}
    var b = $("#themebtn"); if (b) b.textContent = t === "dark" ? "☀ 浅色" : "☾ 深色";
  }
  (function () {
    var t = "light";
    try { t = localStorage.getItem("zsh-theme") || "light"; } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
  })();

  /* ---------------- 世代统计 ---------------- */
  var GENCNT = {};
  P.forEach(function (p) { if (p.gen) GENCNT[p.gen] = (GENCNT[p.gen] || 0) + 1; });

  /* 各世代「有可换算公元生年」的人数：与 build_data.py 的 genYear 同口径（1000 < 生年 < 2100） */
  var FAN_MIN = 3;   // 代际扇面的入图门槛：该世代至少 3 人有公元生年
  var GYEAR = {};
  P.forEach(function (p) {
    var y = p.birthYear;
    if (p.gen && typeof y === "number" && y > 1000 && y < 2100) GYEAR[p.gen] = (GYEAR[p.gen] || 0) + 1;
  });

  /* ---------------- 视图 ---------------- */
  var V = {};

  /* ===== 总览 ===== */
  V.home = function () {
    var m = D.meta || {};
    var topGens = Object.keys(GENCNT).map(Number).sort(function (a, b) { return a - b; });
    var mx = Math.max.apply(null, topGens.map(function (g) { return GENCNT[g]; }).concat([1]));

    var stairs = topGens.map(function (g) {
      var n = GENCNT[g];
      var h = Math.max(8, Math.round(n / mx * 156));
      var hot = (g >= 21 && g <= 24);
      return '<div class="bar' + (hot ? " on" : "") + '" data-g="' + g + '"' +
        tattr("第" + cn(g) + "世（" + (GENCHAR[g] || "—") + " 字派）　已录入 " + n + " 人") +
        '>' +
        '<div class="b" style="height:' + h + 'px"></div>' +
        '<div class="c">' + n + '</div>' +
        '<div class="n"><span>' + cn(g) + '</span></div></div>';
    }).join("");

    /* 字派目录覆盖到第几世（用于「世代跨度」卡片，避免硬编码） */
    var spanMax = (D.catalog || []).reduce(function (a, c) {
      var e = parseInt(String(c.range).replace(/[^\d-]/g, "").split("-")[1], 10);
      return (isNaN(e) || e < a) ? a : e;
    }, 1);

    var pai = (D.catalog || []).map(function (c) {
      var chars = c.display.split(" ");
      var chs = chars.map(function (ch, i) {
        var g = parseInt(c.range.split("-")[0]) + i;
        var hot = (g >= 21 && g <= 24);
        return '<div class="ch' + (hot ? " hot" : "") + '" title="第' + cn(g) + '世">' + esc(ch) + '</div>';
      }).join("");
      return '<div class="row"><div class="rng">第 ' + esc(c.range.replace("世", "")) + ' 世</div><div class="chs">' + chs + "</div></div>";
    }).join("");

    return '' +
      '<h2 class="sec">谱系总览</h2>' +
      '<p class="sub">' + esc(m.source || "") + '</p>' +
      '<div class="grid g4">' +
        stat(thou(m.pages || 0), "扫描页数", "覆盖原书约 " + thou((m.pages || 0) * 2) + " 页（每页为一个跨页）") +
        stat(String(m.volumes || 0), "卷册", "七修族谱共印 " + (m.copies || 0) + " 部，每部 " + (m.volumes || 0) + " 本") +
        stat(thou(m.persons || 0), "已录入人物", "结构化世系录条目") +
        stat((m.genMin || 1) + " – " + spanMax, "世代跨度", "字派五段，历九百余年") +
      '</div>' +

      '<h3 class="blk">字派（世代用字）</h3>' +
      '<div class="card" style="padding:6px 16px 10px">' +
        '<p class="small muted" style="margin:8px 0 2px">字派是判定世次的首要依据：同一世代的人名共用一字。本支「德松—延鑫—枝鹏」即第 22–24 世「德·延·枝」三代。</p>' +
        '<div class="pai">' + pai + "</div>" +
      '</div>' +

      '<h3 class="blk">各世代录入人数分布</h3>' +
      '<div class="card" style="padding:16px 18px">' +
        '<div class="stairs">' + stairs + "</div>" +
        '<p class="small muted" style="margin:10px 0 0">柱高与柱顶数字表示该世代已录入人数，柱下为世次（中文数字竖排）；悬停可看该世次的用字与人数，点击任一柱进入该世人物列表。红色为直系近祖所在世代：高祖父 21 世世礼、曾祖 22 世德松、祖父 23 世延鑫、父亲 24 世枝鹏。本谱 16–29 世（大字派至昌字派）体量最大。</p>' +
      '</div>' +

      '<h3 class="blk">本支（我的世系）速览</h3>' +
      '<div class="card" style="padding:16px 18px">' +
        '<div class="pathbar" id="homepath"></div>' +
        '<p class="small muted" style="margin:8px 0 0">一世祖钟永健（1101 年生，原居兴国竹坝，迁瑞金信义）→ 二十四世钟枝鹏。点击任一世次可进入「我这一脉」查看详传。</p>' +
      '</div>' +

      '<h3 class="blk">快速入口</h3>' +
      '<div class="grid g3">' + [
        ent("#/mypath", "我这一脉", "二十四代直系祖先详传 · 逐代同辈分支", true),
        ent("#/origin", "源流考", "钟氏得姓、颍川郡望、远系四十二世祖、入瑞迁徙"),
        ent("#/timeline", "族史长河", "人口纪元、代际扇面、" + ((D.sources || {}).timeline || []).length + " 条纪年事件"),
        ent("#/lineage", "世系与房支", "三大房分衍、承嗣制度、字派遵从、房支索引"),
        ent("#/tree", "交互世系树", "缩放拖拽、逐支展开、点击看详传"),
        ent("#/burial", "茔域", "河背坪丛葬、风水形胜、山向格局"),
        ent("#/people", "人物检索", "按姓名、世代、房支查阅全部录入人物"),
        ent("#/archive", "原谱浏览", "1210 页扫描原谱对照，含关键页直达")
      ].join("") + '</div>';
  };
  function stat(k, l, d) { return '<div class="card stat"><div class="k">' + esc(k) + '</div><div class="l">' + esc(l) + '</div><div class="d">' + esc(d) + '</div></div>'; }
  function ent(href, t, d, hot) {
    return '<a class="card" style="padding:15px 17px;text-decoration:none;display:block' + (hot ? ";border-color:var(--accent)" : "") + '" href="' + href + '">' +
      '<div style="font-family:var(--serif);font-size:17px;letter-spacing:.06em;' + (hot ? "color:var(--accent);font-weight:700" : "") + '">' + esc(t) + '</div>' +
      '<div class="small muted" style="margin-top:5px;line-height:1.7">' + esc(d) + "</div></a>";
  }

  /* ===== 我这一脉 ===== */
  V.mypath = function () {
    var chain = ANCHOR.map(function (id) { return IDX[id]; }).filter(Boolean);
    if (!chain.length) return '<h2 class="sec">我这一脉</h2><p class="sub">数据缺失。</p>';

    var bar = chain.map(function (p, i) {
      return '<div class="n" data-id="' + esc(p.id) + '"><div class="g">' + cn(p.gen) + '世</div><div class="m">' + esc(p.name) + "</div></div>";
    }).join("");

    var cards = chain.map(function (p, i) {
      return ancCard(p, i === chain.length - 1);
    }).join("");

    return '' +
      '<h2 class="sec">我这一脉 · 二十四代直系</h2>' +
      '<p class="sub">钟德松（二十二世）→ 钟延鑫（二十三世）→ 钟枝鹏（二十四世）。已逐页精读原谱（PDF 第 102、111、112、165–168、494 页等）校订。</p>' +
      '<div class="pathbar">' + bar + '</div>' +
      '<div class="chain">' + cards + '</div>' +
      '<h3 class="blk">阅读提示</h3>' +
      '<div class="card" style="padding:14px 18px">' +
      '<ul style="margin:0;padding-left:20px;font-size:13px;line-height:2.1">' +
      '<li>每张卡片可点击展开/收起详情；<b>原文</b>栏为族谱逐字转录，是溯源依据。</li>' +
      '<li>「同辈兄弟」列出该世与直系祖同父的兄弟，可点击查看其分支。</li>' +
      '<li>「承继/双祧/出继」是族谱常见的过继承嗣制度：无嗣者以兄弟之子为嗣，兼祧两房者称「双祧」。</li>' +
      '<li>生年多用年号纪年（如「清光绪丁未」＝1907 年），已尽量换算公元。</li>' +
      '</ul></div>';
  };

  function ancCard(p, isLast) {
    var sibs = [];
    if (p.fatherId && IDX[p.fatherId]) {
      var fa = IDX[p.fatherId];
      if (fa.kids && fa.kids.length) {
        sibs = fa.kids.filter(function (k) { return k.n && k.n !== p.name; });
      }
    }
    var major = p.anc || isLast;
    var kv = [];
    kv.push(["世次", genLabel(p.gen) + (p.rank ? "，行第 " + esc(p.rank) : "") + (p.branch ? "　<span class='muted small'>" + esc(p.branch) + "</span>" : "")]);
    if (p.father) kv.push(["父", esc(p.father) + (p.fatherId && IDX[p.fatherId] ? ' <span class="small muted">（见世系树）</span>' : "")]);
    if (p.birth) kv.push(["生", esc(p.birth) + (p.birthYear ? "（" + p.birthYear + "）" : "")]);
    if (p.death) kv.push(["殁", esc(p.death)]);
    if (p.spouses && p.spouses.length) kv.push(["配", p.spouses.map(function (s) { return esc(s.n) + (s.note ? '<span class="small muted">（' + esc(s.note) + "）</span>" : ""); }).join("；")]);
    if (p.burial) kv.push(["葬", esc(p.burial)]);
    if (p.notes) kv.push(["注", esc(p.notes)]);

    var kidHtml = "";
    if (p.kids && p.kids.length) {
      kidHtml = '<div class="kids">' + p.kids.map(function (k) {
        var female = k.g === "F";
        var clickable = !female;
        return '<span class="kid' + (female ? " f" : "") + '"' + (clickable && k.n ? ' data-name="' + esc(k.n) + '" data-gen="' + (p.gen + 1) + '"' : "") + '>' +
          esc(k.n || "（未名）") + (k.r ? '<span class="t">' + esc(k.r) + "</span>" : "") + (k.note ? '<span class="t">' + esc(k.note) + "</span>" : "") + "</span>";
      }).join("") + "</div>";
    }
    var sibHtml = sibs.length ? '<div class="sib"><div class="lb">同辈兄弟（同父）</div><div class="kids">' +
      sibs.map(function (k) {
        var female = k.g === "F";
        return '<span class="kid' + (female ? " f" : "") + '"' + (!female && k.n ? ' data-name="' + esc(k.n) + '" data-gen="' + p.gen + '"' : "") + '>' +
          esc(k.n || "（未名）") + (k.r ? '<span class="t">' + esc(k.r) + "</span>" : "") + (k.note ? '<span class="t">' + esc(k.note) + "</span>" : "") + "</span>";
      }).join("") + "</div></div>" : "";

    return '<div class="card anc' + (major ? " major" : "") + '" id="anc-' + esc(p.id) + '">' +
      '<div class="hd" data-toggle="' + esc(p.id) + '">' +
        '<span class="gen">' + cn(p.gen) + "世</span>" +
        '<span class="nm">' + esc(p.name) + "</span>" +
        (p.alias ? '<span class="al">' + esc(p.alias) + "</span>" : "") +
        (p.rank ? '<span class="rk">' + esc(p.rank) + "</span>" : "") +
        '<span class="tags">' +
          (p.birthYear ? '<span class="tagi">' + p.birthYear + "</span>" : "") +
          (p.anc ? '<span class="tagi you">直系</span>' : "") +
          '<span class="tagi">原谱 p' + esc(num(p.page)) + "</span>" +
        "</span>" +
      "</div>" +
      '<div class="bd hide">' +
        '<div class="kv">' + kv.map(function (r) { return '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + "</div>"; }).join("") + "</div>" +
        kidHtml + sibHtml +
        (p.raw ? '<div class="raw">' + esc(p.raw) + "</div>" : "") +
        '<div style="margin-top:10px"><button class="iconbtn" data-openpage="' + esc(num(p.page)) + '">查看原谱第 ' + esc(num(p.page)) + ' 页</button></div>' +
      "</div></div>";
  }

  /* ===== 源流 ===== */
  V.origin = function () {
    var S = D.sources || {};
    var streams = S.sourceStreams || [];
    var fa = S.farAncestors || [];
    var pre = S.prefaces || [];

    var flowSteps = [
      { e: "得姓", p: "商周", m: "宋国钟氏" },
      { e: "郡望", p: "汉魏", m: "颍川钟氏" },
      { e: "南迁一", p: "东晋", m: "渡江居丹阳" },
      { e: "南迁二", p: "南朝梁", m: "渡江至虔州" },
      { e: "入赣南", p: "唐", m: "移居平固（兴国）" },
      { e: "开基", p: "宋", m: "永健公迁瑞金信义" }
    ].map(function (s) {
      return '<div class="step"><div class="e">' + esc(s.e) + '</div><div class="p">' + esc(s.p) + "</div><div class=\"m\">" + esc(s.m) + "</div></div>";
    }).join("");

    var faHtml = fa.length ? '<div class="fa">' + fa.map(function (a) {
      var n = a.name || a.n || "";
      var g = a.generation || a.gen || a.g || "";
      var note = a.note || a.title || "";
      var key = /皓|繇|雅|绍京|接|宠|匡/.test(n);
      return '<div class="i' + (key ? " key" : "") + '"><span class="g">' + (g ? esc(g) : "") + '</span><span class="n">' + esc(n) + "</span>" +
        (note ? '<span class="t">' + esc(String(note).slice(0, 60)) + "</span>" : "") + "</div>";
    }).join("") + "</div>" : '<p class="muted small">（未提取到远系世祖列表）</p>';

    var streamHtml = streams.length ? streams.map(function (s) {
      return '<div class="acc"><div class="h"><span class="ar">▸</span><span class="tt">' + esc(s.topic || s.title || "源流") + "</span>" +
        (s.period ? '<span class="pill">' + esc(s.period) + "</span>" : "") +
        (s.page ? '<span class="muted small" style="margin-left:auto">p' + esc(s.page) + "</span>" : "") +
        '</div><div class="b">' + (s.text ? '<div class="quote">' + esc(s.text) + "</div>" : "") + "</div></div>";
    }).join("") : "";

    var preHtml = pre.length ? pre.map(function (p) {
      return '<div class="acc"><div class="h"><span class="ar">▸</span><span class="tt">' + esc(p.title || p.name || "序") + "</span>" +
        (p.author ? '<span class="pill">' + esc(p.author) + "</span>" : "") +
        (p.year ? '<span class="pill a">' + esc(p.year) + "</span>" : "") +
        '</div><div class="b">' + (p.summary ? '<p style="margin:0 0 8px">' + esc(p.summary) + "</p>" : "") +
        (p.excerpt ? '<div class="quote">' + esc(p.excerpt) + "</div>" : "") + "</div></div>";
    }).join("") : "";

    var gp = S.generationPoem || [];
    var gpHtml = gp.length ? gp.map(function (g) {
      return '<div class="acc open"><div class="h"><span class="ar">▾</span><span class="tt">' + esc(g.title || g.name || "字派") + "</span>" +
        (g.page ? '<span class="muted small" style="margin-left:auto">p' + esc(g.page) + "</span>" : "") + "</div>" +
        '<div class="b">' + (g.text ? '<div class="quote">' + esc(g.text) + "</div>" : "") + "</div></div>";
    }).join("") : "";

    return '' +
      '<h2 class="sec">钟氏源流考</h2>' +
      '<p class="sub">依据「钟姓始祖由来的说明」与「钟姓远系历代世祖生平源流考」（族谱（二），原书第 4–16 页）整理。</p>' +

      '<h3 class="blk">迁徙与分衍主线</h3>' +
      '<div class="flow">' + flowSteps + "</div>" +

      '<h3 class="blk">得姓与远系源流（原文摘录）</h3>' +
      (streamHtml || '<p class="muted small">（未提取）</p>') +

      '<h3 class="blk">远系历代世祖（一世接公 — 四十二世玚公）</h3>' +
      '<div class="card" style="padding:14px 16px">' + faHtml +
      '<p class="small muted" style="margin:12px 0 0">金色高亮为族谱特别着重记载的关键世祖：十世钟皓（颍川四长）、十二世钟繇（书法「钟王」）、十六世钟雅（首次南迁）、二十三世宠公（避侯景之乱渡江）、二十四世匡公（移居平固/兴国）、二十九世钟绍京（越国公、江南第一宰相）。</p></div>' +

      '<h3 class="blk">修谱序</h3>' +
      (preHtml || '<p class="muted small">（未提取）</p>') +

      (gpHtml ? '<h3 class="blk">字派（字辈诗）</h3>' + gpHtml : "") +

      '<h3 class="blk">七修谱十一本编目</h3>' +
      '<div class="card" style="padding:16px 18px">' +
      '<p class="small muted" style="margin:0 0 10px">' + esc(((S.catalog11Volumes || [])[0] || {}).total || "共印谱志 104 部，每部编成 11 本") + '</p>' +
      '<div class="grid g2">' + ((S.catalog11Volumes || [])[0] && (S.catalog11Volumes[0].volumes || [])).map(function (v, i) {
        return '<div class="acc" data-vi="' + i + '"><div class="h"><span class="ar">▸</span><span class="tt">' + esc(v.title || ("第" + (i + 1) + "本")) + "</span></div>" +
          '<div class="b"><ol style="margin:0;padding-left:20px;line-height:2.05;font-size:12.5px">' + (v.items || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol></div></div>";
      }).join("") + "</div></div>" +

      '<h3 class="blk">本支开基：永健公</h3>' +
      '<div class="card" style="padding:16px 18px">' +
      '<p style="margin:0 0 8px">族谱以 <b>一世祖钟永健</b>（字体乾，宋靖国元年辛巳／公元 1101 年生）为「脉祖」，原居<b>兴国竹坝村</b>，后迁<b>瑞金信义</b>，葬兴国竹坝村龙形。至十二世<b>思珞公</b>，本支立为「上房·思珞太位下」；至十六世<b>大义公</b>，族谱（六）中称「大义太位下世系（枫树坪）」。</p>' +
      '<div class="quote">第一世　脉祖 永健　字体乾　宋靖国元年辛巳生　绍兴二年殁　娶万氏　靖国生　绍兴六年殁　合葬兴国竹坝村龙形　子二　明辅　义辅止</div>' +
      '<div style="margin-top:12px"><button class="iconbtn" data-openpage="102">查看原谱 p102</button> <button class="iconbtn" data-openpage="94">查看源流考 p94</button></div>' +
      "</div>" +
      '<h3 class="blk">族规 · 坟山 · 合约（族产文献）</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">摘自族谱（一）末段：历届凡例族规、各房祭田记、山岗禁约、认租字与卖契等，反映宗族的公共治理与经济基础。</p>' +
      accList("历届凡例族规", (S.rules || []).map(function (r) {
        return { t: r.title || "凡例", p: r.page, x: r.points || r.text || "" };
      })) +
      accList("坟山 · 山场界址", (S.graves || []).map(function (g) {
        return { t: g.title || "山场", p: g.page, x: g.points || g.text || "" };
      })) +
      accList("合约 · 禁约 · 契字", (S.contracts || []).map(function (c) {
        return { t: c.title || "契字", p: c.page, x: c.points || c.text || "" };
      })) +
      appendixHtml(S.appendix);
  };

  /* 族谱（十一）附录文献：历修谱跋、人物传记、捐资名录、领谱字号 */
  function appendixHtml(ap) {
    if (!ap || !ap.length) return "";
    var groups = {};
    ap.forEach(function (a) {
      var k = a.type || "其他";
      (groups[k] = groups[k] || []).push(a);
    });
    var order = ["跋", "传", "捐资名录", "领谱字号", "其他"];
    var keys = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var nameMap = { "跋": "历修谱跋", "传": "人物传记 · 寿序文", "捐资名录": "捐资名录", "领谱字号": "领谱字号", "其他": "其他文献" };
    return '<h3 class="blk">历修谱跋与人物传记（族谱十一 · 原谱 p1142–1210）</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">族谱第十一本为文献汇编：收录二修至七修共六篇谱跋、历代贤达传记与寿序文、七修捐资芳名录、以及 104 部谱的领谱字号。谱跋是研究历次修谱时间与缘由的第一手材料。</p>' +
      keys.map(function (k) {
        var arr = groups[k].slice().sort(function (a, b) { return (a.page || 0) - (b.page || 0); });
        return accList(nameMap[k] || k, arr.map(function (a) {
          return { t: a.title || k, p: a.page, x: a.raw || "" };
        }));
      }).join("");
  }

  function accList(head, items) {
    if (!items || !items.length) return "";
    return '<div class="card" style="padding:12px 16px 6px;margin-bottom:12px">' +
      '<div style="font-family:var(--serif);font-size:14px;color:var(--ink-3);letter-spacing:.1em;margin-bottom:8px">' + esc(head) + "（" + items.length + "）</div>" +
      items.map(function (it) {
        return '<div class="acc"><div class="h"><span class="ar">▸</span><span class="tt" style="font-size:13.5px">' + esc(it.t) + "</span>" +
          (it.p ? '<span class="muted small" style="margin-left:auto">p' + esc(it.p) + "</span>" : "") +
          '</div><div class="b"><div style="line-height:2;font-family:var(--serif);font-size:13px;color:var(--ink-2)">' + esc(it.x) + "</div></div></div>";
      }).join("") + "</div>";
  }

  /* ===== 族史长河（时间轴 · 人口 · 代际扇面）===== */
  function ticks(min, max, step) {
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  }

  /* 每十年出生人数 */
  function histSvg(hist) {
    if (!hist || !hist.length) return '<p class="muted small">（无数据）</p>';
    var W = 1000, padL = 62, padR = 20, padT = 26, padB = 42;
    var plotH = 200, plotW = W - padL - padR, H = padT + plotH + padB;
    var d0 = hist[0].decade, d1 = hist[hist.length - 1].decade + 10;
    var maxN = Math.max.apply(null, hist.map(function (h) { return h.n; }));
    var step = Math.max(50, Math.ceil(maxN / 4 / 50) * 50);
    function sx(d) { return padL + (d - d0) / (d1 - d0) * plotW; }
    function sy(n) { return padT + plotH - n / maxN * plotH; }
    var barW = Math.max(1.8, plotW / ((d1 - d0) / 10) - 1.8);

    var gTotal = hist.reduce(function (a, h) { return a + h.n; }, 0);
    var bars = hist.map(function (h) {
      var x = sx(h.decade), y = sy(h.n), bh = padT + plotH - y;
      var peak = h.n === maxN;
      var tip = "公元 " + h.decade + "–" + (h.decade + 9) + " 年代<br><b>" + h.n + " 人</b>出生" +
        (gTotal ? "（占全部有生年族人 " + (100 * h.n / gTotal).toFixed(1) + "%）" : "");
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + Math.max(0.8, bh).toFixed(1) + '" fill="' + (peak ? "var(--accent)" : "var(--accent-2)") +
        '" opacity="' + (peak ? "1" : "0.7") + '"' + tattr(tip) + "></rect>";
    }).join("");

    var gy = ticks(0, maxN, step).map(function (v) {
      var y = sy(v);
      return '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--line)" stroke-width="0.8"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" font-size="11" fill="var(--ink-3)" text-anchor="end">' + v + "</text>";
    }).join("");

    var gx = ticks(d0, d1, 50).map(function (v) {
      var x = sx(v);
      return '<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) +
        '" stroke="var(--line)" stroke-width="0.6" opacity="0.55"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (padT + plotH + 17) + '" font-size="11" fill="var(--ink-3)" text-anchor="middle">' + v + "</text>";
    }).join("");

    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img">' +
      '<title>各年代出生人数</title>' + gy + gx + bars +
      '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) +
      '" stroke="var(--line-2)" stroke-width="1"/>' +
      '<text x="' + padL + '" y="14" font-size="11.5" fill="var(--ink-3)">出生人数（每十年合计）</text>' +
      '<text x="' + (W - padR) + '" y="14" font-size="11.5" fill="var(--ink-3)" text-anchor="end">公元纪年</text>' +
      "</svg>";
  }

  /* 世代 × 生年 扇面图 */
  function fanSvg(rows) {
    if (!rows || !rows.length) return '<p class="muted small">（无数据）</p>';
    var W = 1000, padL = 116, padR = 66, padT = 38, rowH = 28;

    /* 入图行 + 缺行占位：样本不足 3 人的世代也列出来，免得读者以为漏了数据 */
    var byGen = {};
    rows.forEach(function (r) { byGen[r.gen] = r; });
    var gEnd = Math.max(rows[rows.length - 1].gen, ((D.meta || {}).genMax || 0));
    var disp = [], gap = [];
    for (var gg = 1; gg <= gEnd; gg++) {
      if (byGen[gg]) {
        if (gap.length) { disp.push({ gap: gap }); gap = []; }
        disp.push({ row: byGen[gg] });
      } else { gap.push(gg); }
    }
    if (gap.length) disp.push({ gap: gap });

    var H = padT + disp.length * rowH + 34;
    var y0 = Math.floor(Math.min.apply(null, rows.map(function (r) { return r.min; })) / 20) * 20;
    var y1 = Math.ceil(Math.max.apply(null, rows.map(function (r) { return r.max; })) / 20) * 20;
    var plotW = W - padL - padR;
    var plotB = padT + disp.length * rowH;
    function sx(y) { return padL + (y - y0) / (y1 - y0) * plotW; }

    var gx = ticks(y0, y1, 50).map(function (v) {
      var x = sx(v);
      return '<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + plotB +
        '" stroke="var(--line)" stroke-width="0.6" opacity="0.55"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (plotB + 19) + '" font-size="11" fill="var(--ink-3)" text-anchor="middle">' + v + "</text>";
    }).join("");

    function gapRow(gens, i) {
      var cy = padT + i * rowH + rowH / 2;
      var label = gens.length === 1 ? cn(gens[0]) + "世"
        : cn(gens[0]) + "至" + cn(gens[gens.length - 1]) + "世";
      var total = gens.reduce(function (a, g) { return a + (GENCNT[g] || 0); }, 0);
      var dated = gens.reduce(function (a, g) { return a + (GYEAR[g] || 0); }, 0);
      var note = "生年样本不足 " + FAN_MIN + " 人，未入图（录入 " + total + " 人，其中 " + dated + " 人有公元生年）";
      var list = gens.map(function (g) { return cn(g) + "世 " + (GYEAR[g] || 0) + " 人"; }).join("、");
      var tip = label + "　录入 " + total + " 人，其中有可换算公元生年的仅 " + dated +
        " 人（不足 " + FAN_MIN + " 人，故未入图）　" + list;
      var est = 0;   // 粗估文字宽度，让虚线从文字右侧开始，避免压字
      for (var k = 0; k < note.length; k++) est += note.charCodeAt(k) < 256 ? 6 : 11.6;
      var lx = Math.min(W - padR - 40, padL + 10 + est + 12);
      return '<line x1="' + lx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + cy.toFixed(1) +
        '" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"></line>' +
        '<line x1="' + padL + '" y1="' + cy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + cy.toFixed(1) +
        '" stroke="transparent" stroke-width="18"' + tattr(tip) + "></line>" +
        '<text x="' + (padL - 12) + '" y="' + (cy + 4.5).toFixed(1) + '" font-size="12.5" fill="var(--ink-3)" text-anchor="end" font-family="var(--serif)">' +
        esc(label) + "</text>" +
        '<text x="' + (padL + 10) + '" y="' + (cy + 4.5).toFixed(1) + '" font-size="11.5" fill="var(--ink-3)">' +
        esc(note) + "</text>";
    }

    var body = disp.map(function (it, i) {
      if (it.gap) return gapRow(it.gap, i);
      var r = it.row;
      var cy = padT + i * rowH + rowH / 2;
      var x1 = sx(r.min), x2 = sx(r.max), xa = sx(r.p25), xb = sx(r.p75), xm = sx(r.p50);
      var anchor = ANCHOR[r.gen - 1] && IDX[ANCHOR[r.gen - 1]];
      return '<line x1="' + x1.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + cy.toFixed(1) +
        '" stroke="var(--line-2)" stroke-width="1.2"' + tattr(genLabel(r.gen) + "　生年跨度 " + r.min + "–" + r.max + "　共 " + r.n + " 人") + "></line>" +
        '<rect x="' + xa.toFixed(1) + '" y="' + (cy - 6).toFixed(1) + '" width="' + Math.max(2, xb - xa).toFixed(1) +
        '" height="12" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="0.8"' +
        tattr(genLabel(r.gen) + "　四分位区间 " + r.p25 + "–" + r.p75 + "（半数人落此区间）　共 " + r.n + " 人") + "></rect>" +
        '<circle cx="' + xm.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.6" fill="var(--accent)"' +
        tattr(genLabel(r.gen) + " 生年中位数 " + r.p50) + "></circle>" +
        '<text x="' + (padL - 12) + '" y="' + (cy + 4.5).toFixed(1) + '" font-size="12.5" fill="' +
        (anchor ? "var(--accent)" : "var(--ink-2)") + '" text-anchor="end" font-family="var(--serif)">' +
        cn(r.gen) + "世 " + esc(GENCHAR[r.gen] || "") + "</text>" +
        '<text x="' + (W - padR + 10) + '" y="' + (cy + 4.5).toFixed(1) + '" font-size="11.5" fill="var(--ink-3)">' + r.n + "人</text>";
    }).join("");

    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img">' +
      "<title>各世代生年分布扇面</title>" + gx + body +
      '<text x="' + padL + '" y="16" font-size="11.5" fill="var(--ink-3)">细线＝最早—最晚　色条＝四分位区间（半数人落此区间）　圆点＝生年中位数　虚线＝生年样本不足 ' + FAN_MIN + ' 人，未入图</text>' +
      '<text x="' + (W - padR) + '" y="16" font-size="11.5" fill="var(--ink-3)" text-anchor="end">公元纪年</text>' +
      "</svg>";
  }

  /* 纪年事件时间轴 */
  function tlList() {
    var tl = (D.sources || {}).timeline || [];
    if (!tl.length) return '<p class="muted small">（未提取到纪年事件）</p>';
    var bk = {};
    tl.forEach(function (t) {
      var y = parseInt(t.year, 10);
      var k = (isNaN(y) || y <= 1000) ? 0 : Math.floor(y / 50) * 50;
      (bk[k] = bk[k] || []).push(t);
    });
    var keys = Object.keys(bk).map(Number).sort(function (a, b) {
      if (a === 0) return 1; if (b === 0) return -1; return a - b;
    });
    return keys.map(function (k) {
      var arr = bk[k].slice().sort(function (a, b) { return (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0); });
      var label = k === 0 ? "年代未详" : k + " – " + (k + 49);
      return '<div class="tl-grp">' +
        '<div class="tl-g">' + label + '　<span class="muted">' + arr.length + " 条</span></div>" +
        arr.map(function (t) {
          var txt = (t.event || "") + " " + (t.note || "");
          return '<div class="tl-i" data-s="' + esc((String(t.year || "") + txt).toLowerCase()) + '">' +
            '<span class="tl-y">' + esc(t.year || "—") + "</span>" +
            '<span class="tl-t">' + esc(t.event || "") + "</span>" +
            (t.source ? '<span class="pill">' + esc(t.source) + "</span>" : "") +
            (parseInt(t.page, 10) ? '<button class="iconbtn mini" data-openpage="' + parseInt(t.page, 10) +
              '">p' + parseInt(t.page, 10) + "</button>" : "") +
            "</div>";
        }).join("") + "</div>";
    }).join("");
  }

  V.timeline = function () {
    var DV = D.derive || {};
    return '' +
      '<h2 class="sec">族史长河</h2>' +
      '<p class="sub">把全谱 ' + thou((D.meta || {}).persons) + ' 位族人的生年与 ' + ((D.sources || {}).timeline || []).length + ' 条纪年事件铺到一条时间轴上，看这个家族怎样从宋靖国元年（1101）走到今天。</p>' +

      '<h3 class="blk">人口纪元：每十年出生人数</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">数据来自 ' + ((DV.birthHist || []).reduce(function (a, h) { return a + h.n; }, 0)) +
      ' 位有明确公元生年的族人。十六世以前世系残缺，柱体极低；入清以后人口陡增，二十世纪一〇至三〇年代达到峰值——这正是十七至二十四世集中出生的年代。</p>' +
      '<div class="card chartcard">' + histSvg(DV.birthHist) + "</div>" +

      '<h3 class="blk">代际扇面：各世代的生年跨度</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">同一个世代的人，生年可以相差两百年——因为各房的繁衍节奏并不同步：' +
      '长子一支可能已到二十五世，幼弟一支才到二十世。色条越宽，说明该世代内部年龄差距越大、房支分化越明显。</p>' +
      '<div class="card chartcard">' + fanSvg(DV.genYear) + "</div>" +
      '<p class="small muted" style="margin:8px 0 0">本图只绘制「该世代至少 ' + FAN_MIN + ' 人有可换算公元生年」的世代（门槛与数据构建脚本一致），未达门槛者以虚线占位行标出，故图从九世（1421 年）起画、十世后直接跳到十六世。' +
      '原因在数据而非绘制：一至八世原谱生年多记作年号（如「宋高宗时」「元皇庆时」「明洪武时」）或失考，该区间能换算成公元的生年只有永健（1101）、明辅（1129）两处（永健在谱中重出一次）；十一至十五世同类，各世仅 0–1 条。' +
      '悬停占位行可看该区间的录入人数与有生年人数。</p>' +

      '<h3 class="blk">纪年事件</h3>' +
      '<div class="toolbar"><input type="text" id="tlf" placeholder="过滤事件（人名 / 年号 / 关键词）" style="width:280px">' +
      '<span class="small muted" id="tlc" style="margin-left:auto"></span></div>' +
      '<div class="card tllist" id="tllist">' + tlList() + "</div>";
  };

  /* ===== 茔域（葬地 · 形胜 · 山向）===== */
  var BPM = null;
  function bpMap() {
    if (BPM) return BPM;
    BPM = {};
    P.forEach(function (p) { if (p.bp) (BPM[p.bp] = BPM[p.bp] || []).push(p); });
    Object.keys(BPM).forEach(function (k) {
      BPM[k].sort(function (a, b) { return (a.gen || 0) - (b.gen || 0) || String(a.name).localeCompare(String(b.name)); });
    });
    return BPM;
  }

  function placeBlock(pl, maxCount) {
    var pct = Math.max(2, pl.count / maxCount * 100);
    var subs = (pl.subs || []).length
      ? '<div class="subs">' + pl.subs.map(function (s) {
        return '<span class="chip sm">' + esc(s.name) + " <b>" + s.count + "</b></span>";
      }).join("") + "</div>" : "";
    return '<div class="brow">' +
      '<div class="bn">' + esc(pl.name) + "</div>" +
      '<div class="barbox"><div class="barfill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="bv">' + pl.count + "</div>" +
      '<button class="iconbtn mini" data-bp="' + esc(pl.name) + '">名录</button>' +
      "</div>" + subs +
      '<div class="bp-list hide" id="bp-' + esc(pl.name) + '"></div>';
  }

  V.burial = function () {
    var DV = D.derive || {};
    var places = DV.burialPlaces || [];
    var shapes = DV.burialShapes || [];
    var orients = DV.burialOrients || [];
    var withB = P.filter(function (p) { return p.burial; }).length;
    var merged = DV.buriedCount || 0;
    var top = places.slice(0, 24);
    var maxC = top.length ? top[0].count : 1;
    var coverage = places.slice(0, 24).reduce(function (a, p) { return a + p.count; }, 0);

    // 葬地 × 世代 矩阵
    var gens = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
    var m = bpMap();
    var matrix = places.slice(0, 10).map(function (pl) {
      var arr = m[pl.name] || [];
      var row = gens.map(function (g) { return arr.filter(function (p) { return p.gen === g; }).length; });
      var mx = Math.max.apply(null, row) || 1;
      return '<tr><th>' + esc(pl.name) + "</th>" +
        row.map(function (v, i) {
          var al = v ? (0.12 + 0.78 * v / mx) : 0;
          return '<td class="' + (v ? "" : "z") + '"' + (v ? tattr(pl.name + " × " + cn(gens[i]) + "世　" + v + " 人") : "") +
            ' style="background:rgba(158,43,37,' + al.toFixed(2) + ');color:' +
            (al > 0.55 ? "#fffdf7" : "inherit") + '">' + (v || "") + "</td>";
        }).join("") + "</tr>";
    }).join("");

    return '' +
      '<h2 class="sec">茔域</h2>' +
      '<p class="sub">族谱对葬地的记载极为详尽——' + withB + " 位族人留下了葬地记录，" +
      "这些地名勾勒出宗族九百年来实际的聚落空间：从兴国竹坝的始迁祖墓，到信义河背坪的历代丛葬。</p>" +

      '<div class="grid g4">' + [
        stat(String(merged), "可归一出茔域", "从原文葬地文本中解析出具体地名"),
        stat(String(places.length), "茔域地名", "归一后去重（含异体字与形近字合并）"),
        stat(String(shapes.length), "风水形胜", "龙形、虎形、犬眠形等峦头名称"),
        stat(String(orients.length), "山向格局", "壬山丙向、坐东向西等坐向")
      ].join("") + "</div>" +

      '<h3 class="blk">主要茔域排行</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">前 24 处茔域占全部可归一出人数的 ' +
      (merged ? (100 * coverage / merged).toFixed(0) : 0) + "%。<b>河背坪</b>是本族最核心的丛葬区，" +
      "自十二世思字派以下历代族人大多聚葬于此，说明信义河背坪是宗族定居与祭祀的中心。点「名录」可列出葬于该处的族人。</p>" +
      '<div class="card" style="padding:14px 18px">' + top.map(function (pl) { return placeBlock(pl, maxC); }).join("") + "</div>" +

      '<h3 class="blk">风水形胜</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">原谱记墓必记地形，以「形」喻山势（虎形、象形、狮形、犬眠形……）。虎形与象形合计逾百处，是本地最常见的峦头。</p>' +
      '<div class="card" style="padding:14px 18px"><div class="chips">' +
      shapes.slice(0, 40).map(function (s) { return '<span class="chip">' + esc(s.name) + " <b>" + s.count + "</b></span>"; }).join("") +
      "</div></div>" +

      '<h3 class="blk">山向格局</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">早期墓多记罗盘「X山Y向」，近代则径写「坐东向西」。两者合计 ' +
      orients.reduce(function (a, o) { return a + o.count; }, 0) + " 处有明确坐向记载。</p>" +
      '<div class="card" style="padding:14px 18px"><div class="chips">' +
      orients.slice(0, 30).map(function (o) { return '<span class="chip">' + esc(o.name) + " <b>" + o.count + "</b></span>"; }).join("") +
      "</div></div>" +

      '<h3 class="blk">茔域与世代：哪个时代的人葬在哪里</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">横轴为世代，纵轴为主要茔域。颜色越深代表该世代葬于此处的人越多——可以看出十八至二十四世是河背坪丛葬最密集的时期。</p>' +
      '<div class="card" style="padding:10px 14px;overflow-x:auto"><table class="heat"><thead><tr><th></th>' +
      gens.map(function (g) { return "<th>" + cn(g) + "</th>"; }).join("") + "</tr></thead><tbody>" + matrix + "</tbody></table></div>" +

      '<h3 class="blk">说明与局限</h3>' +
      '<div class="card" style="padding:16px 18px"><ul style="margin:0;padding-left:20px;line-height:2.1">' +
      "<li>葬地文本归一化采用「主地名 + 细分」两级：如「信义河背上坪」「葬河青中坪」均归入 <b>河背坪</b>，并保留上坪 / 中坪 / 下坪 / 七层墓的细分。</li>" +
      "<li>「河青」为原谱刻印之「河背」异体，已合并；「塘 / 圹 / 扩」类形近字亦做归并。</li>" +
      "<li>共 " + (P.length - withB) + " 位族人原谱未记葬地（多为殇、止或近代失载），" +
      (withB - merged) + " 位有葬地记载但仅书「失考」「与父同处」等，无法归一出具体地名。</li>" +
      "<li>地名归属为文本层面的归并，未做实地地理定位；同名异地的情况可能存在。</li>" +
      "</ul></div>";
  };

  /* ===== 世系与房支 ===== */
  V.lineage = function () {
    var branches = D.branches || [];
    var roots = { "上房": [], "中房": [], "前房": [], "其他": [] };
    branches.forEach(function (b) { (roots[b.root] || roots["其他"]).push(b); });

    var BP = (D.derive || {}).branchPage || {};
    /* ---- 本支判定 ----
       ① 权威依据：该房支下有「本支直系」人物（persons 中 anc:true，即
          永健→明辅→崇三郎→友升→祖福→宗贤→诚信→受渊→绍显→…→思珞→大义→…→枝鹏 一线）；
       ② 补充依据：房支名出自本支房号者——原谱分卷标题自带「（本支…）」、「思珞太位下」
          （本支房祖支，未另标迁居村名）、「大义太位下」（本支第十六世后房号，含枫树坪）。 */
    var ANCBR = {};
    P.forEach(function (p) { if (p.anc && p.branch) ANCBR[p.branch] = true; });
    function isAncBranch(name) {
      if (ANCBR[name]) return true;
      if (name.indexOf("本支") >= 0) return true;
      if (/思珞太位下$/.test(name)) return true;
      if (name.indexOf("大义太位下") >= 0) return true;
      return false;
    }
    function bHtml(list) {
      return list.map(function (b) {
        var bp = BP[b.name];
        var anc = isAncBranch(b.name);
        return '<div class="acc' + (anc ? " ancbr" : "") + '"><div class="h"><span class="ar">▸</span><span class="tt">' + esc(b.name) + "</span>" +
          (anc ? '<span class="taganc">本支</span>' : "") +
          '<span class="muted small" style="margin-left:auto">' + b.count + " 人</span></div>" +
          '<div class="b"><button class="iconbtn" data-branch="' + esc(b.name) + '">查看该支人物（' + b.count + '）</button>' +
          (bp ? ' <button class="iconbtn" data-openpage="' + bp + '">查看原谱 p' + bp + "</button>" : "") +
          "</div></div>";
      }).join("");
    }

    var genList = Object.keys(GENCNT).map(Number).sort(function (a, b) { return a - b; });
    var gmax = 0, gmaxGen = 0;
    genList.forEach(function (g) { if (GENCNT[g] > gmax) { gmax = GENCNT[g]; gmaxGen = g; } });

    function genRow(g) {
      var anc = ANCHOR[g - 1] && IDX[ANCHOR[g - 1]];
      var hot = (g >= 21 && g <= 24);
      var w = Math.max(3, Math.round(GENCNT[g] / gmax * 100));
      return '<tr title="第' + cn(g) + "世（" + (GENCHAR[g] || "—") + "字派）· " + GENCNT[g] + " 人" + (anc ? " · 本支 " + anc.name : "") + '">' +
        '<td class="g' + (hot ? " hot" : "") + '">' + cn(g) + '世</td>' +
        '<td class="c"><span class="ch">' + esc(GENCHAR[g] || "—") + "</span></td>" +
        '<td class="n"><span class="nb"><i style="width:' + w + '%"></i></span><b' + tattr("第" + cn(g) + "世（" + (GENCHAR[g] || "—") + "）已录入 " + GENCNT[g] + " 人") + ">" + GENCNT[g] + "</b></td>" +
        '<td class="a">' + (anc ? esc(anc.name) : "") + "</td></tr>";
    }
    function genTable(list) {
      return '<table class="gtable"><thead><tr><th class="g">世代</th><th class="c">字派</th><th class="n">已录人数</th><th class="a">本支直系</th></tr></thead>' +
        "<tbody>" + list.map(genRow).join("") + "</tbody></table>";
    }
    var SPLIT = 15;   // 1–15 世（早期，录入尚少） / 16–29 世（本谱主体）
    var genLeft = genList.filter(function (g) { return g <= SPLIT; });
    var genRight = genList.filter(function (g) { return g > SPLIT; });

    /* ---- 承嗣制度 ---- */
    var DVR = D.derive || {};
    var it = DVR.instTotal || {};
    var N = P.length || 1;
    var shangLoose = P.filter(function (p) { return (p.raw || "").indexOf("殇") >= 0; }).length;

    function ic(k, desc) {
      var v = it[k] || 0;
      return '<div class="instcard"' + tattr("「" + k + "」共 " + v + " 人，占全体 " + (100 * v / N).toFixed(1) + "%。" + desc) + '><div class="v">' + v + "</div><div class=\"n\">" + k + "</div>" +
        '<div class="p">占全体 ' + (100 * v / N).toFixed(1) + "%　" + desc + "</div></div>";
    }

    var igRows = (DVR.instByGen || []).filter(function (r) { return r.gen >= 16 && r.gen <= 29; });
    var instTableRows = igRows.map(function (r) {
      var rate = r.total ? 100 * r["止"] / r.total : 0;
      var al = rate ? (0.08 + 0.6 * Math.min(1, rate / 30)) : 0;
      return "<tr><th>" + cn(r.gen) + "世 " + esc(GENCHAR[r.gen] || "") + "</th>" +
        "<td>" + r.total + "</td>" +
        "<td>" + (r["殇"] || "") + "</td>" +
        '<td style="background:rgba(158,43,37,' + al.toFixed(2) + ');color:' + (al > 0.45 ? "#fffdf7" : "inherit") + '"' + tattr(cn(r.gen) + "世（" + (GENCHAR[r.gen] || "") + "）记「止」" + (r["止"] || 0) + " 人（无嗣率 " + rate.toFixed(1) + "%）") + ">" + (r["止"] || "") + "</td>" +
        '<td style="color:var(--gold)">' + (r["出继"] || "") + "</td>" +
        '<td style="color:var(--jade)">' + (r["承继"] || "") + "</td>" +
        "<td>" + rate.toFixed(1) + "%</td></tr>";
    }).join("");

    var gcRows = (DVR.genChar || []).filter(function (r) { return r.gen >= 16 && r.gen <= 29; });
    var gcBars = gcRows.map(function (r) {
      var w = Math.max(4, (r.rate - 90) * 10);
      var full = r.rate >= 99.5;
      return '<div class="barline' + (full ? " jade" : " gold") + '"' + tattr(cn(r.gen) + "世（" + r.char + "）字派遵从率 " + r.rate.toFixed(1) + "%　含字派者 " + r.named + " / " + r.total) + '><span class="lb">' + cn(r.gen) + "世 " + esc(r.char) + "</span>" +
        '<div class="tr"><div class="fl" style="width:' + w.toFixed(1) + '%"></div></div>' +
        '<span class="vl">' + r.rate.toFixed(1) + "%　" + r.named + "/" + r.total + "</span></div>";
    }).join("");

    return '' +
      '<h2 class="sec">世系与房支</h2>' +
      '<p class="sub">全族顶层分「上房 / 中房 / 前房」三大房，由第十二世「思」字派祖先分衍；上房之下再按「思X太位下」分区，本支为「上房·思珞太位下」，第十六世后在本支内称「大义太位下（枫树坪）」。</p>' +

      '<h3 class="blk">三大房与本支定位</h3>' +
      '<div class="card" style="padding:16px 18px">' +
      '<div class="flow">' +
        '<div class="step"><div class="e">全族</div><div class="p">一世</div><div class="m">永健公派</div></div>' +
        '<div class="step"><div class="e">上房</div><div class="p">十二世 思字派</div><div class="m">思珞太位下</div></div>' +
        '<div class="step" style="border-color:var(--accent)"><div class="e" style="color:var(--accent)">本支</div><div class="p">十六世</div><div class="m" style="color:var(--accent);font-weight:700">大义太位下</div></div>' +
        '<div class="step" style="border-color:var(--accent)"><div class="e" style="color:var(--accent)">聚居地</div><div class="p">地名</div><div class="m" style="color:var(--accent)">枫树坪</div></div>' +
      "</div></div>" +

      '<h3 class="blk">世代结构与字派</h3>' +
      '<div class="card" style="padding:14px 18px 12px">' +
      '<div class="gen2col">' + genTable(genLeft) + genTable(genRight) + "</div>" +
      '<p class="small muted" style="margin:12px 0 0">条形长度按该世代已录人数等比绘制（最多为第' + cn(gmaxGen) + "世 " + gmax + " 人）；左栏 1–15 世为早期世代，目前仅本支直系补全，故人数极少。" +
      "「本支直系」为本知识库逐页精读校订的直系祖先（一世永健 → 二十四世枝鹏），红色世次 21–24 世为高祖父至父亲四代。</p>" +
      "</div>" +

      '<h3 class="blk">承嗣制度：殇 · 止 · 出继 · 承继</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">族谱最动人之处，在于它如实记下了这个家族怎样在高生育风险中延续：'
        + '每四位族人就有一位「止」（该支无嗣而断绝），但同时有近千人次通过过继、双祧把香火接续下去。'
        + '这是理解宗族为何能传三十代的钥匙。</p>' +
      '<div class="instgrid">' + ic("殇", "原谱记「殇」，未成年而亡") + ic("止", "本人条目记「止」，无嗣") +
      ic("出继", "过继给他人为嗣，离开本支") + ic("承继", "承继他人为嗣 / 双祧兼祧") + "</div>" +
      '<div class="card" style="padding:14px 18px;margin-top:12px">' +
      '<div style="font-family:var(--serif);font-size:13.5px;color:var(--ink-2);margin-bottom:8px">'
        + '十六至二十九世：逐代人数与承嗣实况</div>' +
      '<div style="overflow-x:auto"><table class="heat" style="min-width:560px"><thead><tr><th>世代</th><th>人数</th>'
        + '<th>殇</th><th>止</th><th>出继</th><th>承继</th><th>无嗣率</th></tr></thead><tbody>' +
      instTableRows + "</tbody></table></div>" +
      '<p class="small muted" style="margin:10px 0 0">「无嗣率」＝该世代记「止」人数 ÷ 该世代已录人数。'
        + '判定规则为<b>本人条目末尾记「止」</b>；父辈条目中记其某子「止」者不计入本人。'
        + '「殇」同理只计本人条目末尾的记载，故偏保守（原文中泛指子嗣夭折的「殇」字样共 ' + shangLoose + ' 处）。</p>' +
      "</div>" +

      '<h3 class="blk">字派遵从曲线</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">字派是宗族的「命名宪法」：同一世代的人共用一字，'
        + '据此可校勘失序的世次。把名字里是否含该世代字派字逐代统计，可见本族执行得极严格——'
        + '<b>十六至二十九世全部在 96% 以上</b>，第二十二、二十三、二十六、二十九世更达 99.6%–100%。'
        + '（刻度自 90% 起，以放大差异。）</p>' +
      '<div class="card" style="padding:14px 18px">' + gcBars + "</div>" +

      '<h3 class="blk">上房 · 房支索引</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">各支按已录人数排列。'
        + '标<b style="color:var(--accent)">红色「本支」</b>者为本文直系所属房支。</p>' + bHtml(roots["上房"]) +
      '<h3 class="blk">中房 · 房支索引</h3>' + bHtml(roots["中房"]) +
      '<h3 class="blk">前房 · 房支索引</h3>' + bHtml(roots["前房"]) +
      (roots["其他"].length ? '<h3 class="blk">其他 / 未标房支</h3>' + bHtml(roots["其他"]) : "");
  };

  /* ===== 世系树 ===== */
  var treeState = { root: null, depth: 8, scale: 1, tx: 0, ty: 0, collapsed: {} };
  var DEPTHS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 99];   // 99 = 全部
  var MAXNODES = 3000;                                     // 单次渲染节点上限，防止卡死
  var NODEW = 150, GENX = 9, NAMEX = 55, TOGX = NODEW - 11;

  function depthOpts(cur) {
    return DEPTHS.map(function (d) {
      return '<option value="' + d + '"' + (d === cur ? " selected" : "") + ">" + (d === 99 ? "全部" : d + " 层") + "</option>";
    }).join("");
  }

  V.tree = function () {
    var defRoot = ANCHOR[15] ? IDX[ANCHOR[15]] : null; // 大义
    if (!treeState.root || !IDX[treeState.root]) treeState.root = defRoot ? defRoot.id : (P[0] && P[0].id);
    return '' +
      '<h2 class="sec">交互式世系树</h2>' +
      '<p class="sub">以任一人物为根向下展开。红色连线为本支直系。单击节点看详传；双击节点，或点节点右侧的 ⊖ / ⊕ 即可展开、收起其子代（层数不够时会自动加深一层）；滚轮缩放，按住拖动平移。</p>' +
      '<div class="toolbar">' +
        '<input type="text" id="troot" list="rootsuggest" placeholder="输入人名设为根节点（如 钟大义 / 林宝 / 世礼）" style="width:268px">' +
        '<datalist id="rootsuggest">' + P.filter(function (p) { return (p.childIds || []).length >= 2; }).slice(0, 400).map(function (p) { return '<option value="' + esc(p.name) + '">' + cn(p.gen) + "世 " + esc(p.name) + "</option>"; }).join("") + "</datalist>" +
        '<label class="small muted">展开层数 <select id="tdepth">' + depthOpts(treeState.depth) + '</select></label>' +
        '<button class="iconbtn" id="tanc">定位本支（大义公）</button>' +
        '<button class="iconbtn" id="tall">展开全部世系</button>' +
        '<button class="iconbtn" id="tshallow">收起到 2 层</button>' +
        '<label class="small muted">房支选根 <select id="tbranch">' +
          '<option value="">（按人名设定）</option>' +
          (function () {
            var ROOTS = ["上房", "中房", "前房", "其他"];
            var byRoot = {};
            (D.branches || []).forEach(function (b) { (byRoot[b.root] = byRoot[b.root] || []).push(b); });
            return ROOTS.map(function (r) {
              var list = (byRoot[r] || []).slice().sort(function (a, b) { return b.count - a.count; });
              if (!list.length) return "";
              return '<optgroup label="' + esc(r) + '">' + list.map(function (b) {
                return '<option value="' + esc(b.name) + '">' + esc(b.name.length > 26 ? b.name.slice(0, 26) + "…" : b.name) + "（" + b.count + "）</option>";
              }).join("") + "</optgroup>";
            }).join("");
          })() +
        '</select></label>' +
        '<span class="small muted" id="tinfo" style="margin-left:auto"></span>' +
      '</div>' +
      '<div class="treewrap" id="treewrap"><svg id="treesvg"></svg>' +
        '<div class="treezoom">' +
          '<button class="iconbtn" id="tzin" title="放大">＋</button>' +
          '<button class="iconbtn" id="tzout" title="缩小">－</button>' +
          '<button class="iconbtn" id="tzfit" title="重置视图（回到 1:1）">⟲</button>' +
          '<button class="iconbtn" id="tzfull" title="全屏展开">⤢</button>' +
          '<button class="iconbtn" id="tzpng" title="导出高清 PNG 图片">⤓</button>' +
        '</div>' +
        '<div class="nodepanel" id="nodepanel"></div></div>';
  };

  /* 设定展开层数并同步下拉框 */
  function setDepth(d) {
    treeState.depth = d;
    var s = $("#tdepth");
    if (s) {
      var hit = DEPTHS.filter(function (x) { return x === d; })[0];
      if (!hit) {
        var o = document.createElement("option");
        o.value = String(d); o.textContent = d + " 层";
        s.appendChild(o);
      }
      s.value = String(d);
    }
    drawTree();
  }
  function nextDepthFor(lv) {
    for (var i = 0; i < DEPTHS.length; i++) if (DEPTHS[i] >= lv + 1) return DEPTHS[i];
    return 99;
  }

  function buildTree(rootId) {
    var depth = treeState.depth;
    var nodes = [], links = [], visited = {};
    var leafY = 0, capped = false;
    var COLW = 172, ROWH = 30;
    var maxKids = 40;

    function walk(id, lv, parentIdx) {
      if (lv > depth || visited[id]) return null;
      if (nodes.length >= MAXNODES) { capped = true; return null; }
      var p = IDX[id];
      if (!p) return null;
      visited[id] = true;
      var idx = nodes.length;
      nodes.push({ p: p, x: lv * COLW, y: 0, idx: idx, parent: parentIdx, lv: lv, cut: false, w: NODEW });
      if (parentIdx >= 0) links.push([parentIdx, idx]);
      var kids = (p.childIds || []).slice(0, maxKids);
      var cut = false;
      if (levelCollapsed(id)) kids = [];
      else if (kids.length && lv + 1 > depth) { kids = []; cut = true; }
      var childIdx = [];
      kids.forEach(function (cid) { var r = walk(cid, lv + 1, idx); if (r !== null) childIdx.push(r); });
      var n = nodes[idx];
      n.cut = cut;
      if (childIdx.length) {
        var ys = childIdx.map(function (ci) { return nodes[ci].y; });
        n.y = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
        n.kids = childIdx;
      } else {
        n.y = leafY; leafY += ROWH;
      }
      return idx;
    }
    function levelCollapsed(id) { return !!treeState.collapsed[id]; }
    walk(rootId, 0, -1);
    return { nodes: nodes, links: links, COLW: COLW, ROWH: ROWH, capped: capped };
  }

  /* 生成世系树 SVG 内部标记（不含 tzoom 变换），供 drawTree 与导出复用 */
  function buildTreeMarkup() {
    var g = buildTree(treeState.root);
    var nodes = g.nodes, links = g.links;
    var byId = {};
    nodes.forEach(function (n) { byId[n.p.id] = n; });
    var maxY = 0, maxX = 0;
    nodes.forEach(function (n) { if (n.y > maxY) maxY = n.y; if (n.x > maxX) maxX = n.x; });
    var pad = 40;
    var W = maxX + NODEW + 80 + pad, H = maxY + 60 + pad;

    var linkSvg = links.map(function (l) {
      var a = nodes[l[0]], b = nodes[l[1]];
      var x1 = a.x + NODEW, y1 = a.y + 13, x2 = b.x, y2 = b.y + 13;
      var mx = (x1 + x2) / 2;
      var hot = onAnchorChain(a.p.id, b.p.id);
      return '<path d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ',' + mx + ' ' + y2 + ',' + x2 + ' ' + y2 + '" fill="none" stroke="' +
        (hot ? "var(--accent)" : "var(--line-2)") + '" stroke-width="' + (hot ? 2 : 1) + '" opacity="' + (hot ? ".95" : ".7") + '"/>';
    }).join("");

    var nodeSvg = nodes.map(function (n) {
      var p = n.p;
      var isA = p.anc && ANCHOR_SET[p.id];
      var hasKids = (p.childIds || []).length > 0;
      var open = !(treeState.collapsed[p.id] || n.cut);
      var nm = p.name.length > 5 ? p.name.slice(0, 5) : p.name;
      return '<g transform="translate(' + n.x + ',' + n.y + ')" data-node="' + esc(p.id) + '" class="tnode">' +
        '<rect class="nb" width="' + NODEW + '" height="26" rx="3" fill="' + (isA ? "var(--accent-soft)" : "var(--surface)") + '" stroke="' + (isA ? "var(--accent)" : "var(--line-2)") + '" stroke-width="' + (isA ? 1.6 : 1) + '"/>' +
        '<text x="' + GENX + '" y="17.5" font-size="10" fill="' + (isA ? "var(--accent)" : "var(--ink-3)") + '" font-family="var(--serif)">' + cn(p.gen) + "世</text>" +
        '<text x="' + NAMEX + '" y="18" font-size="14" fill="' + (isA ? "var(--accent)" : "var(--ink)") + '" font-family="var(--serif)"' + (isA ? ' font-weight="700"' : "") + '>' + esc(nm) + "</text>" +
        (hasKids ? '<g class="tog" data-tog="' + esc(p.id) + '" data-lv="' + n.lv + '">' +
            '<circle cx="' + TOGX + '" cy="13" r="8" fill="' + (!open ? "var(--ink-3)" : "var(--jade)") + '" opacity=".22"/>' +
            '<circle cx="' + TOGX + '" cy="13" r="12" fill="transparent"/>' +
            '<text x="' + TOGX + '" y="17" text-anchor="middle" font-size="11" fill="' + (!open ? "var(--ink-3)" : "var(--jade)") + '">' + (open ? "−" : "+") + "</text></g>" : "") +
        "</g>";
    }).join("");

    return { markup: linkSvg + nodeSvg, W: W, H: H, pad: pad, nodes: nodes, links: links, capped: g.capped };
  }

  function drawTree() {
    var svg = $("#treesvg"); if (!svg) return;
    var m = buildTreeMarkup();
    svg.setAttribute("viewBox", (-m.pad + " " + -m.pad + " " + (m.W + m.pad) + " " + (m.H + m.pad)));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = '<g id="tzoom" transform="translate(' + treeState.tx + ',' + treeState.ty + ') scale(' + treeState.scale + ')">' + m.markup + "</g>";
    var byId = {}; m.nodes.forEach(function (n) { byId[n.p.id] = n; });
    var info = $("#tinfo");
    if (info) info.textContent = "共 " + m.nodes.length + " 个节点 / " + m.links.length + " 条关系　根：" + (IDX[treeState.root] || {}).name +
      "　展开 " + (treeState.depth >= 99 ? "全部" : treeState.depth + " 层") + (m.capped ? "（已达 " + MAXNODES + " 节点上限）" : "");
    bindTreeEvents(byId);
  }

  /* 全屏展开：CSS 覆盖层（不依赖浏览器 Fullscreen API，App 内嵌壳也适用），Esc 退出 */
  function toggleTreeFull() {
    var wrap = $("#treewrap"); if (!wrap) return;
    var on = wrap.classList.toggle("full");
    var btn = $("#tzfull");
    if (btn) { btn.textContent = on ? "✕" : "⤢"; btn.title = on ? "退出全屏" : "全屏展开"; }
    treeState.tx = 0; treeState.ty = 0; treeState.scale = 1;
    drawTree();
    if (on && !window.__treeFsKey) {
      window.__treeFsKey = function (e) {
        if (e.key === "Escape") { var w = $("#treewrap"); if (w && w.classList.contains("full")) toggleTreeFull(); }
      };
      window.addEventListener("keydown", window.__treeFsKey);
    }
  }

  /* 导出高清 PNG：序列化 SVG → 内联 CSS 变量（独立 SVG 无法解析 var()）→ canvas 放大绘制 → 下载 */
  function exportTreePng() {
    var info = $("#tinfo");
    try {
      var m = buildTreeMarkup();
      var W = m.W + m.pad, H = m.H + m.pad;
      var cs = getComputedStyle(document.documentElement);
      function rv(n) { return cs.getPropertyValue(n).trim().replace(/"/g, "'"); }
      var vars = { "--accent": rv("--accent"), "--accent-soft": rv("--accent-soft"), "--surface": rv("--surface"),
        "--line-2": rv("--line-2"), "--ink": rv("--ink"), "--ink-3": rv("--ink-3"), "--jade": rv("--jade"), "--serif": rv("--serif") };
      var markup = m.markup.replace(/var\((--[\w-]+)\)/g, function (_, n) { return vars[n] != null ? vars[n] : n; });
      var svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + (-m.pad) + ' ' + (-m.pad) + ' ' + W + ' ' + H + '">' +
        '<rect x="' + (-m.pad) + '" y="' + (-m.pad) + '" width="' + W + '" height="' + H + '" fill="#ffffff"/>' + markup + "</svg>";
      var blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var scale = Math.max(1.5, Math.min(4, Math.round(3000 / Math.max(W, H))));
        var cw = Math.round(W * scale), ch = Math.round(H * scale);
        var canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(function (b) {
          if (!b) { if (info) info.textContent = "导出失败：画布编码错误"; URL.revokeObjectURL(url); return; }
          var a = document.createElement("a");
          var rootName = (IDX[treeState.root] || {}).name || "root";
          a.download = "钟氏族谱_世系树_" + rootName + "_" + (treeState.depth >= 99 ? "全部" : treeState.depth + "层") + ".png";
          a.href = URL.createObjectURL(b);
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          if (info) info.textContent = "已导出 PNG（" + cw + "×" + ch + " px）";
        }, "image/png");
      };
      img.onerror = function () { if (info) info.textContent = "导出失败：图片解码错误"; URL.revokeObjectURL(url); };
      img.src = url;
    } catch (err) {
      if (info) info.textContent = "导出失败：" + (err && err.message ? err.message : err);
    }
  }

  function onAnchorChain(a, b) {
    var ia = ANCHOR.indexOf(a), ib = ANCHOR.indexOf(b);
    return ia >= 0 && ib >= 0 && ib === ia + 1;
  }

  /* 展开/收起节点：被层数截断的节点点击时自动加深一层 */
  function toggleTreeNode(id, byId) {    var n = byId && byId[id];
    if (n && n.cut) setDepth(nextDepthFor(n.lv));
    else {
      treeState.collapsed[id] = !treeState.collapsed[id];
      drawTree();
    }
  }

  function zoomBy(k) {
    var svg = $("#treesvg"); if (!svg) return;
    var v = (svg.getAttribute("viewBox") || "0 0 100 100").trim().split(/[\s,]+/).map(Number);
    var cx = (v[0] || 0) + (v[2] || 100) / 2, cy = (v[1] || 0) + (v[3] || 100) / 2;
    var ns = Math.max(.2, Math.min(3.4, treeState.scale * k));
    var ratio = ns / treeState.scale;
    treeState.tx = cx - (cx - treeState.tx) * ratio;
    treeState.ty = cy - (cy - treeState.ty) * ratio;
    treeState.scale = ns;
    var z = $("#tzoom");
    if (z) z.setAttribute("transform", "translate(" + treeState.tx + "," + treeState.ty + ") scale(" + treeState.scale + ")");
  }

  function bindTreeEvents(byId) {
    var svg = $("#treesvg");
    if (!svg) return;
    function getVB() {
      var v = (svg.getAttribute("viewBox") || "0 0 100 100").trim().split(/[\s,]+/).map(Number);
      var r = svg.getBoundingClientRect();
      return { x: v[0] || 0, y: v[1] || 0, w: v[2] || 100, h: v[3] || 100, rw: Math.max(1, r.width), rh: Math.max(1, r.height) };
    }
    function applyT() {
      var z = $("#tzoom");
      if (z) z.setAttribute("transform", "translate(" + treeState.tx + "," + treeState.ty + ") scale(" + treeState.scale + ")");
    }
    var dragging = false, sx = 0, sy = 0, s0x = 0, s0y = 0;
    svg.onmousedown = function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY; s0x = treeState.tx; s0y = treeState.ty;
      e.preventDefault();
    };
    window.onmouseup = function () { dragging = false; };
    svg.onmousemove = function (e) {
      if (!dragging) return;
      var v = getVB(), f = v.w / v.rw;
      treeState.tx = s0x + (e.clientX - sx) * f;
      treeState.ty = s0y + (e.clientY - sy) * f;
      applyT();
    };
    svg.onwheel = function (e) {
      e.preventDefault();
      var v = getVB();
      var k = e.deltaY < 0 ? 1.13 : 1 / 1.13;
      var ns = Math.max(.2, Math.min(3.4, treeState.scale * k));
      var r = svg.getBoundingClientRect();
      var cx = v.x + (e.clientX - r.left) * (v.w / v.rw);
      var cy = v.y + (e.clientY - r.top) * (v.h / v.rh);
      var ratio = ns / treeState.scale;
      treeState.tx = cx - (cx - treeState.tx) * ratio;
      treeState.ty = cy - (cy - treeState.ty) * ratio;
      treeState.scale = ns;
      applyT();
    };
    $$("[data-tog]", svg).forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        toggleTreeNode(el.getAttribute("data-tog"), byId);
      };
    });
    $$("[data-node]", svg).forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        showNode(el.getAttribute("data-node"));
      };
      el.ondblclick = function (e) {
        e.stopPropagation();
        toggleTreeNode(el.getAttribute("data-node"), byId);
      };
    });
  }

  function showNode(id) {
    var p = IDX[id]; if (!p) return;
    var pn = $("#nodepanel"); if (!pn) return;
    var fa = p.fatherId && IDX[p.fatherId] ? IDX[p.fatherId] : null;
    pn.innerHTML = '<span class="close" id="pnclose">✕</span>' +
      "<h4>" + esc(p.name) + "</h4>" +
      '<div class="small muted" style="margin-bottom:8px">' + cn(p.gen) + "世" + (p.alias ? "　" + esc(p.alias) : "") + (p.rank ? "　" + esc(p.rank) : "") + "</div>" +
      '<div class="kv" style="grid-template-columns:44px 1fr">' +
        (fa ? '<div class="k">父</div><div class="v"><a href="javascript:;" data-jump="' + esc(fa.id) + '">' + esc(fa.name) + "</a></div>" : "") +
        (p.birth ? '<div class="k">生</div><div class="v">' + esc(p.birth) + (p.birthYear ? "（" + p.birthYear + "）" : "") + "</div>" : "") +
        (p.death ? '<div class="k">殁</div><div class="v">' + esc(p.death) + "</div>" : "") +
        (p.spouses && p.spouses.length ? '<div class="k">配</div><div class="v">' + p.spouses.map(function (s) { return esc(s.n); }).join("、") + "</div>" : "") +
        '<div class="k">房支</div><div class="v small">' + esc(p.branch) + "</div>" +
      "</div>" +
      ((p.childIds || []).length ? '<div style="margin-top:9px"><div class="lb small muted">子（' + p.childIds.length + "）</div>" +
        '<div class="kids">' + p.childIds.map(function (c) { var q = IDX[c]; return q ? '<span class="kid" data-jump="' + esc(c) + '">' + esc(q.name) + "</span>" : ""; }).join("") + "</div></div>" : "") +
      (p.raw ? '<div class="raw" style="font-size:12px;margin-top:10px">' + esc(p.raw) + "</div>" : "") +
      '<div style="margin-top:10px;display:flex;gap:6px"><button class="iconbtn" data-jump="' + esc(p.id) + '" data-setroot="1">设为根</button>' +
      '<button class="iconbtn" data-openpage="' + esc(num(p.page)) + '">原谱 p' + esc(num(p.page)) + "</button></div>";
    pn.classList.add("show");
    $("#pnclose").onclick = function () { pn.classList.remove("show"); };
    $$("[data-jump]", pn).forEach(function (el) {
      el.onclick = function () {
        var j = el.getAttribute("data-jump");
        if (el.getAttribute("data-setroot")) { treeState.root = j; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; drawTree(); }
        showNode(j);
      };
    });
    $$("[data-openpage]", pn).forEach(function (el) {
      el.onclick = function () { openViewer(parseInt(el.getAttribute("data-openpage"), 10)); };
    });
  }

  /* ===== 人物检索 ===== */
  var pState = { q: "", gen: "", branch: "", conf: "", inst: "", year: false, bury: false, anc: false, page: 1, per: 60 };
  var TAGCLS = { "殇": "shang", "止": "zhi", "出继": "chu", "承继": "cheng" };
  var CONFLB = { high: "高", medium: "中", low: "低" };

  function confDot(c) {
    if (!CONFLB[c]) return "";
    return '<span class="conf ' + c + '" title="转录置信度：' + CONFLB[c] + '"></span>';
  }
  function instTags(arr) {
    if (!arr || !arr.length) return "";
    return arr.map(function (k) {
      return '<span class="tagx ' + (TAGCLS[k] || "") + '" title="承嗣制度：' + k + '">' + k + "</span>";
    }).join("");
  }

  V.people = function () {
    var gens = Object.keys(GENCNT).map(Number).sort(function (a, b) { return a - b; });
    var cd = (D.derive || {}).confDist || {};
    return '' +
      '<h2 class="sec">人物检索</h2>' +
      '<p class="sub">共 ' + P.length + ' 位已录入人物，可按姓名、字号、世代、房支、置信度与承嗣制度检索。' +
        '<span class="conf high"></span>高 ' + (cd.high || 0) + "　" +
        '<span class="conf medium"></span>中 ' + (cd.medium || 0) + "　" +
        '<span class="conf low"></span>低 ' + (cd.low || 0) +
        '　（置信度＝转录可靠程度，影印模糊处一律以「□」占位，未作臆测）</p>' +
      '<div class="toolbar">' +
        '<input type="text" id="pq" placeholder="搜索姓名 / 字号 / 原文关键字" style="width:280px">' +
        '<select id="pgen"><option value="">全部世代</option>' + gens.map(function (g) { return '<option value="' + g + '">' + cn(g) + "世（" + (GENCHAR[g] || "") + "）</option>"; }).join("") + "</select>" +
        '<select id="pbranch"><option value="">全部房支</option>' + (D.branches || []).map(function (b) { return '<option value="' + esc(b.name) + '">' + esc(b.name.length > 30 ? b.name.slice(0, 30) + "…" : b.name) + "（" + b.count + "）</option>"; }).join("") + "</select>" +
      "</div>" +
      '<div class="toolbar">' +
        '<label class="small muted">置信度 <select id="pconf">' +
          '<option value="">全部</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>' +
        "</select></label>" +
        '<label class="small muted">承嗣 <select id="pinst">' +
          '<option value="">全部</option><option value="殇">记「殇」</option><option value="止">记「止」</option>' +
          '<option value="出继">出继</option><option value="承继">承继 / 双祧</option>' +
        "</select></label>" +
        '<label class="small muted"><input type="checkbox" id="pyear"> 有明确生年</label>' +
        '<label class="small muted"><input type="checkbox" id="pbury"> 有葬地记载</label>' +
        '<label class="small muted"><input type="checkbox" id="panc"> 仅本支直系</label>' +
        '<span class="sp" style="flex:1"></span>' +
        '<button class="iconbtn" id="pexport">导出 CSV</button>' +
        '<button class="iconbtn" id="pprint">打印世系表</button>' +
        '<span class="small muted" id="pcount"></span>' +
      '</div>' +
      '<div class="plist" id="plist"></div>' +
      '<div class="pager" id="ppager"></div>';
  };

  function filterPersons() {
    var q = pState.q.trim();
    return P.filter(function (p) {
      if (pState.gen && String(p.gen) !== pState.gen) return false;
      if (pState.branch && p.branch !== pState.branch) return false;
      if (pState.anc && !p.anc) return false;
      if (pState.conf && (p.conf || "") !== pState.conf) return false;
      if (pState.inst && (p.inst || []).indexOf(pState.inst) < 0) return false;
      if (pState.year && !p.birthYear) return false;
      if (pState.bury && !p.bp) return false;
      if (q) {
        var hay = (p.name || "") + (p.alias || "") + (p.raw || "") + (p.notes || "") + (p.father || "");
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderPeople() {
    var list = filterPersons();
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / pState.per));
    if (pState.page > pages) pState.page = pages;
    var slice = list.slice((pState.page - 1) * pState.per, pState.page * pState.per);
    var $l = $("#plist");
    if (!$l) return;
    $l.innerHTML = slice.length ? slice.map(function (p) {
      return '<div class="card pcard' + (p.anc ? " anc" : "") + '" data-id="' + esc(p.id) + '">' +
        '<div class="t">' + confDot(p.conf) + '<span class="nm">' + esc(p.name) + '</span><span class="g">' + cn(p.gen) + "世</span>" +
        (p.alias ? '<span class="small muted">' + esc(p.alias) + "</span>" : "") + "</div>" +
        '<div class="b">' + esc((p.birth || "生殁失考")) + (p.birthYear ? "（" + p.birthYear + "）" : "") + instTags(p.inst) + "</div>" +
        '<div class="b" style="color:var(--ink-3)">' + esc((p.branch || "").slice(0, 34)) + "</div>" +
        (p.father ? '<div class="b">父：' + esc(p.father) + "</div>" : "") +
        (p.bp ? '<div class="b" style="color:var(--gold)">葬　' + esc(p.bp) + (p.bx ? "　" + esc(p.bx) : "") + "</div>" : "") +
        "</div>";
    }).join("") : '<p class="muted">未找到匹配人物。</p>';
    $("#pcount").textContent = "匹配 " + total + " 人　第 " + pState.page + "/" + pages + " 页";
    var pg = $("#ppager");
    pg.innerHTML = pages > 1 ? '<button class="iconbtn" data-pg="1">首页</button>' +
      '<button class="iconbtn" data-pg="' + Math.max(1, pState.page - 1) + '">上一页</button>' +
      '<span>第 ' + pState.page + " / " + pages + " 页</span>" +
      '<button class="iconbtn" data-pg="' + Math.min(pages, pState.page + 1) + '">下一页</button>' +
      '<button class="iconbtn" data-pg="' + pages + '">末页</button>' : "";
    $$("[data-pg]", pg).forEach(function (b) { b.onclick = function () { pState.page = parseInt(b.getAttribute("data-pg"), 10); renderPeople(); window.scrollTo({ top: 180, behavior: "smooth" }); }; });
    $$(".pcard", $l).forEach(function (c) { c.onclick = function () { openPerson(c.getAttribute("data-id")); }; });
  }

  function openPerson(id) {
    var p = IDX[id]; if (!p) return;
    var wrap = document.createElement("div");
    wrap.className = "viewer show";
    var fa = p.fatherId && IDX[p.fatherId] ? IDX[p.fatherId] : null;
    wrap.innerHTML = '<div class="vbar" style="background:rgba(0,0,0,.2)">' +
      '<b style="font-family:var(--serif);font-size:16px">' + esc(p.name) + "　" + cn(p.gen) + "世</b>" +
      '<span class="sp"></span><button data-close>关闭</button></div>' +
      '<div class="vbody"><div style="max-width:720px;width:100%;background:var(--surface);padding:26px 30px;border-radius:3px;color:var(--ink)">' +
      '<div style="font-family:var(--serif);font-size:30px;letter-spacing:.1em">' + esc(p.name) +
      (p.inst && p.inst.length ? '<span style="font-size:15px;margin-left:10px">' + instTags(p.inst) + "</span>" : "") + "</div>" +
      '<div class="small muted" style="margin:4px 0 16px">' + cn(p.gen) + "世" + (p.alias ? "　" + esc(p.alias) : "") + (p.rank ? "　" + esc(p.rank) : "") + "　" + esc(p.branch) + "</div>" +
      '<div class="kv" style="grid-template-columns:56px 1fr">' +
        (fa ? '<div class="k">父</div><div class="v">' + esc(fa.name) + "（" + cn(fa.gen) + "世）</div>" : "") +
        (p.birth ? '<div class="k">生</div><div class="v">' + esc(p.birth) + (p.birthYear ? "（公元 " + p.birthYear + "）" : "") + "</div>" : "") +
        (p.death ? '<div class="k">殁</div><div class="v">' + esc(p.death) + "</div>" : "") +
        (p.spouses && p.spouses.length ? '<div class="k">配</div><div class="v">' + p.spouses.map(function (s) { return esc(s.n) + (s.note ? '<span class="muted small">（' + esc(s.note) + "）</span>" : ""); }).join("<br>") + "</div>" : "") +
        (p.burial ? '<div class="k">葬</div><div class="v">' + esc(p.burial) +
          (p.bp ? '<div class="small" style="color:var(--gold);margin-top:3px">归入茔域：' + esc(p.bp) + (p.bx ? "　形胜 " + esc(p.bx) : "") + (p.bq ? "　" + esc(p.bq) : "") + "</div>" : "") + "</div>" : "") +
        (p.notes ? '<div class="k">附注</div><div class="v">' + esc(p.notes) + "</div>" : "") +
        '<div class="k">原谱</div><div class="v">PDF 第 ' + esc(num(p.page)) + " 页" + (p.bookPage ? "（原书 p." + esc(p.bookPage) + "）" : "") +
          "　" + confDot(p.conf) + "置信度 " + esc(CONFLB[p.conf] || p.conf || "—") + "</div>" +
      "</div>" +
      ((p.kids || []).length ? '<div style="margin-top:14px"><div class="lb small muted">子嗣</div><div class="kids">' + p.kids.map(function (k) { return '<span class="kid' + (k.g === "F" ? " f" : "") + '">' + esc(k.n || "（未名）") + (k.r ? '<span class="t">' + esc(k.r) + "</span>" : "") + "</span>"; }).join("") + "</div></div>" : "") +
      (p.raw ? '<div class="raw" style="margin-top:16px">' + esc(p.raw) + "</div>" : "") +
      "</div></div>";
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.querySelector("[data-close]").onclick = close;
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
  }

  /* CSV 转义（含 BOM 以便 Excel 正确显示中文） */
  function csvCell(v) {
    v = v == null ? "" : String(v);
    if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  /* 导出人物检索当前筛选结果为 CSV（含 BOM），可直接用 Excel 打开 */
  function exportPersonsCSV() {
    var list = filterPersons();
    var cols = [
      ["世代", function (p) { return p.gen || ""; }],
      ["字派", function (p) { return GENCHAR[p.gen] || ""; }],
      ["姓名", function (p) { return p.name || ""; }],
      ["字号", function (p) { return p.alias || ""; }],
      ["房支", function (p) { return p.branch || ""; }],
      ["父", function (p) { return p.father || ""; }],
      ["生", function (p) { return p.birth || ""; }],
      ["生年(公元)", function (p) { return p.birthYear || ""; }],
      ["殁", function (p) { return p.death || ""; }],
      ["葬地(归一)", function (p) { return p.bp || ""; }],
      ["形胜", function (p) { return p.bx || ""; }],
      ["山向", function (p) { return p.bq || ""; }],
      ["承嗣", function (p) { return (p.inst || []).join("、"); }],
      ["置信度", function (p) { return CONFLB[p.conf] || p.conf || ""; }],
      ["原谱页", function (p) { return num(p.page); }]
    ];
    var rows = [cols.map(function (c) { return csvCell(c[0]); }).join(",")];
    list.forEach(function (p) {
      rows.push(cols.map(function (c) { return csvCell(c[1](p)); }).join(","));
    });
    var csv = "﻿" + rows.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "钟氏族谱_人物检索_" + list.length + "人.csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
  }

  /* 打印世系表：把当前筛选结果渲染为可打印表格（仅打印该表） */
  function printPersons() {
    var list = filterPersons();
    var cols = [
      ["世", function (p) { return cn(p.gen); }],
      ["字派", function (p) { return GENCHAR[p.gen] || ""; }],
      ["姓名", function (p) { return p.name || ""; }],
      ["字号", function (p) { return p.alias || ""; }],
      ["房支", function (p) { return p.branch || ""; }],
      ["生", function (p) { return p.birth || ""; }],
      ["生年", function (p) { return p.birthYear || ""; }],
      ["殁", function (p) { return p.death || ""; }],
      ["葬地", function (p) { return (p.bp || "") + (p.bx ? " " + p.bx : "") + (p.bq ? " " + p.bq : ""); }],
      ["承嗣", function (p) { return (p.inst || []).join("、"); }],
      ["页", function (p) { return num(p.page); }]
    ];
    var html = '<table class="pt"><thead><tr>' + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") +
      "</tr></thead><tbody>" + list.map(function (p) {
        return "<tr>" + cols.map(function (c) { return "<td>" + esc(String(c[1](p))) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
    var box = document.getElementById("printbox");
    if (!box) { box = document.createElement("div"); box.id = "printbox"; box.className = "printbox"; document.body.appendChild(box); }
    box.innerHTML = '<h2>瑞金颍川信义钟氏七修族谱 · 人物检索（' + list.length + ' 人）</h2>' + html;
    window.print();
  }

  /* ===== 原谱浏览 ===== */
  var vState = { page: 1 };
  V.archive = function () {
    return '' +
      '<h2 class="sec">原谱浏览</h2>' +
      '<p class="sub">整本族谱 1210 个扫描页全部可查阅（每页含左右两个原书页）。点击任一缩略图进入大图查看器。</p>' +
      '<h3 class="blk">关键页直达</h3>' +
      '<div class="fa">' + KEYPAGES.map(function (k) {
        return '<div class="i' + (/★/.test(k.t) ? " key" : "") + '" data-openpage="' + k.p + '" style="cursor:pointer"><span class="g">p' + k.p + '</span><span class="n">' + esc(k.t.replace("★", "")) + "</span><span class=\"t\">" + esc(k.d) + "</span></div>";
      }).join("") + "</div>" +
      '<h3 class="blk">按卷浏览</h3>' +
      '<div class="toolbar">' +
        '<select id="vvol">' + VOLS.map(function (v, i) { return '<option value="' + i + '">' + esc(v.name) + "（p" + v.a + "–" + v.b + "）</option>"; }).join("") + "</select>" +
        '<span class="small muted" id="vnote"></span>' +
        '<span class="sp" style="flex:1"></span>' +
        '<label class="small muted">跳转页码 <input type="number" id="vjump" min="1" max="1210" style="width:80px"></label>' +
        '<button class="iconbtn" id="vgo">跳转</button>' +
      '</div>' +
      '<div class="thumbs" id="vthumbs"></div>';
  };

  function renderThumbs(volIdx) {
    var v = VOLS[volIdx || 0];
    var box = $("#vthumbs"); if (!box) return;
    $("#vnote").textContent = v.note;
    var html = [];
    for (var i = v.a; i <= v.b; i++) {
      var key = KEYPAGES.filter(function (k) { return k.p === i; })[0];
      html.push('<div class="th" data-p="' + i + '">' +
        (key ? '<span class="mark">' + (/★/.test(key.t) ? "本支" : "关键") + "</span>" : "") +
        '<img loading="lazy" src="assets/thumbs/p' + pad4(i) + '.jpg" alt="p' + i + '">' +
        '<div class="lb"><span>p' + i + "</span><span>" + esc(v.name) + "</span></div></div>");
    }
    box.innerHTML = html.join("");
    $$(".th", box).forEach(function (t) { t.onclick = function () { openViewer(parseInt(t.getAttribute("data-p"), 10)); }; });
  }
  function pad4(n) { return ("0000" + n).slice(-4); }

  function openViewer(page) {
    if (!page || page < 1 || page > 1210) return;
    vState.page = page;
    var v = $("#viewer");
    if (!v) {
      v = document.createElement("div");
      v.className = "viewer"; v.id = "viewer";
      v.innerHTML = '<div class="vbar">' +
        '<button id="vprev">‹ 上一页</button><button id="vnext">下一页 ›</button>' +
        '<input type="number" id="vpg" min="1" max="1210" style="width:82px">' +
        '<span id="vinfo" style="opacity:.75"></span>' +
        '<span class="sp"></span>' +
        '<button id="vzoomout">－</button><button id="vzoomin">＋</button>' +
        '<button id="vclose">关闭 ✕</button>' +
        '</div><div class="vbody"><img id="vimg" alt=""></div>';
      document.body.appendChild(v);
      v.querySelector("#vclose").onclick = function () { v.classList.remove("show"); };
      v.querySelector("#vprev").onclick = function () { openViewer(vState.page - 1); };
      v.querySelector("#vnext").onclick = function () { openViewer(vState.page + 1); };
      v.querySelector("#vpg").onchange = function () { openViewer(parseInt(this.value, 10)); };
      var z = 1;
      v.querySelector("#vzoomin").onclick = function () { z = Math.min(4, z * 1.25); applyZoom(v, z); };
      v.querySelector("#vzoomout").onclick = function () { z = Math.max(.3, z / 1.25); applyZoom(v, z); };
      v.onclick = function (e) { if (e.target === v) v.classList.remove("show"); };
      /* 键盘翻页：←/→ 翻页，+/− 缩放，Esc 关闭；表单内不拦截方向键 */
      document.addEventListener("keydown", function (e) {
        if (!v.classList.contains("show")) return;
        var tag = (e.target && e.target.tagName) || "";
        var inField = /INPUT|TEXTAREA|SELECT/.test(tag);
        if (e.key === "Escape") { v.classList.remove("show"); return; }
        if (inField) return;
        if (e.key === "ArrowLeft") { e.preventDefault(); openViewer(vState.page - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); openViewer(vState.page + 1); }
        else if (e.key === "+" || e.key === "=") { z = Math.min(4, z * 1.25); applyZoom(v, z); }
        else if (e.key === "-" || e.key === "_") { z = Math.max(.3, z / 1.25); applyZoom(v, z); }
      });
      v._z = 1;
    }
    function applyZoom(el, zz) {
      el._z = zz;
      var img = el.querySelector("#vimg");
      img.style.width = (zz * 100) + "%";
      img.style.maxWidth = zz <= 1 ? "100%" : "none";
    }
    var vv = VOLS.filter(function (x) { return page >= x.a && page <= x.b; })[0] || { name: "—", note: "" };
    v.classList.add("show");
    v.querySelector("#vpg").value = page;
    v.querySelector("#vinfo").textContent = vv.name + "　" + vv.note;
    var img = v.querySelector("#vimg");
    img.src = "assets/pages/p" + pad4(page) + ".jpg";
    v.querySelector(".vbody").scrollTop = 0;
    try { history.replaceState(null, "", "#/archive?p=" + page); } catch (e) {}
  }

  /* ===== 过继承嗣关系网络 ===== */
  V.adoption = function () {
    var bOpts = '<option value="">全部房支</option>' + Object.keys(BRANCH_FLOW).sort(function (a, b) {
      return (BRANCH_FLOW[b].out + BRANCH_FLOW[b].in) - (BRANCH_FLOW[a].out + BRANCH_FLOW[a].in);
    }).map(function (b) {
      var f = BRANCH_FLOW[b];
      return '<option value="' + esc(b) + '">' + esc(b.length > 30 ? b.slice(0, 30) + "…" : b) + '（出' + f.out + '/入' + f.in + '）</option>';
    }).join("");

    var flowRows = Object.keys(BRANCH_FLOW).map(function (b) {
      var f = BRANCH_FLOW[b]; return { b: b, t: f.out + f.in, out: f.out, in: f.in };
    }).sort(function (a, b) { return b.t - a.t; }).slice(0, 18);
    var maxT = Math.max.apply(null, flowRows.map(function (r) { return r.t; }).concat([1]));
    var flowSvg = flowRows.map(function (r) {
      var wo = Math.max(3, Math.round(r.out / maxT * 210)), wi = Math.max(3, Math.round(r.in / maxT * 210));
      return '<div class="flowrow"><span class="fl" style="width:' + wo + 'px">' + r.out + '</span>' +
        '<span class="nm">' + esc(r.b.length > 22 ? r.b.slice(0, 22) + "…" : r.b) + '</span>' +
        '<span class="fr" style="width:' + wi + 'px">' + r.in + '</span></div>';
    }).join("");

    var nNodes = Object.keys(ADOPT_NODE).length;
    var genList = Object.keys(ADOPT_NODE).map(function (id) { return IDX[id] ? (IDX[id].gen || 0) : 0; }).filter(Boolean);
    var genSpan = genList.length ? ("贯穿第" + cn(Math.min.apply(null, genList)) + "世至第" + cn(Math.max.apply(null, genList)) + "世") : "（数据较少）";
    return '' +
      '<h2 class="sec">过继承嗣关系网络</h2>' +
      '<p class="sub">族谱以「承继 / 双祧 / 出继」维系宗族绵续：无嗣者以兄弟之子为嗣，兼祧两房者称「双祧」。本图以原文「为嗣」句式解析还原 <b>' + ADOPT.length + '</b> 条过继关系（嗣父 → 嗣子），共涉 <b>' + nNodes + '</b> 人，' + genSpan + '。</p>' +
      '<div class="grid g4">' +
        stat(String(ADOPT.length), "过继关系边", "嗣父 → 嗣子，已解析到具体人物") +
        stat(String(nNodes), "涉及人物", "跨 16–29 世") +
        stat(String(P.filter(function (x) { return (x.inst || []).indexOf("出继") >= 0; }).length) + " / " + String(P.filter(function (x) { return (x.inst || []).indexOf("承继") >= 0; }).length), "出继 / 承继", "标签人物（含部分双重身份）") +
        stat(String(SHUANG), "双祧兼祧", "一身兼祧两房者") +
      '</div>' +

      '<h3 class="blk">房支过继标签人数（出＝本房有成员被出继 / 入＝本房有成员承继或双祧；标签计数非边流向，取总量前 18 房支）</h3>' +
      '<div class="card" style="padding:14px 18px"><div class="flowchart">' + flowSvg +
        '<div class="fllegend"><span class="lg out">■ 出（流出）</span><span class="lg in">■ 入（承入）</span></div></div></div>' +

      '<h3 class="blk">人物承嗣网络</h3>' +
      '<p class="small muted" style="margin:-6px 0 10px">按世代分层（上早下晚），连线为过继关系。可筛选房支 / 角色 / 姓名；点击节点看其承嗣详情，在图上拖动平移、滚轮缩放。</p>' +
      '<div class="toolbar">' +
        '<label class="small muted">房支 <select id="adoptbranch">' + bOpts + '</select></label>' +
        '<label class="small muted">角色 <select id="adopttype">' +
          '<option value="all">全部</option>' +
          '<option value="father">嗣父（承继）</option>' +
          '<option value="son">嗣子（出继）</option>' +
          '<option value="dual">兼祧（一身兼嗣父与嗣子）</option>' +
        '</select></label>' +
        '<input type="text" id="adoptq" placeholder="按姓名检索（如 大伦）" style="width:200px">' +
        '<button class="iconbtn" id="adoptreset">重置视图</button>' +
        '<span class="small muted" id="adoptcount" style="margin-left:auto"></span>' +
      '</div>' +
      '<div class="netwrap" id="netwrap"><svg id="adoptsvg"></svg>' +
        '<div class="netzoom">' +
          '<button class="iconbtn" id="azin" title="放大">＋</button>' +
          '<button class="iconbtn" id="azout" title="缩小">－</button>' +
          '<button class="iconbtn" id="azfit" title="复位">⟲</button>' +
        '</div>' +
        '<div class="netpanel" id="adoptinfo"></div>' +
      '</div>' +
      '<p class="small muted" style="margin:10px 0 0">数据说明：关系边由原文「为嗣」句式（承继…为嗣 / X出继…为嗣）与「本生父」标注解析，按（嗣子＋嗣父）去重。仅记「出继某房」未具名、或影印不清无法定位人名者未计入，故为保守下限。</p>';
  };

  function adoptKv(k, v) { return '<div class="k">' + k + '</div><div class="v">' + v + "</div>"; }

  function drawAdopt() {
    var svg = $("#adoptsvg"); if (!svg) return;
    var q = (adoptState.q || "").trim();
    var inc = {};
    Object.keys(ADOPT_NODE).forEach(function (id) {
      var nd = ADOPT_NODE[id], p = IDX[id]; if (!p) return;
      if (adoptState.branch && p.branch !== adoptState.branch) return;
      if (adoptState.type === "father" && !nd.father) return;
      if (adoptState.type === "son" && !nd.son) return;
      if (adoptState.type === "dual" && !(nd.father && nd.son)) return;
      inc[id] = true;
    });
    if (q) {
      var keep = {};
      Object.keys(inc).forEach(function (id) {
        var p = IDX[id]; if (p && p.name && p.name.indexOf(q) >= 0) {
          keep[id] = true;
          ADOPT_NODE[id].edges.forEach(function (ei) {
            var e = ADOPT[ei];
            if (e.adoptiveId) keep[e.adoptiveId] = true;
            if (e.sonId) keep[e.sonId] = true;
          });
        }
      });
      inc = keep;
    }
    var ids = Object.keys(inc);
    var cnt = $("#adoptcount"); if (cnt) cnt.textContent = "显示 " + ids.length + " 人 / " +
      ADOPT.filter(function (e) { return e.adoptiveId && inc[e.adoptiveId] && inc[e.sonId]; }).length + " 条关系";
    if (!ids.length) {
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.innerHTML = '<text x="50" y="50" text-anchor="middle" fill="var(--ink-3)" font-size="11">无匹配（请放宽筛选条件）</text>';
      renderAdoptInfo(); return;
    }

    var byGen = {};
    ids.forEach(function (id) { var g = IDX[id].gen || 0; (byGen[g] = byGen[g] || []).push(id); });
    var gens = Object.keys(byGen).map(Number).sort(function (a, b) { return a - b; });
    var minG = gens[0], maxG = gens[gens.length - 1];
    var STEP_X = 58, BAND_H = 116, M = 44, maxPerGen = 1;
    gens.forEach(function (g) { if (byGen[g].length > maxPerGen) maxPerGen = byGen[g].length; });
    gens.forEach(function (g) {
      byGen[g].sort(function (a, b) {
        var pa = IDX[a].branch || "", pb = IDX[b].branch || "";
        if (pa !== pb) return pa < pb ? -1 : 1;
        return (IDX[a].name || "") < (IDX[b].name || "") ? -1 : 1;
      });
      byGen[g].forEach(function (id, i) {
        ADOPT_NODE[id]._x = M + i * STEP_X + STEP_X / 2;
        ADOPT_NODE[id]._y = M + (g - minG) * BAND_H;
      });
    });
    var W = M * 2 + maxPerGen * STEP_X, H = M * 2 + (maxG - minG) * BAND_H;

    var linkSvg = ADOPT.map(function (e) {
      if (!e.adoptiveId || !inc[e.adoptiveId] || !inc[e.sonId]) return "";
      var A = ADOPT_NODE[e.adoptiveId], B = ADOPT_NODE[e.sonId];
      if (A._x == null || B._x == null) return "";
      var dim = adoptState.sel && e.adoptiveId !== adoptState.sel && e.sonId !== adoptState.sel;
      var x1 = A._x, y1 = A._y, x2 = B._x, y2 = B._y, mx = (x1 + x2) / 2;
      return '<path d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ',' + mx + ' ' + y2 + ',' + x2 + ' ' + y2 +
        '" fill="none" stroke="var(--gold)" stroke-width="' + (dim ? 0.5 : 1.4) + '" opacity="' + (dim ? 0.1 : 0.55) + '"/>';
    }).join("");

    var showLabel = {};
    if (adoptState.sel && ADOPT_NODE[adoptState.sel]) {
      showLabel[adoptState.sel] = true;
      ADOPT_NODE[adoptState.sel].edges.forEach(function (ei) {
        var e = ADOPT[ei]; if (e.adoptiveId) showLabel[e.adoptiveId] = true; if (e.sonId) showLabel[e.sonId] = true;
      });
    }
    var nodeSvg = ids.map(function (id) {
      var nd = ADOPT_NODE[id], p = IDX[id], x = nd._x, y = nd._y;
      var col = (nd.father && nd.son) ? "var(--accent)" : (nd.father ? "var(--gold)" : "var(--jade)");
      var isSel = id === adoptState.sel, dim = adoptState.sel && !showLabel[id];
      var tip = esc(p.name) + "　第" + cn(p.gen) + "世" + (p.branch ? "<br><b>" + esc(p.branch) + "</b>" : "") +
        "<br>角色：" + (nd.father ? "嗣父(承继) " : "") + (nd.son ? "嗣子(出继) " : "") + "　关联 " + nd.edges.length + " 条承嗣";
      return '<g class="anode" data-id="' + esc(id) + '"' + (dim ? ' opacity="0.22"' : "") + '>' +
        '<circle cx="' + x + '" cy="' + y + '" r="' + (isSel ? 7 : 4.5) + '" fill="' + col + '" stroke="#fffdf7" stroke-width="0.7"' + tattr(tip) + '/>' +
        (showLabel[id] ? '<text x="' + x + '" y="' + (y - 9) + '" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="var(--serif)">' + esc(p.name) + "</text>" : "") +
        "</g>";
    }).join("");

    svg.setAttribute("viewBox", (-M + " " + (-M) + " " + W + " " + H));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = '<g id="azoom" transform="translate(' + adoptState.tx + ',' + adoptState.ty + ') scale(' + adoptState.scale + ')">' + linkSvg + nodeSvg + "</g>";
    bindTips(svg);
    renderAdoptInfo();
  }

  function renderAdoptInfo() {
    var el = $("#adoptinfo"); if (!el) return;
    if (adoptState.sel && IDX[adoptState.sel]) {
      var p = IDX[adoptState.sel], nd = ADOPT_NODE[adoptState.sel], rows = [];
      rows.push(["世次", genLabel(p.gen) + (p.rank ? "，行第 " + esc(p.rank) : "")]);
      if (p.father) rows.push(["父", esc(p.father)]);
      if (p.branch) rows.push(["房支", esc(p.branch)]);
      rows.push(["承嗣角色", (nd.father ? "嗣父（承继他人为嗣）" : "") + (nd.father && nd.son ? "；" : "") + (nd.son ? "嗣子（出继为他人嗣）" : "")]);
      var rels = [];
      nd.edges.forEach(function (ei) {
        var e = ADOPT[ei];
        if (e.sonId === p.id) rels.push("出继为 <b>" + esc(e.adoptiveN) + "</b> 嗣" + (e.bioN ? "（本生父 " + esc(e.bioN) + "）" : ""));
        if (e.adoptiveId === p.id) rels.push("承 <b>" + esc(e.sonN) + "</b> 为嗣" + (e.bioN && e.bioN !== p.name ? "（本生父 " + esc(e.bioN) + "）" : ""));
      });
      if (rels.length) rows.push(["承嗣关系", rels.join("；")]);
      if (p.birth) rows.push(["生", esc(p.birth) + (p.birthYear ? "（" + p.birthYear + "）" : "")]);
      if (p.death) rows.push(["殁", esc(p.death)]);
      if (p.burial) rows.push(["葬", esc(p.burial)]);
      el.innerHTML = '<div class="nphead">' + esc(p.name) + ' <span class="small muted">第' + cn(p.gen) + '世</span></div>' +
        '<div class="kv">' + rows.map(function (r) { return adoptKv(r[0], r[1]); }).join("") + '</div>' +
        '<div class="npacts"><button class="iconbtn" data-openpage="' + num(p.page) + '">原谱第 ' + num(p.page) + ' 页</button>' +
        '<button class="iconbtn" id="adoptviewperson">人物检索查看</button></div>' +
        (p.raw ? '<div class="raw">' + esc(p.raw) + '</div>' : '');
      var vp = $("#adoptviewperson"); if (vp) vp.onclick = function () {
        location.hash = "#/people"; setTimeout(function () { pState.q = p.name; var s = $("#pq"); if (s) s.value = p.name; renderPeople(); }, 120);
      };
      var op = el.querySelector("[data-openpage]"); if (op) op.onclick = function () { openViewer(parseInt(op.getAttribute("data-openpage"), 10)); };
      bindTips(el);
    } else {
      el.innerHTML = '<div class="nphead">过继承嗣网络</div>' +
        '<p class="small muted" style="margin:6px 0 10px">点击图中节点查看其承嗣关系；拖动平移、滚轮缩放。颜色：' +
        '<span style="color:var(--gold)">金＝嗣父(承继他人为嗣)</span>、<span style="color:var(--jade)">青＝嗣子(出继为他人嗣)</span>、<span style="color:var(--accent)">红＝兼祧(一身兼嗣父与嗣子)</span>。</p>' +
        '<div class="kv">' +
          adoptKv("过继关系边", ADOPT.length + " 条") +
          adoptKv("涉及人物", Object.keys(ADOPT_NODE).length + " 人") +
          adoptKv("出继标签", P.filter(function (x) { return (x.inst || []).indexOf("出继") >= 0; }).length + " 人") +
          adoptKv("承继标签", P.filter(function (x) { return (x.inst || []).indexOf("承继") >= 0; }).length + " 人") +
          adoptKv("双祧兼祧", SHUANG + " 人") +
        '</div>';
    }
  }

  function adoptZoom(k) {
    var svg = $("#adoptsvg"); if (!svg) return;
    var v = (svg.getAttribute("viewBox") || "0 0 100 100").trim().split(/[\s,]+/).map(Number);
    var cx = v[0] + (v[2] || 100) / 2, cy = v[1] + (v[3] || 100) / 2;
    var ns = Math.max(.15, Math.min(3.4, adoptState.scale * k)), ratio = ns / adoptState.scale;
    adoptState.tx = cx - (cx - adoptState.tx) * ratio; adoptState.ty = cy - (cy - adoptState.ty) * ratio; adoptState.scale = ns;
    var z = $("#azoom"); if (z) z.setAttribute("transform", "translate(" + adoptState.tx + "," + adoptState.ty + ") scale(" + adoptState.scale + ")");
  }

  function bindAdoptEvents() {
    var svg = $("#adoptsvg"); if (!svg) return;
    var s = adoptState;
    function getVB() {
      var v = (svg.getAttribute("viewBox") || "0 0 100 100").trim().split(/[\s,]+/).map(Number);
      var r = svg.getBoundingClientRect();
      return { x: v[0] || 0, y: v[1] || 0, w: v[2] || 100, h: v[3] || 100, rw: Math.max(1, r.width), rh: Math.max(1, r.height) };
    }
    function applyT() { var z = $("#azoom"); if (z) z.setAttribute("transform", "translate(" + s.tx + "," + s.ty + ") scale(" + s.scale + ")"); }
    var dragging = false, sx = 0, sy = 0, s0x = 0, s0y = 0, moved = false;
    svg.onmousedown = function (e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; s0x = s.tx; s0y = s.ty; e.preventDefault(); };
    window.onmouseup = function () { dragging = false; };
    svg.onmousemove = function (e) {
      if (!dragging) return;
      var v = getVB(), f = v.w / v.rw;
      s.tx = s0x + (e.clientX - sx) * f; s.ty = s0y + (e.clientY - sy) * f;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true;
      applyT();
    };
    svg.onwheel = function (e) {
      e.preventDefault();
      var v = getVB(), k = e.deltaY < 0 ? 1.13 : 1 / 1.13;
      var ns = Math.max(.15, Math.min(3.4, s.scale * k));
      var r = svg.getBoundingClientRect();
      var cx = v.x + (e.clientX - r.left) * (v.w / v.rw), cy = v.y + (e.clientY - r.top) * (v.h / v.rh);
      var ratio = ns / s.scale;
      s.tx = cx - (cx - s.tx) * ratio; s.ty = cy - (cy - s.ty) * ratio; s.scale = ns; applyT();
    };
    svg.addEventListener("click", function (e) {
      if (moved) return;
      var t = e.target, g = null;
      while (t && t !== svg) { if (t.getAttribute && t.getAttribute("data-id")) { g = t; break; } t = t.parentNode; }
      s.sel = g ? g.getAttribute("data-id") : null;
      drawAdopt();
    });
  }

  /* ===== 说明 ===== */
  V.about = function () {
    var S = D.sources || {};
    return '' +
      '<h2 class="sec">数字化说明与数据来源</h2>' +
      '<p class="sub">本知识库由《瑞金颍川信义钟氏七修族谱（A4）》PDF 扫描件整理而成。</p>' +
      '<h3 class="blk">原书概况</h3>' +
      '<div class="card" style="padding:16px 18px"><p style="margin:0">七修族谱共印 <b>104 部</b>，每部 <b>11 本</b>。原本为江西瑞金叶坪一带信义钟氏所修，堂号颍川。PDF 扫描件共 <b>1210 页</b>，每页为一个跨页（含左右两原书页），故实际覆盖原书约 <b>2400 页</b>。</p></div>' +
      '<h3 class="blk">整理方法</h3>' +
      '<div class="card" style="padding:16px 18px"><ul style="margin:0;padding-left:20px;line-height:2.1">' +
      '<li>原书为影印扫描（无文字层），整理方式为逐页识读「世系录」并转录为结构化数据。</li>' +
      '<li>本支二十四代直系（永健→…→德松→延鑫→枝鹏）由人工逐页精读原谱第 102、111、112、165–168、493–494 页校订，可靠性最高。</li>' +
      '<li>其余房支由分区段识读录入，用于呈现全族分支脉络。</li>' +
      '<li>每条记录均保留 <b>原文逐字转录</b> 与 <b>原谱页码</b>，便于回溯核对。</li>' +
      '</ul></div>' +
      '<h3 class="blk">置信度与已知问题</h3>' +
      '<div class="card" style="padding:16px 18px"><ul style="margin:0;padding-left:20px;line-height:2.1">' +
      '<li>记录标注 high / medium / low 三档置信度；影印模糊处一律以「□」占位，不做臆测。</li>' +
      '<li>原谱本身存在前后矛盾（如生死年干支不合、同人重复刊载、房支归属互异），已照录并加注存疑。</li>' +
      '<li>部分生年用年号纪年（清光绪丁未等），公元换算值为推定。</li>' +
      '<li>本谱 11–15 世的早期世代仅本支直系已补全，其余房支该区间尚未逐页录入。</li>' +
      '<li>全书 11 本（PDF p003–1210）均已分区段识读录入；因影印清晰度不一，个别小字条目可能漏录或归属有误，请以「原文转录 + 原谱页码」回溯核对为准。</li>' +
      '</ul></div>' +
      '<h3 class="blk">数据统计</h3>' +
      '<div class="grid g4">' + [
        stat(String(P.length), "结构化人物", "含生殁、婚配、子嗣、葬地等"),
        stat(String((S.farAncestors || []).length), "远系世祖", "源流考所载一世接公至四十二世玚公"),
        stat(String((D.branches || []).length), "房支分组", "按原谱「太位下」划分"),
        stat("1210", "可查影像页", "全谱扫描件逐页可浏览")
      ].join("") + "</div>" +
      '<div class="grid g3">' + [
        stat(String((S.appendix || []).length), "附录文献", "历修谱跋、人物传记、捐资名录、领谱字号"),
        stat(String((S.prefaces || []).length), "修谱序", "王思轼序、族谱引、四修序等"),
        stat(String((S.rules || []).length + (S.graves || []).length + (S.contracts || []).length), "族产文献", "凡例族规、坟山界址、合约契字")
      ].join("") + "</div>" +
      '<h3 class="blk">转录置信度分布</h3>' +
      '<div class="card" style="padding:16px 18px">' +
      '<p class="small" style="margin:0 0 10px">原书为影印件，清晰度不一。每条记录均标注置信度，请在引用前对照原文核对。' +
      "可归一出茔域的 " + ((D.derive || {}).buriedCount || 0) + " 人中，多数来自字迹清晰的原谱页面。</p>" +
      (function () {
        var cd = (D.derive || {}).confDist || {};
        var tot = 0; Object.keys(cd).forEach(function (k) { tot += cd[k]; });
        var rows = [["high", "高（清晰可读）", "var(--jade)"], ["medium", "中（部分模糊/推测）", "var(--gold)"], ["low", "低（存疑）", "var(--accent)"]];
        return rows.map(function (r) {
          var v = cd[r[0]] || 0;
          var pct = tot ? (100 * v / tot) : 0;
          return '<div class="barline"><span class="lb">' + r[1].split("（")[0] + '</span><div class="tr"><div class="fl" style="width:' +
            pct.toFixed(1) + "%;background:" + r[2] + '"></div></div><span class="vl">' + v + " 人 · " + pct.toFixed(1) + "%</span></div>";
        }).join("") +
        '<p class="small muted" style="margin:10px 0 0">另有 ' + ((D.derive || {}).noFather || 0) +
        " 人存在父系断链——其父名在原谱中未找到对应条目（多见于世系残缺的早期世代或线索中断的支系），" +
        "在世系树中表现为独立分支。这部分需要日后逐页复核才能补齐。</p>";
      })() +
      "</div>" +
      '<h3 class="blk">使用提示</h3>' +
      '<div class="card" style="padding:16px 18px"><p style="margin:0">本页面为完全离线的单页应用：所有数据与影像均在本文件夹内（<span class="mono">assets/</span>），双击 <span class="mono">index.html</span> 即可打开，无需联网。原谱影像较大（共约 220 MB）。</p></div>';
  };

  /* ---------------- 路由 ---------------- */
  var ROUTES = {
    home: { t: "总览", f: V.home, path: "谱系总览" },
    mypath: { t: "我这一脉", f: V.mypath, path: "我这一脉 · 二十四代直系" },
    origin: { t: "源流考", f: V.origin, path: "钟氏源流考" },
    timeline: { t: "族史长河", f: V.timeline, path: "族史长河 · 时间轴与代际" },
    lineage: { t: "世系与房支", f: V.lineage, path: "世系与房支" },
    tree: { t: "世系树", f: V.tree, path: "交互式世系树" },
    burial: { t: "茔域", f: V.burial, path: "茔域 · 葬地与山向" },
    people: { t: "人物检索", f: V.people, path: "人物检索" },
    archive: { t: "原谱浏览", f: V.archive, path: "原谱浏览" },
    adoption: { t: "承嗣网络", f: V.adoption, path: "过继承嗣关系网络" },
    about: { t: "说明", f: V.about, path: "数字化说明" }
  };

  function go() {
    var pb = document.getElementById("printbox"); if (pb) pb.innerHTML = "";
    var h = (location.hash || "#/home").replace(/^#\/?/, "");
    var name = h.split("?")[0].split("/")[0] || "home";
    if (!ROUTES[name]) name = "home";
    var r = ROUTES[name];
    var c = $("#content");
    c.innerHTML = r.f();
    $("#crumb").textContent = r.path;
    $$("#nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-r") === name); });
    window.scrollTo(0, 0);

    if (name === "home") {
      var hp = $("#homepath");
      if (hp) {
        hp.innerHTML = ANCHOR.map(function (id) {
          var p = IDX[id]; if (!p) return "";
          return '<div class="n" data-go="' + esc(id) + '"><div class="g">' + cn(p.gen) + '世</div><div class="m">' + esc(p.name) + "</div></div>";
        }).join("");
        $$("[data-go]", hp).forEach(function (el) {
          el.onclick = function () {
            var id = el.getAttribute("data-go");
            location.hash = "#/mypath";
            setTimeout(function () {
              var el2 = document.getElementById("anc-" + id);
              if (el2) {
                var bd = el2.querySelector(".bd");
                if (bd) bd.classList.remove("hide");
                el2.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 180);
          };
        });
      }
      $$("#content .stairs .bar").forEach(function (b) {
        b.onclick = function () { location.hash = "#/people"; setTimeout(function () { pState.gen = b.getAttribute("data-g"); var s = $("#pgen"); if (s) s.value = pState.gen; renderPeople(); }, 100); };
      });
    }

    if (name === "mypath") {
      $$(".anc .hd").forEach(function (hd) {
        hd.onclick = function () { hd.parentNode.querySelector(".bd").classList.toggle("hide"); };
      });
      $$(".pathbar .n").forEach(function (n) {
        n.onclick = function () {
          var el = document.getElementById("anc-" + n.getAttribute("data-id"));
          if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.querySelector(".bd").classList.remove("hide"); }
        };
      });
    }

    if (name === "origin" || name === "lineage" || name === "mypath" || name === "timeline" || name === "burial") {
      $$(".acc > .h").forEach(function (h) {
        h.onclick = function () {
          var a = h.parentNode; a.classList.toggle("open");
          var ar = h.querySelector(".ar"); if (ar) ar.textContent = a.classList.contains("open") ? "▾" : "▸";
        };
      });
    }

    if (name === "timeline") {
      var tf = $("#tlf"), tlist = $("#tllist");
      function tlFilter() {
        var q = (tf.value || "").trim().toLowerCase();
        var items = $$(".tl-i", tlist), shown = 0;
        items.forEach(function (it) {
          var ok = !q || (it.getAttribute("data-s") || "").indexOf(q) >= 0;
          it.style.display = ok ? "" : "none";
          if (ok) shown++;
        });
        $$(".tl-grp", tlist).forEach(function (g) {
          var any = $$(".tl-i", g).some(function (it) { return it.style.display !== "none"; });
          g.style.display = any ? "" : "none";
        });
        var c = $("#tlc"); if (c) c.textContent = "显示 " + shown + " / " + items.length + " 条";
      }
      if (tf) { tf.oninput = tlFilter; tlFilter(); }
    }

    if (name === "burial") {
      $$("[data-bp]").forEach(function (b) {
        b.onclick = function () {
          var nm = b.getAttribute("data-bp");
          var box = document.getElementById("bp-" + nm);
          if (!box) return;
          if (box.classList.contains("hide")) {
            if (!box.innerHTML) {
              var arr = bpMap()[nm] || [];
              var lim = 80;
              box.innerHTML = '<div class="pchips">' + arr.slice(0, lim).map(function (p) {
                return '<span class="pchip" data-pid="' + esc(p.id) + '"><span class="g">' + cn(p.gen) + '世</span><b>' +
                  esc(p.name) + '</b><span class="muted small">' + esc((p.branch || "").split("·").pop() || "") +
                  '</span><span class="pill">p' + esc(num(p.page)) + "</span></span>";
              }).join("") + "</div>" +
                (arr.length > lim ? '<div class="small muted" style="margin:6px 0 0">共 ' + arr.length + " 人，仅列前 " + lim + " 人</div>" : "") +
                '<div class="small muted" style="margin:6px 0 0">点击姓名可看详传</div>';
              $$(".pchip[data-pid]", box).forEach(function (c) {
                c.onclick = function () { openPerson(c.getAttribute("data-pid")); };
              });
            }
            box.classList.remove("hide");
            b.textContent = "收起";
          } else {
            box.classList.add("hide");
            b.textContent = "名录";
          }
        };
      });
    }

    if (name === "lineage") {
      $$("[data-branch]").forEach(function (b) {
        b.onclick = function () { location.hash = "#/people"; setTimeout(function () { pState.branch = b.getAttribute("data-branch"); pState.page = 1; var s = $("#pbranch"); if (s) s.value = pState.branch; renderPeople(); }, 100); };
      });
    }

    if (name === "tree") {
      drawTree();
      var ri = $("#troot");
      ri.onchange = function () {
        var v = ri.value.trim();
        var hit = P.filter(function (p) { return p.name === v; }).sort(function (a, b) { return (b.childIds || []).length - (a.childIds || []).length; })[0];
        if (hit) { treeState.root = hit.id; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; drawTree(); }
      };
      $("#tdepth").onchange = function () { setDepth(parseInt(this.value, 10)); };
      $("#tzfit").onclick = function () { treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; drawTree(); };
      $("#tzfull").onclick = function () { toggleTreeFull(); };
      $("#tzpng").onclick = function () { exportTreePng(); };
      $("#tzin").onclick = function () { zoomBy(1.25); };
      $("#tzout").onclick = function () { zoomBy(1 / 1.25); };
      $("#tanc").onclick = function () { var d = ANCHOR[15] && IDX[ANCHOR[15]]; if (d) { treeState.root = d.id; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; drawTree(); } };
      $("#tall").onclick = function () { treeState.collapsed = {}; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; setDepth(99); };
      $("#tshallow").onclick = function () { treeState.collapsed = {}; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1; setDepth(2); };
      var tb = $("#tbranch");
      if (tb) tb.onchange = function () {
        var b = this.value;
        if (b && BRANCHROOT[b]) {
          treeState.root = BRANCHROOT[b]; treeState.tx = 0; treeState.ty = 0; treeState.scale = 1;
          var ri = $("#troot"); if (ri) ri.value = "";
          drawTree();
        }
      };
    }

    if (name === "people") {
      var q = $("#pq");
      q.value = pState.q; $("#pgen").value = pState.gen; $("#pbranch").value = pState.branch;
      $("#panc").checked = pState.anc; $("#pconf").value = pState.conf; $("#pinst").value = pState.inst;
      $("#pyear").checked = pState.year; $("#pbury").checked = pState.bury;
      q.oninput = function () { pState.q = this.value; pState.page = 1; renderPeople(); };
      $("#pgen").onchange = function () { pState.gen = this.value; pState.page = 1; renderPeople(); };
      $("#pbranch").onchange = function () { pState.branch = this.value; pState.page = 1; renderPeople(); };
      $("#panc").onchange = function () { pState.anc = this.checked; pState.page = 1; renderPeople(); };
      $("#pconf").onchange = function () { pState.conf = this.value; pState.page = 1; renderPeople(); };
      $("#pinst").onchange = function () { pState.inst = this.value; pState.page = 1; renderPeople(); };
      $("#pyear").onchange = function () { pState.year = this.checked; pState.page = 1; renderPeople(); };
      $("#pbury").onchange = function () { pState.bury = this.checked; pState.page = 1; renderPeople(); };
      var ex = $("#pexport"), pr = $("#pprint");
      if (ex) ex.onclick = function () { exportPersonsCSV(); };
      if (pr) pr.onclick = function () { printPersons(); };
      renderPeople();
    }

    if (name === "archive") {
      renderThumbs(0);
      $("#vvol").onchange = function () { renderThumbs(parseInt(this.value, 10)); };
      $("#vgo").onclick = function () { openViewer(parseInt($("#vjump").value, 10)); };
      $$("[data-openpage]").forEach(function (el) { el.onclick = function () { openViewer(parseInt(el.getAttribute("data-openpage"), 10)); }; });
      var mm = (location.hash.match(/[?&]p=(\d+)/) || [])[1];
      if (mm) openViewer(parseInt(mm, 10));
    }

    if (name === "adoption") {
      adoptState.branch = ""; adoptState.type = "all"; adoptState.q = ""; adoptState.sel = null;
      adoptState.tx = 0; adoptState.ty = 0; adoptState.scale = 1;
      drawAdopt();
      bindAdoptEvents();
      var ab = $("#adoptbranch"); if (ab) ab.onchange = function () { adoptState.branch = this.value; adoptState.sel = null; drawAdopt(); };
      var at = $("#adopttype"); if (at) at.onchange = function () { adoptState.type = this.value; adoptState.sel = null; drawAdopt(); };
      var aq = $("#adoptq"); if (aq) aq.oninput = function () { adoptState.q = this.value; adoptState.sel = null; drawAdopt(); };
      var ar = $("#adoptreset"); if (ar) ar.onclick = function () { adoptState.tx = 0; adoptState.ty = 0; adoptState.scale = 1; adoptState.sel = null; drawAdopt(); };
      var azin = $("#azin"); if (azin) azin.onclick = function () { adoptZoom(1.3); };
      var azout = $("#azout"); if (azout) azout.onclick = function () { adoptZoom(1 / 1.3); };
      var azfit = $("#azfit"); if (azfit) azfit.onclick = function () { adoptState.tx = 0; adoptState.ty = 0; adoptState.scale = 1; drawAdopt(); };
    }

    if (name !== "tree") $$("[data-openpage]").forEach(function (el) { el.onclick = function () { openViewer(parseInt(el.getAttribute("data-openpage"), 10)); }; });
    if (name !== "archive" && name !== "tree") {
      $$(".kid[data-name]").forEach(function (k) {
        k.onclick = function () {
          var nm = k.getAttribute("data-name"), g = parseInt(k.getAttribute("data-gen"), 10);
          var hit = P.filter(function (p) { return p.name === nm && p.gen === g; })[0];
          if (hit) openPerson(hit.id);
        };
      });
    }

    bindTips($("#content"));
  }

  /* ---------------- 初始化 ---------------- */
  window.addEventListener("hashchange", go);
  var started = false;
  function start() {
    if (started) return;
    started = true;
    var b = $("#themebtn");
    if (b) b.onclick = function () {
      var cur = document.documentElement.getAttribute("data-theme");
      setTheme(cur === "dark" ? "light" : "dark");
    };
    setTheme((function () { try { return localStorage.getItem("zsh-theme") || "light"; } catch (e) { return "light"; } })());
    go();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
