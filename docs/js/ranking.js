/**
 * ranking.js — 所有釣點一覽排名
 * 職責：並行載入所有釣點資料，按 overall_score 排名，渲染排名看板。
 */

const DATA_BASE_PATH = "./data";

// 與 app.js SPOTS 同步
const SPOTS = {
  tolo_harbour:  { name: "吐露港",   emoji: "⚓" },
  tsim_sha_tsui: { name: "尖沙咀",   emoji: "🌆" },
  cheung_chau:   { name: "長洲",     emoji: "🏝" },
  ng_tung_river: { name: "梧桐河",   emoji: "🌿" },
  tsuen_wan_pier:{ name: "荃灣碼頭", emoji: "🚢" },
  tuen_mun_pier: { name: "屯門碼頭", emoji: "⛵" },
};

const VERDICTS = [
  { min: 80, label: "非常適合", cssClass: "rank-badge--great" },
  { min: 60, label: "適合",     cssClass: "rank-badge--good"  },
  { min: 40, label: "不太適合", cssClass: "rank-badge--fair"  },
  { min:  0, label: "不應該去", cssClass: "rank-badge--nogo"  },
];

function getVerdict(score) {
  return VERDICTS.find(v => score >= v.min) ?? VERDICTS[VERDICTS.length - 1];
}

// 載入單一釣點（失敗回傳 null）
async function fetchSpot(spotId) {
  try {
    const resp = await fetch(`${DATA_BASE_PATH}/tide_score_${spotId}.json`, { cache: "no-cache" });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { spotId, ...data };
  } catch {
    return null;
  }
}

// 計算今日最佳時段（連續 ≥ 3h，分數 ≥ 65）
function getBestWindow(hourlyScores) {
  if (!hourlyScores?.length) return null;
  const sorted = [...hourlyScores].sort((a, b) => a.hour - b.hour);
  let best = null;
  let run = [];

  for (const h of sorted) {
    if ((h.final_score ?? 0) >= 65) {
      run.push(h);
    } else {
      if (run.length >= 3) best = run;
      run = [];
    }
  }
  if (run.length >= 3 && (!best || run.length > best.length)) best = run;

  if (!best) {
    // fallback：取最高單小時
    const peak = sorted.reduce((a, b) =>
      (b.final_score ?? 0) > (a.final_score ?? 0) ? b : a, sorted[0]);
    return `${peak.hour}:00（單小時最高）`;
  }
  return `${best[0].hour}:00–${best[best.length - 1].hour + 1}:00`;
}

// ---- 渲染骨架 loading ----
export function renderRankingLoading(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = `
    <div class="ranking-skeleton">
      ${[...Array(6)].map(() => `<div class="ranking-skeleton__row"></div>`).join("")}
    </div>
  `;
}

// ---- 主渲染 ----
export async function renderRanking(containerEl, onSpotClick) {
  if (!containerEl) return;
  renderRankingLoading(containerEl);

  // 並行載入所有釣點
  const results = await Promise.all(
    Object.keys(SPOTS).map(id => fetchSpot(id))
  );

  // 過濾失敗、排序
  const ranked = results
    .filter(Boolean)
    .sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));

  if (!ranked.length) {
    containerEl.innerHTML = `
      <div class="ranking-empty">
        <span class="ranking-empty__icon">🎣</span>
        暫無釣點資料
      </div>`;
    return;
  }

  const rows = ranked.map((d, i) => {
    const cfg     = SPOTS[d.spotId] ?? { name: d.spot_name ?? d.spotId, emoji: "📍" };
    const score   = d.overall_score ?? 0;
    const verdict = getVerdict(score);
    const best    = getBestWindow(d.hourly_scores);
    const rank    = i + 1;

    // 排名樣式
    const rankClass = rank === 1 ? "ranking-row__rank--gold"
                    : rank === 2 ? "ranking-row__rank--silver"
                    : rank === 3 ? "ranking-row__rank--bronze"
                    : "";

    // 分數條
    const barPct = Math.round(Math.max(0, Math.min(100, score)));

    return `
      <div class="ranking-row" data-spot-id="${d.spotId}" role="button" tabindex="0"
           aria-label="選擇 ${cfg.name}，垂釣指數 ${barPct}">
        <div class="ranking-row__rank ${rankClass}">${rank}</div>
        <div class="ranking-row__emoji">${cfg.emoji}</div>
        <div class="ranking-row__info">
          <div class="ranking-row__name">${cfg.name}</div>
          ${best ? `<div class="ranking-row__window">⏱ 最佳時段 ${best}</div>` : ""}
        </div>
        <div class="ranking-row__right">
          <div class="ranking-row__score-wrap">
            <div class="ranking-row__bar-track">
              <div class="ranking-row__bar-fill" style="width:${barPct}%"></div>
            </div>
            <div class="ranking-row__score">${barPct}</div>
          </div>
          <span class="rank-badge ${verdict.cssClass}">${verdict.label}</span>
        </div>
      </div>
    `;
  }).join("");

  containerEl.innerHTML = `<div class="ranking-list">${rows}</div>`;

  // 點擊跳轉
  containerEl.querySelectorAll(".ranking-row").forEach(el => {
    const handler = () => {
      const spotId = el.dataset.spotId;
      if (spotId && typeof onSpotClick === "function") onSpotClick(spotId);
    };
    el.addEventListener("click", handler);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") handler(); });
  });
}
