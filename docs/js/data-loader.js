/**
 * 資料載入模組
 * 負責 fetch data/tide_score_<spot_id>.json（工作流B的最終輸出）。
 * 這份JSON已包含 target_fish、hourly_scores 等前端需要的一切。
 *
 * 路徑說明：GitHub Pages 部署後結構為：
 *   /docs/index.html           ← 頁面（Pages 根目錄）
 *   /docs/data/tide_score_xxx.json  ← 資料
 * 兩者同在 docs/ 下，直接用 ./data/ 相對路徑存取。
 */

const DATA_BASE_PATH = "./data";

/**
 * 載入單一釣點資料。Promise 永遠 resolve（不 reject），
 * 失敗時回傳帶有 status:"fetch_error" 的物件，讓 UI 統一處理錯誤。
 */
export async function loadSpotData(spotId) {
  const url = `${DATA_BASE_PATH}/tide_score_${spotId}.json`;
  try {
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) {
      return {
        status: "fetch_error",
        error_message: `無法讀取資料 (HTTP ${resp.status})，可能工作流尚未執行。`,
      };
    }
    return await resp.json();
  } catch (err) {
    return {
      status: "fetch_error",
      error_message: `網路請求失敗：${err.message}`,
    };
  }
}
