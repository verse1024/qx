/**
 * 买单吧 Session 保活脚本
 * ──────────────────────────────────────────
 * 作用：每 45 分钟静默请求一次签到页面，
 *       让服务器自动续期 JSESSIONID（防止 1 小时超时失效）。
 *       无签到功能，静默运行，正常情况不推通知。
 *
 * [task_local]
 * 0,45 * * * * https://raw.githubusercontent.com/verse1024/qx/refs/heads/main/task/mdb_alive.js, tag=买单吧保活, enabled=true
 * ──────────────────────────────────────────
 */

var TAG       = "买单吧保活";
var STORE_KEY = "mdb_jsessionid";   // 与签到脚本共用同一个存储 key
var HOST      = "https://creditcardapp.bankcomm.com";
var PAGE_URL  = HOST + "/mdlweb/ddySgn/index?channel=00";
var UA        = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148com.bankcomm.maidanba.V2;mapp_saoma;isApplePayUsable;paypinflag;newVCard;digitalcert;WKWebView;UnionPay/1.0 BoComMDB;buildVersion265;mdbTitleBar;";

// 保活脚本只有 task 模式，不需要 rewrite 拦截，无需判断 $request
var sessionId = $prefs.valueForKey(STORE_KEY) || "";
console.log("[" + TAG + "] 开始保活，Session=" + (sessionId ? sessionId.substring(0, 16) + "..." : "空"));

if (!sessionId) {
  // 没有 Session 时静默退出，不推通知（等签到脚本去提醒用户）
  console.log("[" + TAG + "] 无 Session，跳过本次保活");
  $done();
} else {
  $task.fetch({
    method: "GET",
    url: PAGE_URL,
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

    // 提取服务器下发的新 JSESSIONID 并保存
    var sc = resp.headers["Set-Cookie"] || resp.headers["set-cookie"] || "";
    if (Array.isArray(sc)) sc = sc.join("; ");
    var m = sc.match(/JSESSIONID=([^;,\s]+)/);

    if (m && m[1]) {
      $prefs.setValueForKey(m[1], STORE_KEY);
      console.log("[" + TAG + "] ✅ Session 续期成功: " + m[1].substring(0, 16) + "...");
    } else {
      console.log("[" + TAG + "] Session 未更新（服务器未下发新值，旧值继续有效）");
    }

    // 检查 Session 是否还有效（能拿到 token 说明页面正常返回）
    var html = resp.body || "";
    var tokenMatch = html.match(/id=["']token["'][^>]*?value=["']([^"']+)["']/);
    if (!tokenMatch) {
      tokenMatch = html.match(/value=["']([^"']+)["'][^>]*?id=["']token["']/);
    }

    if (tokenMatch) {
      console.log("[" + TAG + "] ✅ Session 有效，下次签到正常");
    } else if (html.indexOf("login") >= 0 || html.indexOf("登录") >= 0) {
      // Session 失效了，跳到登录页，推一条通知提醒用户
      $prefs.setValueForKey("", STORE_KEY);
      console.log("[" + TAG + "] ❌ Session 已失效，需要重新打开 App");
      $notify(TAG, "⚠️ 登录状态已失效",
        "请打开买单吧 App，进入签到页面，脚本自动恢复（每天只需操作一次）");
    } else {
      console.log("[" + TAG + "] 页面内容异常，但不影响下次签到");
    }

    $done();

  }).catch(function(err) {
    // 保活请求失败（可能是网络问题），静默处理不推通知
    console.log("[" + TAG + "] 请求失败（网络问题）: " + JSON.stringify(err));
    $done();
  });
}
