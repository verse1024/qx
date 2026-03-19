/**
 * 买单吧（交通银行）每日签到脚本
 * 基于真实抓包数据编写，100% 还原 App 签到流程
 * ─────────────────────────────────────────────────────
 *
 * 【签到机制说明】（来自真实抓包 JS 源码逆向）
 * 买单吧签到是纯 H5 页面，流程分三步：
 *   Step 1: GET 签到页面 HTML → 提取 token / taskShowCd / taskId / base
 *   Step 2: POST 签到接口    → 提交签到，返回买单币余额
 *   Step 3: POST 数据接口    → 获取连续签到天数
 *
 * 【真实接口】（100% 来自抓包）
 *   签到页:  GET  https://creditcardapp.bankcomm.com/mdlweb/ddySgn/index?channel=00
 *   签到:    POST https://creditcardapp.bankcomm.com/mdlweb/sign/sign?token={token}
 *   数据:    POST https://creditcardapp.bankcomm.com/mdlweb/sign/data?token={token}
 *   body:    {"taskShowCd":"xxx","taskId":"xxx"}
 *
 * 【鉴权方式】（100% 来自抓包）
 *   Cookie: JSESSIONID=xxx  （进入签到页时服务器自动下发）
 *   token  （从 HTML 页面 <input id="token"> 提取，每次刷新都不同）
 *
 * ────────────────── 配置步骤 ──────────────────
 *
 * [rewrite_local]
 * ^https?:\/\/creditcardapp\.bankcomm\.com\/mdlweb\/ddySgn url script-request-header https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js
 *
 * [task_local]
 * 30 8 * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js, tag=买单吧签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/PayPal.png, enabled=true
 *
 * [mitm] hostname 加入：
 * creditcardapp.bankcomm.com
 *
 * ────────────────── 使用方法 ──────────────────
 * 1. 配置好上面内容后保存
 * 2. 打开买单吧 App，进入签到页面
 * 3. rewrite 规则自动保存 JSESSIONID
 * 4. 之后每天 08:30 自动签到，无需再操作
 * ──────────────────────────────────────────────
 */

var TAG       = "买单吧签到";
var STORE_KEY = "mdb_jsessionid";
var HOST      = "https://creditcardapp.bankcomm.com";
var PAGE_URL  = HOST + "/mdlweb/ddySgn/index?channel=00";
// User-Agent 必须和 App 完全一致，否则服务器会拒绝请求
var UA        = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148com.bankcomm.maidanba.V2;mapp_saoma;isApplePayUsable;paypinflag;newVCard;digitalcert;WKWebView;UnionPay/1.0 BoComMDB;buildVersion265;mdbTitleBar;";

// ═══════════════════════════════════════════════════
//  模式 A：rewrite 拦截 —— 自动保存 JSESSIONID
//
//  当圈X的 rewrite_local 规则匹配到买单吧签到页请求时，
//  $request 对象存在，脚本进入此分支。
//  从请求的 Cookie 头提取 JSESSIONID 保存到本地存储。
// ═══════════════════════════════════════════════════
if (typeof $request !== "undefined") {
  var reqCookie = $request.headers["Cookie"] || $request.headers["cookie"] || "";
  var m = reqCookie.match(/JSESSIONID=([^;]+)/);
  if (m && m[1]) {
    $prefs.setValueForKey(m[1], STORE_KEY);
    console.log("[" + TAG + "] ✅ JSESSIONID 已保存: " + m[1].substring(0, 16) + "...");
  }
  // 放行原请求，不做任何修改
  $done({});

} else {
  // ═══════════════════════════════════════════════════
  //  模式 B：task 定时任务 —— 执行签到
  //
  //  当圈X的 task_local 定时触发时，$request 不存在，
  //  脚本进入此分支，读取已保存的 Session 开始签到流程。
  // ═══════════════════════════════════════════════════
  var savedSession = $prefs.valueForKey(STORE_KEY) || "";
  console.log("[" + TAG + "] savedSession=" + (savedSession ? savedSession.substring(0, 16) + "..." : "空"));

  if (!savedSession) {
    $notify(TAG, "⚠️ 未获取到 Session",
      "请先打开买单吧 App，进入签到页面操作一次，脚本会自动保存登录状态");
    $done();
  } else {
    step1_getPage(savedSession);
  }
}

// ──────────────────────────────────────────────────
// Step 1: GET 签到页面，从 HTML 提取关键参数
// ──────────────────────────────────────────────────
function step1_getPage(sessionId) {
  $task.fetch({
    method:  "GET",
    url:     PAGE_URL,
    headers: {
      "User-Agent":      UA,
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh-Hans;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection":      "keep-alive",
      "Sec-Fetch-Site":  "none",
      "Sec-Fetch-Mode":  "navigate",
      "Sec-Fetch-Dest":  "document",
      "Cookie":          "JSESSIONID=" + sessionId,
    },
  }).then(function(resp) {
    console.log("[" + TAG + "] 页面 HTTP " + resp.statusCode);

    // 服务器有时会在响应里下发新的 JSESSIONID，更新保存
    var sc = resp.headers["Set-Cookie"] || resp.headers["set-cookie"] || "";
    var newSess = (sc.match(/JSESSIONID=([^;]+)/) || [])[1];
    if (newSess) {
      sessionId = newSess;
      $prefs.setValueForKey(newSess, STORE_KEY);
      console.log("[" + TAG + "] Session 已更新: " + newSess.substring(0, 16) + "...");
    }

    var html = resp.body || "";
    if (!html || html.length < 200) {
      $notify(TAG, "❌ 页面内容为空", "请先打开买单吧 App 进入签到页面，再手动执行");
      $done();
      return;
    }

    // ── 从 HTML 提取 <input type="hidden" id="xxx" value="yyy"> ──
    function getVal(id) {
      var r1 = new RegExp('id=["\']' + id + '["\'][^>]*?value=["\']([^"\']*)["\']');
      var r2 = new RegExp('value=["\']([^"\']*)["\'][^>]*?id=["\']' + id + '["\']');
      var mm = html.match(r1) || html.match(r2);
      return mm ? mm[1] : "";
    }

    var token      = getVal("token");
    var taskShowCd = getVal("taskShowCd");
    var taskId     = getVal("taskId");
    var signSts    = getVal("signSts");
    // base 从日志已知是 /mdlweb，直接用，不再动态提取避免出错
    var base       = "/mdlweb";

    console.log("[" + TAG + "] token=" + (token || "未找到"));
    console.log("[" + TAG + "] taskShowCd=" + taskShowCd);
    console.log("[" + TAG + "] taskId=" + taskId);
    console.log("[" + TAG + "] signSts=" + signSts);
    console.log("[" + TAG + "] base=" + base);

    if (!token) {
      var isLoginPage = html.indexOf("login") >= 0 || html.indexOf("登录") >= 0;
      $prefs.setValueForKey("", STORE_KEY);
      $notify(TAG, "❌ Session 已失效",
        isLoginPage
          ? "已跳转到登录页，请打开买单吧 App 重新登录后进入签到页面"
          : "未获取到 token，请打开买单吧 App 进入签到页面后重试");
      $done();
      return;
    }

    // signSts=1 = 今天已签到，直接去查数据显示积分和天数
    if (signSts === "1") {
      console.log("[" + TAG + "] 今日已签到，查询签到数据获取积分...");
      step3_getDetail(base, token, taskShowCd, taskId, sessionId, true);
      return;
    }

    // 未签到，执行签到
    step2_doSign(base, token, taskShowCd, taskId, sessionId);

  }).catch(function(err) {
    console.log("[" + TAG + "] 页面请求失败: " + JSON.stringify(err));
    $notify(TAG, "❌ 网络请求失败", "请检查节点是否正常。" + (err.error || err));
    $done();
  });
}

// ──────────────────────────────────────────────────
// Step 2: POST 签到接口，提交签到
// ──────────────────────────────────────────────────
function step2_doSign(base, token, taskShowCd, taskId, sessionId) {
  var url  = HOST + base + "/sign/sign?token=" + token;
  var body = JSON.stringify({ "taskShowCd": taskShowCd, "taskId": taskId });

  console.log("[" + TAG + "] 签到 URL: " + url);
  console.log("[" + TAG + "] 签到 Body: " + body);

  $task.fetch({
    method:  "POST",
    url:     url,
    headers: {
      "Content-Type":     "application/json",
      "Accept":           "application/json, text/javascript, */*; q=0.01",
      "User-Agent":       UA,
      "Cookie":           "JSESSIONID=" + sessionId,
      "Referer":          PAGE_URL,
      "Origin":           HOST,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body,
  }).then(function(resp) {
    console.log("[" + TAG + "] 签到响应 HTTP " + resp.statusCode);
    console.log("[" + TAG + "] 签到响应: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {
      console.log("[" + TAG + "] JSON 解析失败，原文: " + resp.body);
    }

    var code     = json.returnCode || "";
    var msg      = json.returnMsg  || "";
    var data     = json.data       || {};
    var newToken = json.token      || token;

    if (code === "000000") {
      // 签到成功，先推通知，再查详细数据
      var itgBal = data.itgBal || data.itgBalance || "";
      var balTxt = itgBal ? "\n买单币余额: " + itgBal : "";
      $notify(TAG, "✅ 签到成功", "日期: " + today() + balTxt);
      step3_getDetail(base, newToken, taskShowCd, taskId, sessionId, false);

    } else if (msg.indexOf("已签") >= 0 || code === "000001") {
      step3_getDetail(base, token, taskShowCd, taskId, sessionId, true);

    } else if (msg.indexOf("登录") >= 0 || msg.indexOf("失效") >= 0 ||
               msg.indexOf("过期") >= 0 || resp.statusCode === 401) {
      $prefs.setValueForKey("", STORE_KEY);
      $notify(TAG, "❌ 登录已失效", "请打开买单吧 App 重新进入签到页面");
      $done();

    } else {
      $notify(TAG, "⚠️ 签到返回异常",
        "returnCode: " + code + "\n" + (msg || "无错误信息") + "\n请截图日志反馈");
      $done();
    }

  }).catch(function(err) {
    console.log("[" + TAG + "] 签到请求失败: " + JSON.stringify(err));
    $notify(TAG, "❌ 签到请求失败", String(err.error || err));
    $done();
  });
}

// ──────────────────────────────────────────────────
// Step 3: 查询签到数据（积分余额 / 连续天数 / 进阶信息）
// alreadySigned=true 表示今日已签，false 表示刚签成功
// ──────────────────────────────────────────────────
function step3_getDetail(base, token, taskShowCd, taskId, sessionId, alreadySigned) {
  var url  = HOST + base + "/sign/data?token=" + token;
  var body = JSON.stringify({ "taskShowCd": taskShowCd, "taskId": taskId });

  $task.fetch({
    method:  "POST",
    url:     url,
    headers: {
      "Content-Type":     "application/json",
      "Accept":           "application/json, text/javascript, */*; q=0.01",
      "User-Agent":       UA,
      "Cookie":           "JSESSIONID=" + sessionId,
      "Referer":          PAGE_URL,
      "Origin":           HOST,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body,
  }).then(function(resp) {
    console.log("[" + TAG + "] 签到数据响应: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var title, lines;

    if (json.returnCode === "000000" && json.data) {
      var d = json.data;
      title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
      lines = ["日期: " + today()];

      // 买单币积分余额
      var itgBal = d.itgBal || d.itgBalance || d.totalItg || "";
      if (itgBal) lines.push("买单币余额: " + itgBal);

      // 累计签到天数
      if (d.totalDays) lines.push("累计签到: " + d.totalDays + " 天");

      // 距离进阶还差几天
      if (d.nextDays > 0)       lines.push("距进阶还差: " + d.nextDays + " 天");
      else if (d.nextDays === 0) lines.push("🎉 已达进阶！");

      // 活动剩余天数
      if (d.offDays) lines.push("活动还剩: " + d.offDays + " 天");

    } else {
      // 查询数据失败，至少告知签到结果
      title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
      lines = ["日期: " + today(), "（积分详情获取失败）"];
    }

    $notify(TAG, title, lines.join("\n"));
    $done();

  }).catch(function(err) {
    // 查询失败也要通知基本结果
    var title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
    $notify(TAG, title, "日期: " + today() + "\n（积分详情获取失败）");
    $done();
  });
}

// ──────────────────────────────────────────────────
function today() {
  var d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
