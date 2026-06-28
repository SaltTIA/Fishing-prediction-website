/**
 * 24小時垂釣指數折線圖（純 SVG，無外部依賴）
 * ============================================================
 * 輸入：hourly_scores 陣列，每個元素含 { hour, final_score, ... }
 * 輸出：把 SVG 注入到 .chart-svg-wrap 容器裡
 */

const W = 600;     // viewBox 寬度（實際會被 CSS 縮放）
const H = 180;     // viewBox 高度
const PAD = { top: 16, right: 16, bottom: 32, left: 36 };

const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top  - PAD.bottom;

/** 把 score(0~100) 映射到 Y 座標，score 越高越靠上 */
function scoreToY(score) {
  return PAD.top + CHART_H - (Math.max(0, Math.min(100, score)) / 100) * CHART_H;
}

/** 把小時 index (0~23) 映射到 X 座標 */
function hourToX(i, total) {
  if (total <= 1) return PAD.left + CHART_W / 2;
  return PAD.left + (i / (total - 1)) * CHART_W;
}

/**
 * 從 hourly_scores 元素解析出 0-23 的顯示小時數
 * 相容兩種 Python 輸出：
 *   - HHOT 約定：hour 為 1-24（1=0時, 24=23時）
 *   - datetime.hour：hour 為 0-23
 * 如果 hour 欄位不存在或無效，fallback 用陣列 index
 */
function resolveDisplayHour(h, index) {
  const raw = h.hour;
  if (raw == null || isNaN(Number(raw))) return index % 24;
  const n = Number(raw);
  if (n >= 1 && n <= 24) return n - 1;   // HHOT 1-24 → 0-23
  if (n >= 0 && n <= 23) return n;        // datetime.hour 0-23
  return index % 24;                       // 其他值 fallback
}

/**
 * @param {HTMLElement} wrapEl   .chart-svg-wrap 元素
 * @param {Array}       hours    hourly_scores 陣列（已按 hour 排序）
 * @param {HTMLElement} tooltip  .chart-tooltip 元素
 */
export function renderChart(wrapEl, hours, tooltip) {
  if (!hours || hours.length === 0) {
    wrapEl.innerHTML = `
      <div class="chart-empty">
        <div class="chart-empty__icon">🎣</div>
        暫無每小時資料
      </div>`;
    return;
  }

  const pts = hours.map((h, i) => ({
    x: hourToX(i, hours.length),
    y: scoreToY(h.final_score),
    score: h.final_score,
    displayHour: resolveDisplayHour(h, i),   // ← 統一用這個，不直接碰 h.hour
    wind_score: h.wind_score,
    tide_score: h.tide_score,
    index: i,
  }));

  // 折線路徑
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  // 面積填充路徑（線 → 右下角 → 左下角閉合）
  const areaPath = linePath
    + ` L${pts[pts.length-1].x},${PAD.top + CHART_H}`
    + ` L${pts[0].x},${PAD.top + CHART_H} Z`;

  // Y 軸刻度（0、25、50、75、100）
  const yTicks = [0, 25, 50, 75, 100];
  const gridLines = yTicks.map(v => {
    const y = scoreToY(v);
    return `
      <line class="chart-gridline" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>
      <text class="chart-axis-label" x="${PAD.left - 5}" y="${y + 3}" text-anchor="end">${v}</text>
    `;
  }).join("");

  // X 軸刻度（每4點一個標籤，用 displayHour 顯示）
  const xLabels = pts
    .filter((_, i) => i % 4 === 0)
    .map(p => {
      const label = String(p.displayHour).padStart(2, "0");
      return `<text class="chart-axis-label" x="${p.x}" y="${H - 6}" text-anchor="middle">${label}時</text>`;
    }).join("");

  // 資料點圓點（用 data-index 傳 index，避免 NaN）
  const dots = pts.map((p) => `
    <circle class="chart-score-dot"
      cx="${p.x}" cy="${p.y}" r="4"
      data-index="${p.index}"
      data-display-hour="${p.displayHour}"
      data-score="${p.score.toFixed(1)}"
      data-tide="${(p.tide_score ?? "--")}"
      data-wind="${(p.wind_score ?? "--")}"
    />
  `).join("");

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="${svgNS}" role="img" aria-label="24小時垂釣指數折線圖">
  <defs>
    <linearGradient id="scoreAreaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FF6B35" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#FF6B35" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <!-- 格線 -->
  ${gridLines}

  <!-- X 軸基線 -->
  <line class="chart-gridline" style="stroke-opacity:0.2"
    x1="${PAD.left}" y1="${PAD.top + CHART_H}"
    x2="${W - PAD.right}" y2="${PAD.top + CHART_H}"/>

  <!-- 面積填充 -->
  <path class="chart-score-area" d="${areaPath}"/>

  <!-- 折線 -->
  <path class="chart-score-line" d="${linePath}"/>

  <!-- 資料點 -->
  ${dots}

  <!-- X 軸標籤 -->
  ${xLabels}
</svg>`;

  wrapEl.innerHTML = svg;

  // ---- Tooltip 互動 ----
  wrapEl.querySelectorAll(".chart-score-dot").forEach(dot => {
    dot.addEventListener("mouseenter", e => {
      const displayHour = String(dot.dataset.displayHour).padStart(2, "0");
      const score = parseFloat(dot.dataset.score);
      tooltip.innerHTML = `
        <div>${displayHour}:00</div>
        <div class="chart-tooltip__score">${score.toFixed(1)} 分</div>
      `;
      tooltip.classList.add("is-visible");
    });
    dot.addEventListener("mousemove", e => {
      tooltip.style.left = e.clientX + "px";
      tooltip.style.top  = e.clientY + "px";
    });
    dot.addEventListener("mouseleave", () => {
      tooltip.classList.remove("is-visible");
    });
  });
}
