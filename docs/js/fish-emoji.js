/**
 * 魚種 emoji 及圖片對應字典
 */

export const FISH_EMOJI = {
  "黑沙鱲": "🐟",
  "黃腳鱲": "🐠",
  "烏頭":   "🐟",
  "泥鯭":   "🐡",
  "牛屎鱲": "🐠",
  "細鱗":   "🐟",
  "鱸魚":   "🐊",
  "黑鱲":   "🐟",
};

// 魚種圖片（Wikimedia Commons 公共領域圖片）
export const FISH_IMAGES = {
  "黑沙鱲": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Acanthopagrus_schlegelii.jpg/320px-Acanthopagrus_schlegelii.jpg",
  "黃腳鱲": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Acanthopagrus_latus_by_OpenCage.jpg/320px-Acanthopagrus_latus_by_OpenCage.jpg",
  "烏頭":   "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Mugil_cephalus_2.jpg/320px-Mugil_cephalus_2.jpg",
  "泥鯭":   "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Siganus_fuscescens.jpg/320px-Siganus_fuscescens.jpg",
  "鱸魚":   "https://upload.wikimedia.org/wikipedia/commons/thumb/5/cinquant/Lateolabrax_japonicus.jpg/320px-Lateolabrax_japonicus.jpg",
  "黑鱲":   "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Acanthopagrus_schlegelii.jpg/320px-Acanthopagrus_schlegelii.jpg",
};

const TYPE_FALLBACK = [
  { keyword: "掠食", emoji: "🦈" },
  { keyword: "底棲", emoji: "🐟" },
  { keyword: "上層", emoji: "🐠" },
  { keyword: "中下層", emoji: "🐟" },
  { keyword: "全水層", emoji: "🐡" },
  { keyword: "岩礁", emoji: "🦞" },
];

export function getFishEmoji(name, type = "") {
  if (FISH_EMOJI[name]) return FISH_EMOJI[name];
  const match = TYPE_FALLBACK.find(t => type.includes(t.keyword));
  return match ? match.emoji : "🐟";
}

export function getFishImage(name) {
  return FISH_IMAGES[name] ?? null;
}
