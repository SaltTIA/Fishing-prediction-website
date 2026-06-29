/**
 * ranking.js — 所有釣點一覽排名
 * 職責：並行載入所有釣點資料，按 overall_score 排名，渲染排名看板。
 * 直接複用 data-loader.js 的 loadSpotData，保持單一資料來源。
 */

import { loadSpotData } from "./data-loader.js";

// 與 app.js SPOTS 完全同步
const SPOTS = {
  tolo_harbour:   { name: "吐露港",   emoji: "⚓" },
  tsim_sha_tsui:  { name: "尖沙咀",   emoji: "🌆" },
  cheung_chau:    { name: "長洲",     emoji: "🏝" },
  ng_tung_river:  { name: "梧桐河",   emoji: "🌿" },
  tsuen_wan_pier: { name: "荃灣碼頭", emoji: "🚢" },
  tuen_mun_pier:  { name: "屯門碼頭", emoji: "⛵" },
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

// 計算今日最佳時段（連續 ≥ 3h，分數 ≥ 65）
function getBestWindow(hourlyScores) {
  if (!hourlyScores || !hourlyScores.length) return null;
  const sorted = hourlyScores.slice().sort((a, b) => a.hour - b.hour);
  let best = null;
  let run = [];

  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    if ((h.final_score || 0) >= 65) {
      run.push(h);
    } else {
      if (run.length >= 3 && (!best || run.length > best.length)) best = run.slice();
      run = [];
    }
  }
  if (run.length >= 3 && (!best || run.length > best.length)) best = run.slice();

  if (!best) {
    // fallback：取最高單小時
    const peak = sorted.reduce(function(a, b) {
      return (b.final_score || 0) > (a.final_score || 0) ? b : a;
    }, sorted[0]);
    return peak.hour + ":00（單小時最高）";
  }
  return best[0].hour + ":00–" + (best[best.length - 1].hour + 1) + ":00";
}

// ---- 渲染骨架 loading ----
export function renderRankingLoading(containerEl) {
  if (!containerEl) return;
  var skeletonRows = "";
  for (var i = 0; i < 6; i++) {
    skeletonRows += '<div class="ranking-skeleton__row"></div>';
  }
  containerEl.innerHTML = '<div class="ranking-skeleton">' + skeletonRows + "</div>";
}

// ---- 主渲染 ----
export async function renderRanking(containerEl, onSpotClick) {
  if (!containerEl) return;
  renderRankingLoading(containerEl);

  // 並行載入所有釣點，複用已驗證的 loadSpotData
  const spotIds = Object.keys(SPOTS);
  const results = await Promise.all(
    spotIds.map(function(id) {
      return loadSpotData(id).then(function(data) {
        if (!data || data.status === "fetch_error" || data.status === "error") return null;
        data._spotId = id;   // 附加前端 key（避免與 JSON 的 spot_id 混淆）
        return data;
      });
    })
  );

  // 過濾失敗項，按分數降序排列
  const ranked = results
    .filter(function(d) { return d !== null; })
    .sort(function(a, b) { return (b.overall_score || 0) - (a.overall_score || 0); });

  if (!ranked.length) {
    containerEl.innerHTML =
      '<div class="ranking-empty">' +
        '<span class="ranking-empty__icon">🎣</span>' +
        "暫無釣點資料" +
      "</div>";
    return;
  }

  var rowsHTML = ranked.map(function(d, i) {
    var spotId  = d._spotId;
    var cfg     = SPOTS[spotId] || { name: d.spot_name || spotId, emoji: "📍" };
    var score   = d.overall_score || 0;
    var verdict = getVerdict(score);
    var best    = getBestWindow(d.hourly_scores);
    var rank    = i + 1;
    var barPct  = Math.round(Math.max(0, Math.min(100, score)));

    var rankClass = rank === 1 ? "ranking-row__rank--gold"
                  : rank === 2 ? "ranking-row__rank--silver"
                  : rank === 3 ? "ranking-row__rank--bronze"
                  : "";

    var windowHTML = best
      ? '<div class="ranking-row__window">⏱ 最佳時段 ' + best + "</div>"
      : "";

    return (
      '<div class="ranking-row" data-spot-id="' + spotId + '" role="button" tabindex="0"' +
          ' aria-label="選擇 ' + cfg.name + '，垂釣指數 ' + barPct + '">' +
        '<div class="ranking-row__rank ' + rankClass + '">' + rank + "</div>" +
        '<div class="ranking-row__emoji">' + cfg.emoji + "</div>" +
        '<div class="ranking-row__info">' +
          '<div class="ranking-row__name">' + cfg.name + "</div>" +
          windowHTML +
        "</div>" +
        '<div class="ranking-row__right">' +
          '<div class="ranking-row__score-wrap">' +
            '<div class="ranking-row__bar-track">' +
              '<div class="ranking-row__bar-fill" style="width:' + barPct + '%"></div>' +
            "</div>" +
            '<div class="ranking-row__score">' + barPct + "</div>" +
          "</div>" +
          '<span class="rank-badge ' + verdict.cssClass + '">' + verdict.label + "</span>" +
        "</div>" +
      "</div>"
    );
  }).join("");

  containerEl.innerHTML = '<div class="ranking-list">' + rowsHTML + "</div>";

  // 點擊切換釣點
  var rows = containerEl.querySelectorAll(".ranking-row");
  rows.forEach(function(el) {
    function handler() {
      var spotId = el.getAttribute("data-spot-id");
      if (spotId && typeof onSpotClick === "function") onSpotClick(spotId);
    }
    el.addEventListener("click", handler);
    el.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") handler();
    });
  });
}
