/**
 * summary.js — 今日垂釣總結卡
 * 職責：根據 tide_score_*.json 的資料，計算推薦評級、因素說明、釣法建議，
 *       並渲染到 #summary-card 容器。
 */

// ---- 評級定義 ----
const VERDICTS = [
  {
    min: 80,
    label: "非常適合",
    accent: "#6fcf97",           // 海藻綠光
    cssClass: "summary-card--great",
  },
  {
    min: 60,
    label: "適合",
    accent: "#FF6B35",           // 浮標橘
    cssClass: "summary-card--good",
  },
  {
    min: 40,
    label: "不太適合",
    accent: "#F4C95D",           // 防曬帽黃
    cssClass: "summary-card--fair",
  },
  {
    min: 0,
    label: "不應該去",
    accent: "#e0533d",           // 警告紅
    cssClass: "summary-card--no-go",
  },
];

function getVerdict(score) {
  return VERDICTS.find(v => score >= v.min) ?? VERDICTS[VERDICTS.length - 1];
}

// ---- 因素 Pills 說明 ----
function buildFactors(data) {
  const factors = [];

  // 1. 潮汐振幅
  const tideScore = data.tide_score_today ?? 50;
  if (tideScore >= 70) {
    factors.push({ icon: "🌊", text: `大潮（潮差評分 ${tideScore.toFixed(0)}）`, tone: "good" });
  } else if (tideScore >= 40) {
    factors.push({ icon: "🌊", text: `中等潮（潮差評分 ${tideScore.toFixed(0)}）`, tone: "ok" });
  } else {
    factors.push({ icon: "🌊", text: `小潮（潮差評分 ${tideScore.toFixed(0)}）`, tone: "bad" });
  }

  // 2. 風向
  const windScore = data.wind_score ?? 50;
  const windText  = data.wind_text ?? "";
  if (windScore >= 65) {
    factors.push({ icon: "🍃", text: `風向有利${windText ? "（" + windText + "）" : ""}`, tone: "good" });
  } else if (windScore >= 45) {
    factors.push({ icon: "🍃", text: `風向一般${windText ? "（" + windText + "）" : ""}`, tone: "ok" });
  } else {
    factors.push({ icon: "💨", text: `風向不利${windText ? "（" + windText + "）" : ""}`, tone: "bad" });
  }

  // 3. 天氣／降雨
  if (data.has_rain) {
    factors.push({ icon: "🌧", text: "現時有降雨", tone: "bad" });
  } else {
    factors.push({ icon: "☀️", text: "天氣無雨", tone: "good" });
  }

  return factors;
}

// ---- 釣法 + 裝備建議 ----
// 按釣點類型 (spot_id 前綴) 和潮汐狀況動態選擇

const SPOT_PROFILES = {
  // 港灣 / 維港
  tsim_sha_tsui: { type: "harbour",  chinese: "尖沙咀" },
  tolo_harbour:  { type: "harbour",  chinese: "吐露港" },
  // 離島
  cheung_chau:   { type: "island",   chinese: "長洲"   },
  // 河口
  ng_tung_river: { type: "river",    chinese: "梧桐河" },
  // 碼頭 / 防波堤
  tsuen_wan_pier:{ type: "pier",     chinese: "荃灣碼頭"},
  tuen_mun_pier: { type: "pier",     chinese: "屯門碼頭"},
};

const METHOD_DB = {
  harbour: {
    high_tide: {
      methods: "浮游釣法、落餌泳釣",
      rigs: "3號蝦形鉤 + 1B 浮波，打層底魚",
      bait: "海蝦、沙蟲、魚丁",
      tip: "高水位時魚群靠近岸邊，可貼牆釣",
    },
    low_tide: {
      methods: "底釣、拋竿沉底",
      rigs: "天秤通心鉛 10–30g + 圓形鉤",
      bait: "沙蟲、蟹肉、急凍蝦",
      tip: "低潮露出礁石邊緣，黃腳鱲活躍",
    },
    mid_tide: {
      methods: "浮游釣法、掃海",
      rigs: "2B 浮波 + 伊勢尼 5–6號",
      bait: "海蝦、水母粒",
      tip: "漲落潮之間魚口最頻繁",
    },
  },
  island: {
    high_tide: {
      methods: "磯釣、浮游釣法",
      rigs: "1.5–2B 遠投浮波，長子線",
      bait: "海蝦、米蝦、沙蟲",
      tip: "高潮靠近礁岩邊，石斑、金鼓活躍",
    },
    low_tide: {
      methods: "底釣、磯邊插竿",
      rigs: "三枝鉤底組 + 天秤鉛",
      bait: "沙蟲、蟹、章魚片",
      tip: "露出礁石可探石隙，黑毛、石斑",
    },
    mid_tide: {
      methods: "浮游釣法、假餌路亞",
      rigs: "VIB 或 Pencil 假餌 7–14g",
      bait: "假餌 / 海蝦並用",
      tip: "路亞搜尋範圍廣，效率最高",
    },
  },
  river: {
    high_tide: {
      methods: "泳釣、立式浮波",
      rigs: "細浮波 0.5B + 小鉤 6–8號",
      bait: "紅蟲、蚯蚓、海蝦",
      tip: "高潮海水頂入，海魚上溯，魚口急",
    },
    low_tide: {
      methods: "底釣、翻石",
      rigs: "小天秤底組，鉛 5–15g",
      bait: "紅蟲、蚯蚓",
      tip: "低潮水淺，輕裝慢釣，烏頭在底層",
    },
    mid_tide: {
      methods: "浮游釣法、泳釣",
      rigs: "1B 浮波 + 伊勢尼 7號",
      bait: "紅蟲、蚯蚓",
      tip: "漲潮期魚群沿河道移動，魚口最活",
    },
  },
  pier: {
    high_tide: {
      methods: "浮游釣法、落餌",
      rigs: "3B 浮波，釣棚 1.5–2 倍水深",
      bait: "海蝦、魚丁、沙蟲",
      tip: "從碼頭邊打遠，打底層大魚",
    },
    low_tide: {
      methods: "底釣、插竿等口",
      rigs: "圓形鉛 20–40g + 粗線底組",
      bait: "沙蟲、蟹肉、蜆",
      tip: "碼頭底部礁石暴露，石鯛、鱸魚",
    },
    mid_tide: {
      methods: "浮游釣法、搖鉛",
      rigs: "遠投浮波 2B + 長子線",
      bait: "海蝦、米蝦",
      tip: "潮流穩定，走線流暢，建議順流方向打",
    },
  },
};

function getTidePhase(data) {
  const scores = data.hourly_scores ?? [];
  if (!scores.length) return "mid_tide";
  const nowHour = new Date().getHours();
  const current = scores.find(h => h.hour === nowHour) ?? scores[Math.floor(scores.length / 2)];
  const height   = current.height_m ?? 1.2;

  // 用今日最高最低潮高估算
  const heights  = scores.map(h => h.height_m).filter(Boolean);
  if (!heights.length) return "mid_tide";
  const max = Math.max(...heights);
  const min = Math.min(...heights);
  const mid = (max + min) / 2;

  if (height > mid + (max - min) * 0.25) return "high_tide";
  if (height < mid - (max - min) * 0.25) return "low_tide";
  return "mid_tide";
}

function buildAdvice(spotId, data) {
  const profile  = SPOT_PROFILES[spotId] ?? { type: "pier" };
  const db       = METHOD_DB[profile.type] ?? METHOD_DB.pier;
  const phase    = getTidePhase(data);
  const advice   = db[phase] ?? db.mid_tide;
  return advice;
}

// ---- 渲染 ----
export function renderSummary(containerEl, spotId, data) {
  if (!containerEl) return;

  const score   = data.overall_score ?? 50;
  const verdict = getVerdict(score);
  const factors = buildFactors(data);
  const advice  = buildAdvice(spotId, data);

  const pillsHTML = factors.map(f => `
    <span class="factor-pill factor-pill--${f.tone}">
      <span class="factor-pill__icon" aria-hidden="true">${f.icon}</span>
      ${f.text}
    </span>
  `).join("");

  containerEl.innerHTML = `
    <div
      class="summary-card ${verdict.cssClass}"
      style="--summary-accent: ${verdict.accent}"
    >
      <div class="summary-card__top">
        <div class="summary-card__verdict">${verdict.label}</div>
        <div class="summary-card__pct-wrap">
          <div class="summary-card__pct">${Math.round(score)}%</div>
          <div class="summary-card__pct-label">推薦出釣</div>
        </div>
      </div>

      <div class="summary-card__factors" role="list" aria-label="影響因素">
        ${pillsHTML}
      </div>

      <div class="summary-card__divider"></div>

      <div class="summary-card__advice">
        <div class="advice-block">
          <div class="advice-block__label">推薦釣法</div>
          <div class="advice-block__content">${advice.methods}</div>
        </div>
        <div class="advice-block">
          <div class="advice-block__label">裝備配搭</div>
          <div class="advice-block__content">${advice.rigs}</div>
        </div>
        <div class="advice-block">
          <div class="advice-block__label">推薦餌料</div>
          <div class="advice-block__content">${advice.bait}</div>
        </div>
        <div class="advice-block">
          <div class="advice-block__label">今日貼士</div>
          <div class="advice-block__content">${advice.tip}</div>
        </div>
      </div>
    </div>
  `;
}

export function renderSummaryLoading(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = `<div class="summary-skeleton"></div>`;
}

export function clearSummary(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
}
