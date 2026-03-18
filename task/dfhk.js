/**
 * 东方航空 每日签到脚本
 * ─────────────────────────────────────────────────────────
 * 工作原理：
 *   通过 rewrite_local 拦截东方航空 App 的 API 请求，
 *   自动从请求头提取 Authorization Token 并存入本地持久化，
 *   定时任务读取已保存的 Token 完成每日自动签到。
 *   全程无需 BoxJS，无需手动填写任何参数。
 *
 * ──────────── 配置步骤（复制到配置文件对应位置）────────────
 *
 * [rewrite_local]  ← 自动抓取 Token
 *   ^https?:\/\/api\.ceair\.com url script-request-header ChinaEastern_SignIn.js
 *
 * [task_local]  ← 每天 08:00 自动签到
 *   0 8 * * * ChinaEastern_SignIn.js, tag=东方航空签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/ChinaEastern_Airlines.png, enabled=true
 *
 * [mitm] hostname 追加：
 *   api.ceair.com
 *
 * ─── 首次使用 ───
 *   配置好后，打开东方航空 App 随便刷新一下，
 *   脚本自动保存 Token，之后每天 08:00 自动签到。
 * ──────────────────────────────────────────────────────────
 */

const TAG = "东方航空签到";
const STORE_AUTH   = "ceair_auth";
const STORE_COOKIE = "ceair_cookie";
const API_SIGN     = "https://api.ceair.com/member/v3/signIn";
const API_INFO     = "https://api.ceair.com/member/v2/memberInfo";

// ── 环境判断 ──────────────────────────────────────────────
const isQX    = typeof $task !== "undefined";
const isSurge = typeof $httpClient !== "undefined" && !isQX;
const isLoon  = typeof $loon !== "undefined";

// ── 持久化存储（原生 API，不依赖 BoxJS）─────────────────────
const store = {
  read:  (k) => isQX ? $prefs.valueForKey(k)          : $persistentStore.read(k),
  write: (k, v) => isQX ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k),
};

// ── 通知 ──────────────────────────────────────────────────
function notify(title, subtitle, body) {
  if (isQX)             $notify(title, subtitle, body);
  else if (isSurge || isLoon) $notification.post(title, subtitle, body);
  else console.log(`[${title}] ${subtitle} ${body}`);
}

// ── HTTP 封装 ─────────────────────────────────────────────
function fetch(method, opts) {
  return new Promise((ok, fail) => {
    const req = { method, ...opts };
    if (isQX) {
      $task.fetch(req).then(ok).catch(fail);
    } else {
      const fn = method === "POST" ? $httpClient.post : $httpClient.get;
      fn(req, (e, r, b) => e ? fail(e) : ok({ ...r, body: b }));
    }
  });
}

// ── 工具 ─────────────────────────────────────────────────
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function safeJSON(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

// ═══════════════════════════════════════════════════════
//  主逻辑
// ═══════════════════════════════════════════════════════
(async () => {

  // ━━━ 模式 A：rewrite 拦截——自动保存 Token ━━━━━━━━━━━━
  if (typeof $request !== "undefined") {
    const h = $request.headers || {};
    const auth   = h["Authorization"]   || h["authorization"]   || "";
    const cookie = h["Cookie"]          || h["cookie"]          || "";
    if (auth.startsWith("Bearer ")) {
      store.write(STORE_AUTH, auth);
      console.log(`[${TAG}] ✅ Token 已自动保存`);
    }
    if (cookie) {
      store.write(STORE_COOKIE, cookie);
      console.log(`[${TAG}] ✅ Cookie 已自动保存`);
    }
    $done({});   // 放行请求，不修改
    return;
  }

  // ━━━ 模式 B：定时任务——执行签到 ━━━━━━━━━━━━━━━━━━━━━
  const auth   = store.read(STORE_AUTH)   || "";
  const cookie = store.read(STORE_COOKIE) || "";

  if (!auth) {
    notify(TAG, "⚠️ 尚未获取 Token",
      "请打开东方航空 App 随便操作一次，脚本将自动抓取 Token");
    $done();
    return;
  }

  const headers = {
    "Content-Type":    "application/json; charset=UTF-8",
    "Accept":          "application/json",
    "User-Agent":      "ChinaEastern/10.6.0 (iPhone; iOS 17.4; Scale/3.00)",
    "Authorization":   auth,
    "Cookie":          cookie,
  };

  try {
    // Step 1：发起签到
    const signResp = await fetch("POST", {
      url: API_SIGN,
      headers,
      body: JSON.stringify({ channel: "APP", signType: "daily" }),
    });

    const json = safeJSON(signResp.body);
    console.log(`[${TAG}] 签到响应：${signResp.body}`);

    const code = String(json.code ?? json.returnCode ?? json.status ?? "");
    const msg  = String(json.message ?? json.msg ?? json.returnMsg ?? "");
    const data = json.data ?? {};

    // ── 成功 ──
    if (["0","200","success","SUCCESS"].includes(code) || msg.includes("成功")) {
      const award = data.award ?? data.point ?? data.integral ?? data.mileage ?? "";
      const awardTxt = award !== "" ? `，获得 ${award} 积分` : "";

      // Step 2：查询总积分（可选）
      let totalTxt = "";
      try {
        const infoResp = await fetch("GET", { url: API_INFO, headers });
        const info = safeJSON(infoResp.body);
        const total = info?.data?.mileage ?? info?.data?.integral ?? "";
        if (total !== "") totalTxt = `\n累计里程：${total}`;
      } catch (_) {}

      notify(TAG, `✅ 签到成功${awardTxt}`, `日期：${today()}${totalTxt}`);

    // ── 已签到 ──
    } else if (["1001","repeated"].includes(code)
            || msg.includes("已签到") || msg.includes("重复")) {
      notify(TAG, "ℹ️ 今日已签到", `日期：${today()}`);

    // ── Token 过期 ──
    } else if (["401","403"].includes(code)
            || msg.includes("登录") || msg.includes("过期") || msg.includes("失效")) {
      notify(TAG, "❌ Token 已失效", "请重新打开东方航空 App 刷新一次以更新 Token");

    // ── 其他异常 ──
    } else {
      notify(TAG, "⚠️ 签到返回异常", `code=${code}  msg=${msg}`);
    }

  } catch (e) {
    notify(TAG, "❌ 网络请求失败", String(e));
    console.log(`[${TAG}] 错误：${e}`);
  }

  $done();
})();
