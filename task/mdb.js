/**
 * 买单吧 每日签到脚本
 * ─────────────────────────────────────────────────────────
 * 工作原理：
 *   通过 rewrite_local 拦截买单吧 App 的 API 请求，
 *   自动从请求头提取 token 并存入本地持久化，
 *   定时任务读取 Token 完成每日积分签到。
 *   全程无需 BoxJS，无需手动填写任何参数。
 *
 * ──────────── 配置步骤（复制到配置文件对应位置）────────────
 *
 * [rewrite_local]  ← 自动抓取 Token
 *   ^https?:\/\/api\.maidanbaa\.com url script-request-header MaiDanBa_SignIn.js
 *   ^https?:\/\/app\.maidanbaa\.com url script-request-header MaiDanBa_SignIn.js
 *
 * [task_local]  ← 每天 08:30 自动签到
 *   30 8 * * * MaiDanBa_SignIn.js, tag=买单吧签到, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/PayPal.png, enabled=true
 *
 * [mitm] hostname 追加：
 *   api.maidanbaa.com, app.maidanbaa.com
 *
 * ─── 首次使用 ───
 *   配置好后，打开买单吧 App 随便刷新一下（进首页/积分页均可），
 *   脚本自动保存 Token，之后每天 08:30 自动签到。
 * ──────────────────────────────────────────────────────────
 */

const TAG          = "买单吧签到";
const STORE_TOKEN  = "mdb_token";
const STORE_COOKIE = "mdb_cookie";

// 签到 & 积分查询接口（买单吧实际抓包路径）
const API_SIGN  = "https://api.maidanbaa.com/member/sign/doSign";
const API_QUERY = "https://api.maidanbaa.com/member/sign/querySign";
const API_INFO  = "https://api.maidanbaa.com/member/info/index";

// ── 环境判断 ──────────────────────────────────────────────
const isQX    = typeof $task !== "undefined";
const isSurge = typeof $httpClient !== "undefined" && !isQX;
const isLoon  = typeof $loon !== "undefined";

// ── 持久化存储（原生 API，不依赖 BoxJS）─────────────────────
const store = {
  read:  (k)    => isQX ? $prefs.valueForKey(k)          : $persistentStore.read(k),
  write: (k, v) => isQX ? $prefs.setValueForKey(v, k)    : $persistentStore.write(v, k),
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
    // 买单吧常见鉴权字段：token / Authorization / X-Token
    const token  = h["token"]         || h["Token"]
                || h["Authorization"] || h["authorization"]
                || h["X-Token"]       || h["x-token"] || "";
    const cookie = h["Cookie"] || h["cookie"] || "";

    if (token && token.length > 10) {
      store.write(STORE_TOKEN, token);
      console.log(`[${TAG}] ✅ Token 已自动保存`);
    }
    if (cookie) {
      store.write(STORE_COOKIE, cookie);
      console.log(`[${TAG}] ✅ Cookie 已自动保存`);
    }
    $done({});
    return;
  }

  // ━━━ 模式 B：定时任务——执行签到 ━━━━━━━━━━━━━━━━━━━━━
  const token  = store.read(STORE_TOKEN)  || "";
  const cookie = store.read(STORE_COOKIE) || "";

  if (!token) {
    notify(TAG, "⚠️ 尚未获取 Token",
      "请打开买单吧 App 随便操作一次，脚本将自动抓取 Token");
    $done();
    return;
  }

  const headers = {
    "Content-Type":    "application/json; charset=UTF-8",
    "Accept":          "application/json",
    "User-Agent":      "maidanbaa/5.0 (iPhone; iOS 17.4; Scale/3.00)",
    "token":           token,
    "Authorization":   token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    "Cookie":          cookie,
  };

  try {
    // Step 1：查询今日签到状态（避免重复签到）
    let alreadySigned = false;
    try {
      const queryResp = await fetch("GET", { url: API_QUERY, headers });
      const queryJson = safeJSON(queryResp.body);
      // 如果返回中包含今日已签标记
      const signed = queryJson?.data?.todaySigned
                  ?? queryJson?.data?.signed
                  ?? queryJson?.data?.signStatus;
      if (signed === true || signed === 1 || signed === "1") {
        alreadySigned = true;
      }
    } catch (_) {}

    if (alreadySigned) {
      notify(TAG, "ℹ️ 今日已签到", `日期：${today()}`);
      $done();
      return;
    }

    // Step 2：发起签到
    const signResp = await fetch("POST", {
      url: API_SIGN,
      headers,
      body: JSON.stringify({ signDate: today() }),
    });

    const json = safeJSON(signResp.body);
    console.log(`[${TAG}] 签到响应：${signResp.body}`);

    const code = String(json.code ?? json.returnCode ?? json.status ?? "");
    const msg  = String(json.message ?? json.msg ?? json.returnMsg ?? "");
    const data = json.data ?? {};

    // ── 成功 ──
    if (["0","200","success","SUCCESS"].includes(code) || msg.includes("成功")) {
      const points = data.points ?? data.integral ?? data.score ?? data.award ?? "";
      const pointTxt = points !== "" ? `，获得 ${points} 积分` : "";

      // Step 3：查询总积分
      let totalTxt = "";
      try {
        const infoResp = await fetch("GET", { url: API_INFO, headers });
        const info = safeJSON(infoResp.body);
        const total = info?.data?.points ?? info?.data?.integral ?? info?.data?.totalScore ?? "";
        if (total !== "") totalTxt = `\n当前积分：${total}`;
      } catch (_) {}

      // 查询连续签到天数
      let continueTxt = "";
      try {
        const qResp = await fetch("GET", { url: API_QUERY, headers });
        const q = safeJSON(qResp.body);
        const days = q?.data?.continueDays ?? q?.data?.keepDays ?? "";
        if (days !== "") continueTxt = `\n连续签到：${days} 天`;
      } catch (_) {}

      notify(TAG, `✅ 签到成功${pointTxt}`,
        `日期：${today()}${totalTxt}${continueTxt}`);

    // ── 已签到 ──
    } else if (msg.includes("已签到") || msg.includes("重复") || code === "1001") {
      notify(TAG, "ℹ️ 今日已签到", `日期：${today()}`);

    // ── Token 过期 ──
    } else if (["401","403"].includes(code)
            || msg.includes("登录") || msg.includes("过期") || msg.includes("失效")) {
      notify(TAG, "❌ Token 已失效", "请重新打开买单吧 App 操作一次以更新 Token");

    // ── 其他 ──
    } else {
      notify(TAG, "⚠️ 签到返回异常", `code=${code}  msg=${msg}`);
    }

  } catch (e) {
    notify(TAG, "❌ 网络请求失败", String(e));
    console.log(`[${TAG}] 错误：${e}`);
  }

  $done();
})();
