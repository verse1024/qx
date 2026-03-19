/**
 * 买单吧（交通银行）每日签到脚本
 * 基于真实抓包数据编写，100% 还原 App 签到流程
 * ─────────────────────────────────────────────────────
 *
 * 【签到机制】（来自真实抓包 JS 源码逆向）
 *   Step 1: GET 签到页面 HTML → 提取 token / taskShowCd / taskId
 *   Step 2: POST 签到接口    → 提交签到，返回买单币余额
 *   Step 3: POST 数据接口    → 获取连续签到天数
 *
 * 【真实接口】
 *   签到页:  GET  https://creditcardapp.bankcomm.com/mdlweb/ddySgn/index?channel=00
 *   签到:    POST https://creditcardapp.bankcomm.com/mdlweb/sign/sign?token={token}
 *   数据:    POST https://creditcardapp.bankcomm.com/mdlweb/sign/data?token={token}
 *
 * 【鉴权方式】
 *   Cookie: JSESSIONID（进入签到页时服务器下发，每次请求自动续期）
 *   token（从 HTML 里的隐藏 input 实时提取，每次都不同）
 *
 * ────────────────── 配置步骤 ──────────────────
 *
 * [rewrite_local]
 * # 自动捕获 JSESSIONID
 * ^https?:\/\/creditcardapp\.bankcomm\.com\/mdlweb\/ddySgn url script-request-header https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js
 *
 * [task_local]
 * # 每天 08:30 签到
 * 30 8 * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js, tag=买单吧签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/PayPal.png, enabled=true
 * # 每 45 分钟保活一次（防止 JSESSIONID 超时，全天候维持 Session 有效）
 * 0,45 * * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js, tag=买单吧保活, enabled=true
 *
 * [mitm]
 * hostname 加入：creditcardapp.bankcomm.com
 *
 * ────────────────── 使用方法 ──────────────────
 * 1. 配置好上面内容后保存
 * 2. 打开买单吧 App 进入签到页面（首次触发 rewrite 保存 Session）
 * 3. 之后完全自动，Session 每 45 分钟自动续期，永不失效
 * ──────────────────────────────────────────────
 */

var TAG        = "买单吧签到";
var TAG_ALIVE  = "买单吧保活";
var STORE_KEY  = "mdb_jsessionid";
var HOST       = "https://creditcardapp.bankcomm.com";
var PAGE_URL   = HOST + "/mdlweb/ddySgn/index?channel=00";
var BASE       = "/mdlweb";  // 已从日志确认
var UA         = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148com.bankcomm.maidanba.V2;mapp_saoma;isApplePayUsable;paypinflag;newVCard;digitalcert;WKWebView;UnionPay/1.0 BoComMDB;buildVersion265;mdbTitleBar;";

// ─────────────────────────────────────────────────
// 从 Set-Cookie 响应头提取 JSESSIONID
// 兼容字符串和数组两种格式
// ─────────────────────────────────────────────────
function extractSession(headers) {
  // 圈X有时把多个 Set-Cookie 合并成一个字符串，有时是数组
  var sc = headers["Set-Cookie"] || headers["set-cookie"] || "";
  if (Array.isArray(sc)) sc = sc.join("; ");
  var m = sc.match(/JSESSIONID=([^;,\s]+)/);
  return m ? m[1] : "";
}

// ─────────────────────────────────────────────────
// 请求签到页面，更新 JSESSIONID，返回 HTML
// 这是签到和保活的共用入口
// ─────────────────────────────────────────────────
function fetchPage(sessionId, callback) {
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
    console.log("[买单吧] 页面 HTTP " + resp.statusCode);

    // 提取并保存最新 JSESSIONID（每次请求服务器都会下发新的）
    var newSess = extractSession(resp.headers);
    if (newSess) {
      $prefs.setValueForKey(newSess, STORE_KEY);
      sessionId = newSess;
      console.log("[买单吧] ✅ Session 已续期: " + newSess.substring(0, 16) + "...");
    } else {
      console.log("[买单吧] Session 未更新（服务器未下发新值，继续使用旧值）");
    }

    callback(null, resp.body || "", sessionId);

  }).catch(function(err) {
    callback(err, "", sessionId);
  });
}

// ─────────────────────────────────────────────────
// 从 HTML 提取隐藏字段值
// ─────────────────────────────────────────────────
function getVal(html, id) {
  var r1 = new RegExp('id=["\']' + id + '["\'][^>]*?value=["\']([^"\']*)["\']');
  var r2 = new RegExp('value=["\']([^"\']*)["\'][^>]*?id=["\']' + id + '["\']');
  var m = html.match(r1) || html.match(r2);
  return m ? m[1] : "";
}

// ─────────────────────────────────────────────────
// 今天日期
// ─────────────────────────────────────────────────
function today() {
  var d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}


// ═══════════════════════════════════════════════════════
//  模式 A：rewrite 拦截 —— 自动保存 JSESSIONID
//
//  你打开买单吧 App 进入签到页时触发。
//  从请求的 Cookie 里提取 JSESSIONID 存到本地。
// ═══════════════════════════════════════════════════════
if (typeof $request !== "undefined") {
  var reqCookie = $request.headers["Cookie"] || $request.headers["cookie"] || "";
  var m = reqCookie.match(/JSESSIONID=([^;]+)/);
  if (m && m[1]) {
    $prefs.setValueForKey(m[1], STORE_KEY);
    console.log("[买单吧] ✅ JSESSIONID 已捕获保存: " + m[1].substring(0, 16) + "...");
  }
  $done({});  // 放行原请求，不做任何修改


// ═══════════════════════════════════════════════════════
//  模式 B：task 定时任务
//
//  通过 tag 名称区分是「签到」还是「保活」：
//  - tag 里含 "保活" → 只请求页面刷新 Session，不签到
//  - tag 里含 "签到" → 完整签到流程
//
//  注意：$task_info 在圈X里包含当前 task 的 tag 信息
// ═══════════════════════════════════════════════════════
} else {
  var sessionId = $prefs.valueForKey(STORE_KEY) || "";
  console.log("[买单吧] savedSession=" + (sessionId ? sessionId.substring(0, 16) + "..." : "空"));

  // 判断是签到任务还是保活任务（通过 tag 区分）
  var taskTag = ($task_info && $task_info.tag) ? $task_info.tag : "";
  var isAlive = taskTag.indexOf("保活") >= 0;
  console.log("[买单吧] 任务类型: " + (isAlive ? "保活" : "签到") + "  tag=" + taskTag);

  if (!sessionId) {
    var tag = isAlive ? TAG_ALIVE : TAG;
    $notify(tag, "⚠️ 未获取到 Session",
      "请先打开买单吧 App，进入签到页面操作一次，脚本自动保存登录状态");
    $done();
  } else if (isAlive) {
    // ── 保活模式：只刷新 Session，不签到，不推通知 ──
    runAlive(sessionId);
  } else {
    // ── 签到模式：完整签到流程 ──
    runSign(sessionId);
  }
}


// ═══════════════════════════════════════════════════════
//  保活流程：请求签到页，刷新 JSESSIONID，静默结束
// ═══════════════════════════════════════════════════════
function runAlive(sessionId) {
  fetchPage(sessionId, function(err, html, newSession) {
    if (err) {
      console.log("[买单吧保活] 请求失败: " + JSON.stringify(err));
      // 保活失败静默处理，不推通知避免打扰
      $done();
      return;
    }
    // 检查 Session 是否还有效（能拿到 token 说明有效）
    var token = getVal(html, "token");
    if (token) {
      console.log("[买单吧保活] ✅ Session 续期成功，下次签到正常");
    } else {
      // Session 已失效，推一条通知提醒
      console.log("[买单吧保活] ❌ Session 失效，需要重新打开 App");
      $notify(TAG_ALIVE, "⚠️ Session 已失效",
        "请打开买单吧 App 进入签到页面，自动恢复登录状态");
    }
    $done();
  });
}


// ═══════════════════════════════════════════════════════
//  签到流程：完整三步签到
// ═══════════════════════════════════════════════════════
function runSign(sessionId) {
  fetchPage(sessionId, function(err, html, newSession) {
    if (err) {
      console.log("[买单吧] 页面请求失败: " + JSON.stringify(err));
      $notify(TAG, "❌ 网络请求失败", "请检查节点是否正常\n" + (err.error || err));
      $done();
      return;
    }

    if (!html || html.length < 200) {
      $notify(TAG, "❌ 页面内容为空", "请先打开买单吧 App 进入签到页面");
      $done();
      return;
    }

    var token      = getVal(html, "token");
    var taskShowCd = getVal(html, "taskShowCd");
    var taskId     = getVal(html, "taskId");
    var signSts    = getVal(html, "signSts");

    console.log("[买单吧] token="      + (token      || "未找到"));
    console.log("[买单吧] taskShowCd=" + (taskShowCd || "未找到"));
    console.log("[买单吧] taskId="     + (taskId     || "未找到"));
    console.log("[买单吧] signSts="    + signSts);

    if (!token) {
      var isLoginPage = html.indexOf("login") >= 0 || html.indexOf("登录") >= 0;
      $prefs.setValueForKey("", STORE_KEY);
      $notify(TAG, "❌ Session 已失效",
        isLoginPage
          ? "已跳到登录页，请打开买单吧 App 重新登录后进入签到页面"
          : "未获取到 token，请打开买单吧 App 进入签到页面后重试");
      $done();
      return;
    }

    // 今日已签到 → 查详情后通知
    if (signSts === "1") {
      console.log("[买单吧] 今日已签到，查询积分详情...");
      step3_getDetail(token, taskShowCd, taskId, newSession, true);
      return;
    }

    // 未签到 → 执行签到
    step2_doSign(token, taskShowCd, taskId, newSession);
  });
}


// ─────────────────────────────────────────────────
// Step 2: POST 签到接口
// ─────────────────────────────────────────────────
function step2_doSign(token, taskShowCd, taskId, sessionId) {
  var url  = HOST + BASE + "/sign/sign?token=" + token;
  var body = JSON.stringify({ "taskShowCd": taskShowCd, "taskId": taskId });

  console.log("[买单吧] 签到 URL: " + url);
  console.log("[买单吧] 签到 Body: " + body);

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
    console.log("[买单吧] 签到响应 HTTP " + resp.statusCode);
    console.log("[买单吧] 签到响应: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {
      console.log("[买单吧] JSON 解析失败: " + resp.body);
    }

    var code     = json.returnCode || "";
    var msg      = json.returnMsg  || "";
    var data     = json.data       || {};
    var newToken = json.token      || token;

    if (code === "000000") {
      var itgBal = data.itgBal || data.itgBalance || "";
      var balTxt = itgBal ? "\n买单币余额: " + itgBal : "";
      $notify(TAG, "✅ 签到成功", "日期: " + today() + balTxt);
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
        "returnCode: " + code + "\n" + (msg || "无错误信息") + "\n请截图日志反馈");
      $done();
    }

  }).catch(function(err) {
    console.log("[买单吧] 签到请求失败: " + JSON.stringify(err));
    $notify(TAG, "❌ 签到请求失败", String(err.error || err));
    $done();
  });
}


// ─────────────────────────────────────────────────
// Step 3: 查询签到详情（积分余额 / 连续天数）
// alreadySigned=true 今日已签，false 刚签成功
// ─────────────────────────────────────────────────
function step3_getDetail(token, taskShowCd, taskId, sessionId, alreadySigned) {
  var url  = HOST + BASE + "/sign/data?token=" + token;
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
    console.log("[买单吧] 签到数据响应: " + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
    var lines = ["日期: " + today()];

    if (json.returnCode === "000000" && json.data) {
      var d = json.data;
      var itgBal = d.itgBal || d.itgBalance || d.totalItg || "";
      if (itgBal)          lines.push("买单币余额: " + itgBal);
      if (d.totalDays)     lines.push("累计签到: " + d.totalDays + " 天");
      if (d.nextDays > 0)  lines.push("距进阶还差: " + d.nextDays + " 天");
      if (d.nextDays === 0) lines.push("🎉 已达进阶！");
      if (d.offDays)       lines.push("活动还剩: " + d.offDays + " 天");
    } else {
      lines.push("（积分详情获取失败，签到结果不受影响）");
    }

    $notify(TAG, title, lines.join("\n"));
    $done();

  }).catch(function() {
    var title = alreadySigned ? "ℹ️ 今日已签到" : "✅ 签到成功";
    $notify(TAG, title, "日期: " + today() + "\n（积分详情获取失败）");
    $done();
  });
}
