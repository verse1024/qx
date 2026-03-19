/**
 * 买单吧 每日签到脚本
 * ──────────────────────────────────────────
 * [rewrite_local]
 * ^https?:\/\/creditcardapp\.bankcomm\.com\/mdlweb\/ddySgn url script-request-header https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js
 *
 * [task_local]
 * 30 8 * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js, tag=买单吧签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/PayPal.png, enabled=true
 *
 * [mitm] hostname 加入：creditcardapp.bankcomm.com
 * ──────────────────────────────────────────
 */

var TAG       = "买单吧签到";
var STORE_KEY = "mdb_jsessionid";
var HOST      = "https://creditcardapp.bankcomm.com";
var PAGE_URL  = HOST + "/mdlweb/ddySgn/index?channel=00";
var BASE      = "/mdlweb";
var UA        = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148com.bankcomm.maidanba.V2;mapp_saoma;isApplePayUsable;paypinflag;newVCard;digitalcert;WKWebView;UnionPay/1.0 BoComMDB;buildVersion265;mdbTitleBar;";

// ── 工具函数 ──────────────────────────────────────

function extractSession(headers) {
  var sc = headers["Set-Cookie"] || headers["set-cookie"] || "";
  if (Array.isArray(sc)) sc = sc.join("; ");
  var m = sc.match(/JSESSIONID=([^;,\s]+)/);
  return m ? m[1] : "";
}

function getVal(html, id) {
  var r1 = new RegExp('id=["\']' + id + '["\'][^>]*?value=["\']([^"\']*)["\']');
  var r2 = new RegExp('value=["\']([^"\']*)["\'][^>]*?id=["\']' + id + '["\']');
  var m = html.match(r1) || html.match(r2);
  return m ? m[1] : "";
}

function today() {
  var d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function makeHeaders(sessionId, isAjax) {
  var h = {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "Cookie": "JSESSIONID=" + sessionId,
  };
  if (isAjax) {
    h["Content-Type"]     = "application/json";
    h["Accept"]           = "application/json, text/javascript, */*; q=0.01";
    h["Referer"]          = PAGE_URL;
    h["Origin"]           = HOST;
    h["X-Requested-With"] = "XMLHttpRequest";
  } else {
    h["Accept"]          = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    h["Accept-Encoding"] = "gzip, deflate, br";
    h["Sec-Fetch-Site"]  = "none";
    h["Sec-Fetch-Mode"]  = "navigate";
    h["Sec-Fetch-Dest"]  = "document";
  }
  return h;
}

// ═══════════════════════════════════════════════════
//  模式 A：rewrite 拦截 —— 自动捕获 JSESSIONID
// ═══════════════════════════════════════════════════
if (typeof $request !== "undefined") {
  var reqCookie = $request.headers["Cookie"] || $request.headers["cookie"] || "";
  var m = reqCookie.match(/JSESSIONID=([^;]+)/);
  if (m && m[1]) {
    $prefs.setValueForKey(m[1], STORE_KEY);
    console.log("[" + TAG + "] ✅ JSESSIONID 已捕获: " + m[1].substring(0, 16) + "...");
  }
  $done({});

// ═══════════════════════════════════════════════════
//  模式 B：task 定时任务 —— 执行签到
// ═══════════════════════════════════════════════════
} else {
  var sessionId = $prefs.valueForKey(STORE_KEY) || "";
  console.log("[" + TAG + "] savedSession=" + (sessionId ? sessionId.substring(0, 16) + "..." : "空"));

  if (!sessionId) {
    $notify(TAG, "⚠️ 未获取到 Session",
      "请打开买单吧 App，进入签到页面操作一次，脚本自动保存登录状态");
    $done();
  } else {
    step1_getPage(sessionId);
  }
}

// ── Step 1: 请求签到页，提取参数 ──────────────────

function step1_getPage(sessionId) {
  $task.fetch({
    method: "GET", url: PAGE_URL, headers: makeHeaders(sessionId, false),
  }).then(function(resp) {
    console.log("[" + TAG + "] 页面 HTTP " + resp.statusCode);

    var newSess = extractSession(resp.headers);
    if (newSess) {
      sessionId = newSess;
      $prefs.setValueForKey(newSess, STORE_KEY);
      console.log("[" + TAG + "] Session 已续期: " + newSess.substring(0, 16) + "...");
    }

    var html = resp.body || "";
    if (!html || html.length < 200) {
      $notify(TAG, "❌ 页面内容为空", "请打开买单吧 App 进入签到页面后重试");
      $done(); return;
    }

    var token      = getVal(html, "token");
    var taskShowCd = getVal(html, "taskShowCd");
    var taskId     = getVal(html, "taskId");
    var signSts    = getVal(html, "signSts");

    console.log("[" + TAG + "] token="      + (token || "未找到"));
    console.log("[" + TAG + "] taskShowCd=" + taskShowCd);
    console.log("[" + TAG + "] taskId="     + taskId);
    console.log("[" + TAG + "] signSts="    + signSts);

    if (!token) {
      $prefs.setValueForKey("", STORE_KEY);
      $notify(TAG, "❌ Session 已失效",
        "请打开买单吧 App 重新进入签到页面，脚本自动恢复");
      $done(); return;
    }

    if (signSts === "1") {
      console.log("[" + TAG + "] 今日已签到，查询积分详情...");
      step3_getDetail(token, taskShowCd, taskId, sessionId, true);
      return;
    }

    step2_doSign(token, taskShowCd, taskId, sessionId);

  }).catch(function(err) {
    console.log("[" + TAG + "] 页面请求失败: " + JSON.stringify(err));
    $notify(TAG, "❌ 网络请求失败", String(err.error || err));
    $done();
  });
}

// ── Step 2: POST 签到接口 ──────────────────────────

function step2_doSign(token, taskShowCd, taskId, sessionId) {
  var url  = HOST + BASE + "/sign/sign?token=" + token;
  var body = JSON.stringify({ "taskShowCd": taskShowCd, "taskId": taskId });
  console.log("[" + TAG + "] 签到 URL: " + url);
  console.log("[" + TAG + "] 签到 Body: " + body);

  $task.fetch({
    method: "POST", url: url,
    headers: makeHeaders(sessionId, true),
    body: body,
  }).then(function(resp) {
    console.log("[" + TAG + "] 签到响应 HTTP " + resp.statusCode);
    console.log("[" + TAG + "] 签到响应: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var code     = json.returnCode || "";
    var msg      = json.returnMsg  || "";
    var data     = json.data       || {};
    var newToken = json.token      || token;

    if (code === "000000") {
      var itgBal = data.itgBal || data.itgBalance || "";
      $notify(TAG, "✅ 签到成功", "日期: " + today() + (itgBal ? "\n买单币余额: " + itgBal : ""));
      step3_getDetail(newToken, taskShowCd, taskId, sessionId, false);

    } else if (msg.indexOf("已签") >= 0 || code === "000001") {
      step3_getDetail(token, taskShowCd, taskId, sessionId, true);

    } else if (msg.indexOf("登录") >= 0 || msg.indexOf("失效") >= 0 ||
               msg.indexOf("过期") >= 0 || resp.statusCode === 401) {
      $prefs.setValueForKey("", STORE_KEY);
      $notify(TAG, "❌ 登录已失效", "请打开买单吧 App 重新进入签到页面");
      $done();

    } else {
      $notify(TAG, "⚠️ 签到返回异常",
        "returnCode: " + code + "\n" + (msg || "无错误信息"));
      $done();
    }

  }).catch(function(err) {
    console.log("[" + TAG + "] 签到失败: " + JSON.stringify(err));
    $notify(TAG, "❌ 签到请求失败", String(err.error || err));
    $done();
  });
}

// ── Step 3: 查询签到详情（积分/天数）──────────────

function step3_getDetail(token, taskShowCd, taskId, sessionId, alreadySigned) {
  var url  = HOST + BASE + "/sign/data?token=" + token;
  var body = JSON.stringify({ "taskShowCd": taskShowCd, "taskId": taskId });

  $task.fetch({
    method: "POST", url: url,
    headers: makeHeaders(sessionId, true),
    body: body,
  }).then(function(resp) {
    console.log("[" + TAG + "] 签到数据: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
    var lines = ["日期: " + today()];

    if (json.returnCode === "000000" && json.data) {
      var d = json.data;
      if (d.itgBal || d.itgBalance)  lines.push("买单币余额: " + (d.itgBal || d.itgBalance));
      if (d.totalDays)               lines.push("累计签到: " + d.totalDays + " 天");
      if (d.nextDays > 0)            lines.push("距进阶还差: " + d.nextDays + " 天");
      else if (d.nextDays === 0)     lines.push("🎉 已达进阶！");
      if (d.offDays)                 lines.push("活动还剩: " + d.offDays + " 天");
    } else {
      lines.push("（积分详情获取失败，不影响签到结果）");
    }

    $notify(TAG, title, lines.join("\n"));
    $done();

  }).catch(function() {
    var title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
    $notify(TAG, title, "日期: " + today() + "\n（积分详情获取失败）");
    $done();
  });
}
