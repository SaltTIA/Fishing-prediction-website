/**
 * chart.js — 24小時垂釣指數折線圖（純 SVG）
 * 新增：最佳出釣時段高亮（連續 ≥3 小時，分數 ≥65 分）
 */

const W = 600;
const H = 180;
const PAD = { top: 20, right: 28, bottom: 32, left: 36 };

const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top  - PAD.bottom;

const GOOD_THRESHOLD = 65;
const GOOD_MIN_RUN   = 3;

function scoreToY(score) {
  return PAD.top + CHART_H - (Math.max(0, Math.min(100, score)) / 100) * CHART_H;
}

function hourToX(i, total) {
  if (total <= 1) return PAD.left + CHART_W / 2;
  return PAD.left + (i / (total - 1)) * CHART_W;
}

function resolveDisplayHour(h, index) {
  const raw = h.hour;
  if (raw == null || isNaN(Number(raw))) return index % 24;
  const n = Number(raw);
  if (n >= 1 && n <= 24) return n - 1;
  if (n >= 0 && n <= 23) return n;
  return index % 24;
}

/**
 * 找出所有「連續 ≥ GOOD_MIN_RUN 小時，分數 ≥ GOOD_THRESHOLD」的區段
 */
function findBestRuns(pts) {
  const runs = [];
  let runStart = null;
  for (let i = 0; i < pts.length; i++) {
    const good = pts[i].score >= GOOD_THRESHOLD;
    if (good && runStart === null) runStart = i;
    if (!good && runStart !== null) {
      if (i - runStart >= GOOD_MIN_RUN) runs.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = null;
    }
  }
  if (runStart !== null && pts.length - runStart >= GOOD_MIN_RUN) {
    runs.push({ startIdx: runStart, endIdx: pts.length - 1 });
  }
  return runs;
}

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
    displayHour: resolveDisplayHour(h, i),
    wind_score: h.wind_score,
    tide_score: h.tide_score,
    index: i,
  }));

  // ---- 最佳時段高亮 ----
  const bestRuns = findBestRuns(pts);
  const highlightRects = bestRuns.map(({ startIdx, endIdx }) => {
    const x1 = pts[startIdx].x;
    const x2 = pts[endIdx].x;
    const labelHour = String(pts[startIdx].displayHour).padStart(2, "0");
    const endHour   = String(pts[endIdx].displayHour).padStart(2, "0");
    // 每個區段只在最左邊顯示一個標籤，避免重疊
    const labelX = Math.min(x1 + (x2 - x1) / 2, W - PAD.right - 20);
    return `
      <rect class="chart-best-zone"
        x="${x1}" y="${PAD.top}"
        width="${Math.max(x2 - x1, 4)}" height="${CHART_H}"
        rx="4"/>
      <text class="chart-best-label"
        x="${labelX}" y="${PAD.top - 5}"
        text-anchor="middle">★ ${labelHour}–${endHour}時</text>
    `;
  }).join("");

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = linePath
    + ` L${pts[pts.length-1].x},${PAD.top + CHART_H}`
    + ` L${pts[0].x},${PAD.top + CHART_H} Z`;

  const yTicks = [0, 25, 50, 75, 100];
  const gridLines = yTicks.map(v => {
    const y = scoreToY(v);
    return `
      <line class="chart-gridline" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>
      <text class="chart-axis-label" x="${PAD.left - 5}" y="${y + 3}" text-anchor="end">${v}</text>
    `;
  }).join("");

  // 65 分虛線（佳分界）
  const thresholdY = scoreToY(GOOD_THRESHOLD);
  const thresholdLine = `
    <line class="chart-threshold-line"
      x1="${PAD.left}" y1="${thresholdY}"
      x2="${W - PAD.right}" y2="${thresholdY}"/>
    <text class="chart-threshold-label"
      x="${W - PAD.right + 3}" y="${thresholdY + 3}"
      text-anchor="start">佳</text>
  `;

  const xLabels = pts
    .filter((_, i) => i % 4 === 0)
    .map(p => {
      const label = String(p.displayHour).padStart(2, "0");
      return `<text class="chart-axis-label" x="${p.x}" y="${H - 6}" text-anchor="middle">${label}時</text>`;
    }).join("");

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
<svg viewBox="0 0 ${W} ${H}" xmlns="${svgNS}" role="img" aria-label="24小時垂釣指數折線圖，綠色區域為最佳出釣時段">
  <defs>
    <linearGradient id="scoreAreaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FF6B35" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#FF6B35" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <!-- 最佳時段高亮（在格線之前繪製，讓格線覆蓋在上方保持可讀性） -->
  ${highlightRects}

  <!-- 格線 -->
  ${gridLines}

  <!-- 65 分佳線 -->
  ${thresholdLine}

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
      const isGood = score >= GOOD_THRESHOLD;
      tooltip.innerHTML = `
        <div>${displayHour}:00${isGood ? " ★" : ""}</div>
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
