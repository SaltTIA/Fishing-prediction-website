/**
 * history.js — 歷史指數記錄
 * 職責：
 *   1. 每次頁面載入時，將當日 overall_score 寫入 localStorage（每釣點獨立儲存）
 *   2. 渲染歷史記錄面板：Sparkline 折線 + 明細列表（最近 14 天）
 *   3. 提供清除歷史的功能
 */

const HISTORY_NS   = "hk_fish_history_v1"; // localStorage key 前綴
const MAX_DAYS     = 14;                     // 保留最多 14 天
const SCORE_COLORS = {
  great: "#6fcf97",
  good:  "#FF6B35",
  fair:  "#F4C95D",
  nogo:  "#ff8b7a",
};

// ---- 評級輔助 ----
function verdictOf(score) {
  if (score >= 80) return { label: "非常適合", key: "great" };
  if (score >= 60) return { label: "適合",     key: "good"  };
  if (score >= 40) return { label: "不太適合", key: "fair"  };
  return               { label: "不應該去", key: "nogo"  };
}

// ---- localStorage 讀寫 ----
function storageKey(spotId) {
  return `${HISTORY_NS}:${spotId}`;
}

function readHistory(spotId) {
  try {
    const raw = localStorage.getItem(storageKey(spotId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHistory(spotId, records) {
  try {
    localStorage.setItem(storageKey(spotId), JSON.stringify(records));
  } catch {
    // localStorage 可能滿了，忽略
  }
}

/**
 * 記錄當日指數（由 app.js 在資料載入後呼叫）
 * @param {string} spotId
 * @param {number} score   overall_score
 * @param {string} date    "YYYY-MM-DD"（可選，預設取今日）
 */
export function recordScore(spotId, score, date) {
  if (score == null || isNaN(score)) return;

  const today   = date ?? new Date().toISOString().slice(0, 10);
  const records = readHistory(spotId);

  // 若當天已有記錄，更新之（以最新值為準）
  const idx = records.findIndex(r => r.date === today);
  if (idx >= 0) {
    records[idx].score = Math.round(score * 10) / 10;
  } else {
    records.push({ date: today, score: Math.round(score * 10) / 10 });
  }

  // 按日期升序排列，只保留最近 MAX_DAYS 天
  records.sort((a, b) => a.date.localeCompare(b.date));
  if (records.length > MAX_DAYS) records.splice(0, records.length - MAX_DAYS);

  writeHistory(spotId, records);
}

/**
 * 清除某釣點的歷史（或全部）
 */
export function clearHistory(spotId) {
  if (spotId) {
    localStorage.removeItem(storageKey(spotId));
  } else {
    // 清除所有釣點歷史
    Object.keys(localStorage)
      .filter(k => k.startsWith(HISTORY_NS))
      .forEach(k => localStorage.removeItem(k));
  }
}

// ---- Sparkline SVG ----
function buildSparkline(records) {
  const W = 220, H = 48;
  const PAD = { t: 6, r: 4, b: 6, l: 4 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  if (records.length < 2) {
    return `<svg viewBox="0 0 ${W} ${H}" class="history-spark" aria-hidden="true">
      <text x="${W/2}" y="${H/2+4}" text-anchor="middle"
        style="fill:rgba(234,227,211,.3);font-size:10px">資料不足</text>
    </svg>`;
  }

  const scores = records.map(r => r.score);
  const minS   = Math.min(...scores);
  const maxS   = Math.max(...scores);
  const range  = Math.max(maxS - minS, 10); // 至少 10 分範圍，避免平線

  const toX = i => PAD.l + (i / (records.length - 1)) * cW;
  const toY = s => PAD.t + cH - ((s - minS) / range) * cH;

  const pts = records.map((r, i) => ({ x: toX(i), y: toY(r.score), r }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = linePath
    + ` L${pts[pts.length-1].x.toFixed(1)},${(PAD.t + cH).toFixed(1)}`
    + ` L${pts[0].x.toFixed(1)},${(PAD.t + cH).toFixed(1)} Z`;

  // 最後一點高亮
  const last  = pts[pts.length - 1];
  const vLast = verdictOf(last.r.score);

  return `
<svg viewBox="0 0 ${W} ${H}" class="history-spark" aria-label="歷史指數走勢">
  <defs>
    <linearGradient id="sparkGrad_${records.length}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FF6B35" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#FF6B35" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <path d="${areaPath}" fill="url(#sparkGrad_${records.length})"/>
  <path d="${linePath}" fill="none" stroke="#FF6B35" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5"
    fill="${SCORE_COLORS[vLast.key]}" stroke="var(--color-deep-sea)" stroke-width="1.5"/>
</svg>`.trim();
}

// ---- 格式化日期：M/D ----
function fmtDate(isoDate) {
  const [, m, d] = isoDate.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ---- 主渲染 ----
/**
 * @param {HTMLElement} containerEl  #history-section
 * @param {string}      spotId
 * @param {Function}    onClear      清除後呼叫（可重繪）
 */
export function renderHistory(containerEl, spotId, onClear) {
  if (!containerEl) return;

  const records = readHistory(spotId);

  if (!records.length) {
    containerEl.innerHTML = `
      <div class="history-empty">
        <span class="history-empty__icon">📅</span>
        尚無歷史記錄。每日載入頁面後系統將自動儲存當日指數。
      </div>`;
    return;
  }

  // Sparkline
  const sparkHTML = buildSparkline(records);

  // 趨勢方向（最近兩天比較）
  let trendHTML = "";
  if (records.length >= 2) {
    const diff = records[records.length-1].score - records[records.length-2].score;
    if (Math.abs(diff) < 1) {
      trendHTML = `<span class="history-trend history-trend--flat">→ 持平</span>`;
    } else if (diff > 0) {
      trendHTML = `<span class="history-trend history-trend--up">↑ +${diff.toFixed(1)}</span>`;
    } else {
      trendHTML = `<span class="history-trend history-trend--down">↓ ${diff.toFixed(1)}</span>`;
    }
  }

  // 最高 / 最低 / 平均
  const scores = records.map(r => r.score);
  const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
  const hi     = Math.max(...scores);
  const lo     = Math.min(...scores);

  // 明細列（最新在最前）
  const rowsHTML = [...records].reverse().map(r => {
    const v = verdictOf(r.score);
    return `
      <div class="history-row">
        <span class="history-row__date">${fmtDate(r.date)}</span>
        <div class="history-row__bar-wrap">
          <div class="history-row__bar-track">
            <div class="history-row__bar-fill" style="width:${r.score}%;background:${SCORE_COLORS[v.key]}"></div>
          </div>
        </div>
        <span class="history-row__score" style="color:${SCORE_COLORS[v.key]}">${r.score.toFixed(0)}</span>
        <span class="history-row__badge history-row__badge--${v.key}">${v.label}</span>
      </div>`;
  }).join("");

  containerEl.innerHTML = `
    <div class="history-panel">

      <!-- 頂部：走勢 + 統計 -->
      <div class="history-panel__header">
        <div class="history-panel__spark-wrap">
          ${sparkHTML}
          <div class="history-spark-meta">
            <span class="history-spark-meta__label">近 ${records.length} 天走勢</span>
            ${trendHTML}
          </div>
        </div>
        <div class="history-stats">
          <div class="history-stat">
            <div class="history-stat__val" style="color:#6fcf97">${hi.toFixed(0)}</div>
            <div class="history-stat__label">最高</div>
          </div>
          <div class="history-stat">
            <div class="history-stat__val" style="color:var(--color-sun-yellow)">${avg.toFixed(0)}</div>
            <div class="history-stat__label">平均</div>
          </div>
          <div class="history-stat">
            <div class="history-stat__val" style="color:#ffb4a3">${lo.toFixed(0)}</div>
            <div class="history-stat__label">最低</div>
          </div>
        </div>
      </div>

      <!-- 明細列表 -->
      <div class="history-rows">
        ${rowsHTML}
      </div>

      <!-- 底部操作 -->
      <div class="history-panel__footer">
        <span class="history-footer-note">資料儲存於瀏覽器本機，每日自動更新</span>
        <button class="history-clear-btn" id="history-clear-btn" aria-label="清除此釣點歷史記錄">
          🗑 清除記錄
        </button>
      </div>
    </div>
  `;

  // 清除按鈕
  const clearBtn = containerEl.querySelector("#history-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (confirm(`確定清除「${spotId}」的所有歷史記錄？`)) {
        clearHistory(spotId);
        if (typeof onClear === "function") onClear();
        else renderHistory(containerEl, spotId, onClear);
      }
    });
  }
}

export function renderHistoryLoading(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = `<div class="history-skeleton"></div>`;
}
