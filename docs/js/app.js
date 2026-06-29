/**
 * app.js — 主應用邏輯
 * 整合：釣點下拉選單 → 資料載入 → 圖表渲染 → 魚種看板 → 潮位刻度 → 今日總結卡
 */

import { loadSpotData } from "./data-loader.js";
import { renderChart }  from "./chart.js";
import { getFishEmoji } from "./fish-emoji.js";
import { renderSummary, renderSummaryLoading } from "./summary.js";

// ---- DOM 元素 ----
const spotSelect    = document.getElementById("spot-select");
const spotMetaEl    = document.getElementById("spot-meta");
const statusBanner  = document.getElementById("status-banner");
const chartWrap     = document.getElementById("chart-wrap");
const chartSubtitle = document.getElementById("chart-subtitle");
const fishGrid      = document.getElementById("fish-grid");
const tooltip       = document.getElementById("chart-tooltip");
const gaugeScore    = document.getElementById("gauge-score");
const gaugeFill     = document.getElementById("gauge-fill");
const gaugeBuoy     = document.getElementById("gauge-buoy");
const summaryCardEl = document.getElementById("summary-card");

// ---- 釣點設定（對應後端 spots_config.py，只有前端需要的部分） ----
const SPOTS = {
  tolo_harbour:  { name: "吐露港",  emoji: "⚓" },
  tsim_sha_tsui: { name: "尖沙咀",  emoji: "🌆" },
  cheung_chau:   { name: "長洲",    emoji: "🏝" },
  ng_tung_river: { name: "梧桐河",  emoji: "🌿" },
  tsuen_wan_pier:{ name: "荃灣碼頭", emoji: "🚢" },
  tuen_mun_pier: { name: "屯門碼頭", emoji: "⛵" },
};

// ---- 初始化下拉選單 ----
Object.entries(SPOTS).forEach(([id, cfg]) => {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = `${cfg.emoji} ${cfg.name}`;
  spotSelect.appendChild(opt);
});

// ---- 主流程：切換釣點 ----
async function onSpotChange(spotId) {
  // 1. 顯示 loading 狀態
  setStatus(null);
  chartWrap.innerHTML = `<div class="chart-skeleton"></div>`;
  fishGrid.innerHTML  = "";
  chartSubtitle.textContent = "載入中…";
  updateGauge(null);
  renderSummaryLoading(summaryCardEl);

  // 2. 載入資料
  const data = await loadSpotData(spotId);

  // 3. 錯誤處理
  if (data.status === "fetch_error") {
    setStatus("error", `⚠ ${data.error_message}`);
    chartWrap.innerHTML = `<div class="chart-empty"><div class="chart-empty__icon">🎣</div>資料載入失敗，請稍後再試</div>`;
    summaryCardEl.innerHTML = "";
    return;
  }
  if (data.status === "error") {
    setStatus("warn", `⚠ 後端報告錯誤：${data.error_message || "未知錯誤"}`);
  }

  // 4. 渲染趨勢圖
  const hours = data.hourly_scores ?? [];
  renderChart(chartWrap, hours, tooltip);

  // 計算當前分數（取最接近現在時刻的小時，或用 overall_score fallback）
  const nowHour  = new Date().getHours();  // 0-23，與 hourly_scores 的 hour 欄位一致
  const matchHr  = hours.find(h => h.hour === nowHour);
  const score    = matchHr?.final_score ?? data.overall_score ?? null;

  // 5. 更新 header 潮位刻度
  updateGauge(score);

  // 6. 更新 chart 副標題（資料來源、更新時間）
  const updatedAt = data.updated_at ?? data.generated_at ?? "";
  const timeStr   = updatedAt ? formatTime(updatedAt) : "—";
  chartSubtitle.textContent = `資料更新：${timeStr}`;

  // 7. 更新 spot meta
  const stationNote = data.station_note ?? "";
  spotMetaEl.innerHTML = stationNote
    ? `潮汐站：<strong>${data.station_id ?? ""}</strong>（${stationNote}）`
    : "";

  // 8. 渲染魚種卡片
  const fish = data.target_fish ?? [];
  renderFishBoard(fish);

  // 9. 渲染今日垂釣總結卡
  renderSummary(summaryCardEl, spotId, data);
}

// ---- 魚種看板渲染 ----
function renderFishBoard(fishList) {
  if (!fishList.length) {
    fishGrid.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.9rem">此釣點暫無魚種資料</p>`;
    return;
  }
  fishGrid.innerHTML = fishList.map(f => `
    <div class="fish-card">
      <div class="fish-card__emoji">${getFishEmoji(f.name, f.type)}</div>
      <div class="fish-card__name">${f.name}</div>
      <div class="fish-card__type">${f.type}</div>
    </div>
  `).join("");
}

// ---- 潮位刻度更新 ----
function updateGauge(score) {
  if (score == null) {
    gaugeFill.style.height = "0%";
    gaugeBuoy.style.bottom = "0%";
    gaugeScore.textContent = "--";
    return;
  }
  const pct = Math.max(0, Math.min(100, score));
  gaugeFill.style.height = pct + "%";
  gaugeBuoy.style.bottom = pct + "%";
  gaugeScore.textContent = pct.toFixed(0);
}

// ---- 狀態橫幅 ----
function setStatus(type, msg) {
  statusBanner.className = "status-banner";
  if (!type) return;
  statusBanner.textContent = msg;
  statusBanner.classList.add("is-visible", `status-banner--${type}`);
}

// ---- 時間格式化（ISO → 本地可讀） ----
function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("zh-HK", {
      month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

// ---- 事件監聽 ----
spotSelect.addEventListener("change", () => onSpotChange(spotSelect.value));

// ---- 初始載入第一個釣點 ----
onSpotChange(Object.keys(SPOTS)[0]);
