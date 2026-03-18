/**
 * 买单吧 每日签到脚本
 * 适配平台：QuantumultX / Surge / Loon
 * 无需 BoxJS，Token 全自动抓取保存
 *
 * ══════════════ 配置说明 ══════════════
 *
 * [rewrite_local]
 * ^https?:\/\/api\.maidanbaa\.com url script-request-header https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js
 *
 * [task_local]
 * 30 8 * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb.js, tag=买单吧签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/PayPal.png, enabled=true
 *
 * [mitm]
 * hostname 追加：api.maidanbaa.com
 *
 * 使用方法：
 *   1. 配置好以上内容并保存
 *   2. 打开买单吧 App，随便刷新一下（进首页/积分页均可）
 *   3. 脚本自动保存 Token，之后每天 08:30 自动签到
 * ══════════════════════════════════════
 */

// ── QuantumultX 中：
//    rewrite 模式下  $request 存在，用于拦截抓 Token
//    task    模式下  $request 不存在，执行签到逻辑
//    两种模式下 $notify / $prefs / $task.fetch 均可直接使用，无需判断平台

const STORE_TOKEN  = "mdb_token";
const STORE_COOKIE = "mdb_cookie";
const TAG          = "买单吧签到";

// ═══════════════════════════════════
//  模式 A：rewrite 拦截 - 自动保存 Token
// ═══════════════════════════════════
if (typeof $request !== "undefined") {
  const headers = $request.headers;

  // 买单吧鉴权字段可能是 token / Authorization / X-Token，逐一尝试
  const token =
    headers["token"]         ||
    headers["Token"]         ||
    headers["x-token"]       ||
    headers["X-Token"]       ||
    headers["Authorization"] ||
    headers["authorization"] ||
    "";
  const cookie = headers["Cookie"] || headers["cookie"] || "";

  if (token && token.length > 10) {
    $prefs.setValueForKey(token, STORE_TOKEN);
    console.log("[买单吧] ✅ Token 已自动保存：" + token.substring(0, 20) + "...");
  }
  if (cookie && cookie.length > 5) {
    $prefs.setValueForKey(cookie, STORE_COOKIE);
    console.log("[买单吧] ✅ Cookie 已自动保存");
  }

  // 放行原请求，不做任何修改
  $done({});

} else {
  // ═══════════════════════════════════
  //  模式 B：task 定时任务 - 执行签到
  // ═══════════════════════════════════

  const token  = $prefs.valueForKey(STORE_TOKEN)  || "";
  const cookie = $prefs.valueForKey(STORE_COOKIE) || "";

  if (!token || token.length < 10) {
    $notify(TAG, "⚠️ 尚未获取到 Token",
      "请先打开买单吧 App 随便操作一次（进首页/积分页均可），脚本会自动抓取 Token");
    $done();
  } else {
    doSign(token, cookie);
  }
}

// ─────────────────────────────────────
function doSign(token, cookie) {
  // 买单吧 token 字段名通常直接叫 token（不带 Bearer 前缀）
  // 同时也放 Authorization 兜底
  const headers = {
    "Content-Type":  "application/json; charset=UTF-8",
    "Accept":        "application/json",
    "User-Agent":    "maidanbaa/5.2 (iPhone; iOS 17.4; Scale/3.00)",
    "token":         token,
    "Authorization": token.startsWith("Bearer ") ? token : ("Bearer " + token),
    "Cookie":        cookie,
  };

  // Step 1: 先查询今日签到状态，避免重复签到报错
  $task.fetch({
    method:  "GET",
    url:     "https://api.maidanbaa.com/member/sign/querySign",
    headers: headers,
  }).then(function(queryResp) {
    console.log("[买单吧] 查询签到状态：" + queryResp.body);

    var q = {};
    try { q = JSON.parse(queryResp.body); } catch(e) {}
    var d = q.data || {};

    // 如果今天已签到，直接通知不重复请求
    var signed = d.todaySigned || d.signed || d.signStatus || d.isSign || 0;
    if (signed === true || signed === 1 || signed === "1" || signed === "true") {
      var total = d.totalScore || d.points || d.integral || "";
      var days  = d.continueDays || d.keepDays || d.continuousDay || "";
      var sub   = "日期：" + today();
      if (total) sub += "\n当前积分：" + total;
      if (days)  sub += "\n连续签到：" + days + " 天";
      $notify(TAG, "ℹ️ 今日已签到", sub);
      $done();
      return;
    }

    // Step 2: 发起签到
    sendSign(headers);

  }).catch(function(err) {
    console.log("[买单吧] 查询签到状态失败，直接尝试签到：" + JSON.stringify(err));
    // 查询失败不阻断，直接尝试签到
    sendSign(headers);
  });
}

function sendSign(headers) {
  var signDate = today();

  $task.fetch({
    method:  "POST",
    url:     "https://api.maidanbaa.com/member/sign/doSign",
    headers: headers,
    body:    JSON.stringify({ signDate: signDate }),
  }).then(function(resp) {
    console.log("[买单吧] 签到响应 status=" + resp.statusCode);
    console.log("[买单吧] 签到响应 body=" + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var code = String(json.code    || json.returnCode || json.status  || "");
    var msg  = String(json.message || json.msg        || json.returnMsg || "");
    var data = json.data || {};

    // ── 签到成功 ──
    if (code === "0" || code === "200" || code === "success" ||
        msg.indexOf("成功") >= 0) {

      var points = data.points || data.integral || data.score || data.award || "";
      var pointTxt = points ? "，获得 " + points + " 积分" : "";

      // Step 3: 签到成功后再查一次积分和连续天数
      $task.fetch({
        method:  "GET",
        url:     "https://api.maidanbaa.com/member/sign/querySign",
        headers: headers,
      }).then(function(qResp) {
        var q = {};
        try { q = JSON.parse(qResp.body); } catch(e) {}
        var d = q.data || {};
        var total = d.totalScore  || d.points || d.integral || "";
        var days  = d.continueDays || d.keepDays || d.continuousDay || "";
        var sub = "日期：" + today();
        if (total) sub += "\n当前积分：" + total;
        if (days)  sub += "\n连续签到：" + days + " 天";
        $notify(TAG, "✅ 签到成功" + pointTxt, sub);
        $done();
      }).catch(function() {
        $notify(TAG, "✅ 签到成功" + pointTxt, "日期：" + today());
        $done();
      });

    // ── 今日已签 ──
    } else if (msg.indexOf("已签") >= 0 || msg.indexOf("重复") >= 0 || code === "1001") {
      $notify(TAG, "ℹ️ 今日已签到", "日期：" + today());
      $done();

    // ── Token 失效 ──
    } else if (code === "401" || code === "403" ||
               msg.indexOf("登录") >= 0 || msg.indexOf("过期") >= 0 ||
               msg.indexOf("失效") >= 0 || msg.indexOf("未授权") >= 0) {
      $notify(TAG, "❌ Token 已失效", "请重新打开买单吧 App 操作一次，自动更新 Token");
      $done();

    // ── 其他情况，打印详情方便排查 ──
    } else {
      $notify(TAG, "⚠️ 签到返回异常",
        "code=" + code + "\nmsg=" + msg + "\n如持续失败请截图反馈");
      $done();
    }

  }).catch(function(err) {
    console.log("[买单吧] 签到请求失败：" + JSON.stringify(err));
    $notify(TAG, "❌ 网络请求失败", String(err.error || err));
    $done();
  });
}

function today() {
  var d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
