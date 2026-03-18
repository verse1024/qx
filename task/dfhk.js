/**
 * 东方航空 每日签到脚本
 * 适配平台：QuantumultX / Surge / Loon
 * 无需 BoxJS，Token 全自动抓取保存
 *
 * ══════════════ 配置说明 ══════════════
 *
 * [rewrite_local]
 * ^https?:\/\/api\.ceair\.com url script-request-header https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/dfhk.js
 *
 * [task_local]
 * 0 8 * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/dfhk.js, tag=东方航空签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/ChinaEastern_Airlines.png, enabled=true
 *
 * [mitm]
 * hostname 追加：api.ceair.com
 *
 * 使用方法：
 *   1. 配置好以上内容并保存
 *   2. 打开东方航空 App，随便刷新一下（进首页/积分页均可）
 *   3. 脚本自动保存 Token，之后每天 08:00 自动签到
 * ══════════════════════════════════════
 */

// ── QuantumultX 中：
//    rewrite 模式下  $request 存在，用于拦截抓 Token
//    task    模式下  $request 不存在，执行签到逻辑
//    两种模式下 $notify / $prefs / $task.fetch 均可直接使用，无需判断平台

const STORE_AUTH   = "ceair_auth";
const STORE_COOKIE = "ceair_cookie";
const TAG          = "东方航空签到";

// ═══════════════════════════════════
//  模式 A：rewrite 拦截 - 自动保存 Token
// ═══════════════════════════════════
if (typeof $request !== "undefined") {
  const headers = $request.headers;
  const auth    = headers["Authorization"] || headers["authorization"] || "";
  const cookie  = headers["Cookie"]        || headers["cookie"]        || "";

  if (auth && auth.length > 20) {
    $prefs.setValueForKey(auth, STORE_AUTH);
    console.log("[东方航空] ✅ Token 已自动保存：" + auth.substring(0, 30) + "...");
  }
  if (cookie && cookie.length > 5) {
    $prefs.setValueForKey(cookie, STORE_COOKIE);
    console.log("[东方航空] ✅ Cookie 已自动保存");
  }

  // 放行原请求，不做任何修改
  $done({});

} else {
  // ═══════════════════════════════════
  //  模式 B：task 定时任务 - 执行签到
  // ═══════════════════════════════════

  const auth   = $prefs.valueForKey(STORE_AUTH)   || "";
  const cookie = $prefs.valueForKey(STORE_COOKIE) || "";

  if (!auth || auth.length < 10) {
    $notify(TAG, "⚠️ 尚未获取到 Token",
      "请先打开东方航空 App 随便操作一次，脚本会自动抓取 Token 后再运行签到");
    $done();
  } else {
    doSign(auth, cookie);
  }
}

// ─────────────────────────────────────
function doSign(auth, cookie) {
  const headers = {
    "Content-Type":  "application/json; charset=UTF-8",
    "Accept":        "application/json",
    "User-Agent":    "ChinaEastern/10.6.0 (iPhone; iOS 17.4; Scale/3.00)",
    "Authorization": auth,
    "Cookie":        cookie,
  };

  // Step 1: 发起签到请求
  $task.fetch({
    method:  "POST",
    url:     "https://api.ceair.com/member/v3/signIn",
    headers: headers,
    body:    JSON.stringify({ channel: "APP", signType: "daily" }),
  }).then(function(resp) {
    console.log("[东方航空] 签到响应 status=" + resp.statusCode);
    console.log("[东方航空] 签到响应 body=" + resp.body);

    var json = {};
    try { json = JSON.parse(resp.body); } catch(e) {}

    var code = String(json.code    || json.returnCode || json.status  || "");
    var msg  = String(json.message || json.msg        || json.returnMsg || "");
    var data = json.data || {};

    // ── 签到成功 ──
    if (code === "0" || code === "200" || msg.indexOf("成功") >= 0) {
      var award = data.award || data.point || data.integral || data.mileage || "";
      var awardTxt = award ? "，获得 " + award + " 积分" : "";

      // Step 2: 查询总里程（可选，失败不影响主流程）
      $task.fetch({
        method:  "GET",
        url:     "https://api.ceair.com/member/v2/memberInfo",
        headers: headers,
      }).then(function(infoResp) {
        var info = {};
        try { info = JSON.parse(infoResp.body); } catch(e) {}
        var total = (info.data || {}).mileage || (info.data || {}).integral || "";
        var totalTxt = total ? "\n累计里程：" + total : "";
        $notify(TAG, "✅ 签到成功" + awardTxt, "日期：" + today() + totalTxt);
        $done();
      }).catch(function() {
        $notify(TAG, "✅ 签到成功" + awardTxt, "日期：" + today());
        $done();
      });

    // ── 今日已签 ──
    } else if (code === "1001" || msg.indexOf("已签") >= 0 || msg.indexOf("重复") >= 0) {
      $notify(TAG, "ℹ️ 今日已签到", "日期：" + today());
      $done();

    // ── Token 失效 ──
    } else if (code === "401" || code === "403" ||
               msg.indexOf("登录") >= 0 || msg.indexOf("过期") >= 0 || msg.indexOf("失效") >= 0) {
      $notify(TAG, "❌ Token 已失效", "请重新打开东方航空 App 操作一次，自动更新 Token");
      $done();

    // ── 其他情况 ──
    } else {
      $notify(TAG, "⚠️ 签到返回异常", "code=" + code + "  msg=" + msg);
      $done();
    }

  }).catch(function(err) {
    console.log("[东方航空] 请求失败：" + JSON.stringify(err));
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
