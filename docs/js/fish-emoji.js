/**
 * 魚種 emoji 對應字典
 * 純前端展示用，跟 data/*.json 完全解耦。
 * 找不到精確對應時，根據 type 欄位關鍵字猜 fallback emoji。
 * 要新增魚種只需加一行，不影響其他模組。
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
