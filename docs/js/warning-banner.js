/**
 * warning-banner.js — 台風 / 惡劣天氣警告橫幅
 * -------------------------------------------------------
 * 從香港天文台 Open Data API 拉取現行警告信號，
 * 依嚴重程度顯示全幅警告橫幅。
 *
 * HKO API：
 *   https://data.weather.gov.hk/weatherAPI/opendata/weather.php
 *     ?dataType=warningInfo&lang=tc
 */

// ---- 訊號嚴重程度對照表 ----
// 每個條目：{ key, label, level: 'caution'|'warning'|'danger', icon }
// key 對應 HKO JSON 的 warningStatementCode
const SIGNAL_DEFS = [
  // 台風
  { code: "TC1",  label: "一號戒備信號",   level: "caution", icon: "🌀" },
  { code: "TC3",  label: "三號強風信號",   level: "warning", icon: "🌀" },
  { code: "TC8NE",label: "八號東北烈風信號", level: "danger", icon: "🌀" },
  { code: "TC8SE",label: "八號東南烈風信號", level: "danger", icon: "🌀" },
  { code: "TC8NW",label: "八號西北烈風信號", level: "danger", icon: "🌀" },
  { code: "TC8SW",label: "八號西南烈風信號", level: "danger", icon: "🌀" },
  { code: "TC9",  label: "九號烈風或暴風風力增強信號", level: "danger", icon: "🌀" },
  { code: "TC10", label: "十號颶風信號",   level: "danger", icon: "🌀" },
  // 雨
  { code: "WRAIN", label: "黃色暴雨警告",  level: "caution", icon: "🌧" },
  { code: "RAIN",  label: "紅色暴雨警告",  level: "warning", icon: "🌧" },
  { code: "BRAIN", label: "黑色暴雨警告",  level: "danger",  icon: "⛈" },
  // 雷暴
  { code: "WTMW",  label: "雷暴警告",      level: "caution", icon: "⚡" },
  // 強烈季候風
  { code: "WMSGNL",label: "強烈季候風信號", level: "warning", icon: "💨" },
  // 山泥傾瀉
  { code: "LANDSLIP", label: "山泥傾瀉警告", level: "warning", icon: "⛰" },
  // 霜凍
  { code: "FROST", label: "霜凍警告",       level: "caution", icon: "❄️" },
  // 酷熱
  { code: "VHT",   label: "酷熱天氣警告",   level: "caution", icon: "🌡" },
  // 海嘯
  { code: "TSUNAMI", label: "海嘯警告",     level: "danger",  icon: "🌊" },
];

// 訊號代碼 → 定義
const SIGNAL_MAP = Object.fromEntries(SIGNAL_DEFS.map(d => [d.code, d]));

// ---- 嚴重程度排序（數字越高越嚴重）----
const LEVEL_RANK = { caution: 1, warning: 2, danger: 3 };

// ---- 出釣禁止的等級 ----
const NO_FISH_LEVEL = "danger";  // danger 等級強制建議不要出釣

// ---- 禁止出釣的特定訊號 ----
const NO_FISH_CODES = new Set([
  "TC8NE","TC8SE","TC8NW","TC8SW","TC9","TC10","BRAIN","TSUNAMI"
]);

// ---- HKO API ----
const HKO_WARNING_URL =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc";

// 如果跨域失敗，使用代理備案（GitHub Pages 部署時可能有 CORS 問題，
// 這裡用 allorigins 作備案；若兩者都失敗則靜默不顯示橫幅）
const HKO_PROXY_URL =
  "https://api.allorigins.win/get?url=" +
  encodeURIComponent(HKO_WARNING_URL);

/**
 * 初始化警告橫幅。
 * @param {HTMLElement} bannerEl  — #weather-warning-banner 容器
 */
export async function initWarningBanner(bannerEl) {
  if (!bannerEl) return;

  // 先顯示骨架（不強制佔高，僅補間過渡）
  // bannerEl.innerHTML = `<div class="warning-banner__skeleton"></div>`;

  try {
    const warnings = await fetchWarnings();
    renderWarningBanner(bannerEl, warnings);
  } catch (err) {
    // 靜默失敗：網路問題時不打斷主功能
    console.warn("[warning-banner] 無法取得警告資料：", err.message);
    bannerEl.innerHTML = "";
  }
}

/**
 * 從 HKO 拉取現行警告（含 CORS 備案）。
 * @returns {Array} 警告物件陣列（可能為空）
 */
async function fetchWarnings() {
  // 嘗試直接呼叫（GitHub Pages 同源允許）
  try {
    const resp = await fetch(HKO_WARNING_URL, {
      cache: "no-cache",
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const json = await resp.json();
      return parseHKOWarnings(json);
    }
  } catch {
    // 直接請求失敗（CORS 或超時），嘗試代理
  }

  // 備案：通過代理
  const proxyResp = await fetch(HKO_PROXY_URL, {
    cache: "no-cache",
    signal: AbortSignal.timeout(8000),
  });
  if (!proxyResp.ok) throw new Error(`代理回傳 HTTP ${proxyResp.status}`);
  const wrapper = await proxyResp.json();
  const json = JSON.parse(wrapper.contents);
  return parseHKOWarnings(json);
}

/**
 * 解析 HKO warningInfo JSON → 標準化警告陣列。
 * HKO 格式：{ details: [ { warningStatementCode, contents: [...] }, ... ] }
 */
function parseHKOWarnings(json) {
  const details = json?.details ?? [];
  return details
    .map(item => {
      const code = item.warningStatementCode;
      const def  = SIGNAL_MAP[code];
      // 取 contents 第一段文字作為說明
      const descRaw = item.contents?.[0]?.value ?? "";
      // 清理：移除連續空白
      const desc = descRaw.replace(/\s+/g, " ").trim().slice(0, 120);
      return {
        code,
        def,    // 可能 undefined（未知訊號代碼）
        desc,
        updateTime: item.updateTime ?? "",
      };
    })
    .filter(w => w.def); // 只保留已知類型
}

/**
 * 依解析結果渲染橫幅。
 */
function renderWarningBanner(bannerEl, warnings) {
  if (!warnings.length) {
    // 目前無警告：確保橫幅隱藏
    bannerEl.className = "weather-warning-banner";
    bannerEl.innerHTML = "";
    return;
  }

  // 決定整體最高嚴重程度
  const maxLevel = warnings.reduce((best, w) => {
    const rank = LEVEL_RANK[w.def.level] ?? 0;
    return rank > (LEVEL_RANK[best] ?? 0) ? w.def.level : best;
  }, "caution");

  // 是否需要「勿出海」標籤
  const noFish =
    maxLevel === NO_FISH_LEVEL ||
    warnings.some(w => NO_FISH_CODES.has(w.code));

  // 選第一個圖示（最嚴重的）
  const topSignal = warnings
    .slice()
    .sort((a, b) => (LEVEL_RANK[b.def.level] ?? 0) - (LEVEL_RANK[a.def.level] ?? 0))[0];
  const icon = topSignal.def.icon;

  // 組 badge HTML
  const badgesHTML = warnings
    .map(w => `
      <span class="warning-signal-badge" title="${w.desc || w.def.label}">
        ${w.def.icon} ${w.def.label}
      </span>
    `)
    .join("");

  const noFishHTML = noFish
    ? `<span class="warning-no-fish-tag">⚠ 強烈建議勿出海垂釣</span>`
    : "";

  // 更新時間（取最近一個）
  const latestTime = warnings
    .map(w => w.updateTime)
    .filter(Boolean)
    .sort()
    .pop() ?? "";
  const timeStr = latestTime
    ? formatHKOTime(latestTime)
    : "";

  // 描述（取最嚴重的那一條）
  const topDesc = topSignal.desc;

  bannerEl.innerHTML = `
    <div class="warning-banner__inner">
      <div class="warning-banner__icon" aria-hidden="true">${icon}</div>
      <div class="warning-banner__body">
        <div class="warning-banner__title">
          香港天文台現行警告
          ${noFishHTML}
        </div>
        <div class="warning-banner__signals" role="list" aria-label="現行警告信號">
          ${badgesHTML}
        </div>
        ${topDesc ? `<div class="warning-banner__desc">${topDesc}${timeStr ? `&emsp;<span style="font-family:var(--font-mono);font-size:0.7rem;opacity:0.6">${timeStr} 更新</span>` : ""}</div>` : ""}
      </div>
      <a
        class="warning-banner__link"
        href="https://www.hko.gov.hk/tc/warnigns/warnings.htm"
        target="_blank"
        rel="noopener"
        aria-label="查看天文台官方警告"
      >天文台官網 →</a>
    </div>
  `;

  // 套用嚴重程度 class
  bannerEl.className =
    `weather-warning-banner weather-warning-banner--${maxLevel} is-active`;
}

/**
 * 格式化 HKO 時間字串（20260630T1830+0800 → 6月30日 18:30）
 */
function formatHKOTime(raw) {
  try {
    // HKO 格式範例：20260629T183024+0800
    const iso = raw
      .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*$/, "$1-$2-$3T$4:$5")
      + "+08:00";
    const d = new Date(iso);
    if (isNaN(d)) return raw;
    return d.toLocaleString("zh-HK", {
      month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return raw;
  }
}
