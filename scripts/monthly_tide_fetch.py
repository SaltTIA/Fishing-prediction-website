"""
工作流 A：每月更新 —— 基礎潮汐與月相背景分
================================================
觸發：每月 1 號凌晨 (見 .github/workflows/monthly_tide.yml)

做的事：
1. 對每個釣點，呼叫天文台「Hourly heights of astronomical tides (HHOT)」API，
   抓未來一個月、該釣點對應潮汐站的逐小時潮高預測。
2. 用潮高的「日振幅」(當天最高潮 - 最低潮) 來判斷大潮/小潮：
   - 振幅越大 = 大潮 (漲跌流速快，通常魚口較活躍，但也可能流太急不好操作)
   - 振幅越小 = 小潮 (水流溫和)
   這是一個簡化的經驗公式，不是嚴謹的海洋學模型，之後可依實際釣況調整權重。
3. 同時呼叫農曆轉換 API，標註每天的農曆日期（民間經驗常說初一/十五前後大潮）。
4. 輸出 docs/data/base_tide_<spot_id>.json，給工作流 B 讀取後做動態融合。

注意：
- 此腳本只依賴 Python 標準庫 + requests，避免安裝額外套件拖慢 CI。
- 任何單一釣點/單一 API 呼叫失敗都不會讓整個腳本中斷，
  而是記錄錯誤、該釣點輸出 "status": "error"，讓前端可以顯示「資料暫缺」
  而不是讓整個網站掛掉（serverless 系統沒有人即時盯著，容錯比效率重要）。
"""

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

# 讓腳本不論從哪個目錄執行都能找到 spots_config.py
sys.path.insert(0, str(Path(__file__).parent))
from spots_config import FISHING_SPOTS_CONFIG, validate_config

HKO_OPENDATA_URL = "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php"
HKO_LUNAR_URL = "https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php"

OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"
REQUEST_TIMEOUT = 15  # 秒。政府 API 偶爾會慢，給足夠時間但不要無限等
RETRY_COUNT = 3
RETRY_BACKOFF_SECONDS = 5


def fetch_with_retry(url: str, params: dict) -> dict:
    """
    呼叫 API，失敗時重試。政府 API 偶有暫時性錯誤（503/timeout），
    重試比直接放棄更穩，但重試 3 次後仍失敗就該放手，不要卡住整個 CI job。
    """
    last_error = None
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            # opendata.php 已知狀況（截至2026-06）：即使參數完全正確（包含天文台
            # 文件官方範例本身），這支 endpoint 仍可能回 200 但內容是純文字的
            # "Please include valid parameters..." 而不是 JSON，或直接回非200。
            # 這裡主動偵測這個訊息，提供比 JSONDecodeError 更明確的錯誤，
            # 讓你一看 log 就知道是「天文台那支API本身有問題」而不是程式碼打錯參數。
            if "Please include valid parameters" in resp.text:
                raise RuntimeError(
                    "天文台 opendata.php 回應「invalid parameters」，"
                    "即使參數格式正確（已知此 endpoint 曾發生過此狀況，"
                    "詳見 README「已知問題」章節）。"
                    f"請求網址: {resp.url}"
                )
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError, RuntimeError) as e:
            last_error = e
            print(f"  [重試 {attempt}/{RETRY_COUNT}] {url} 失敗: {e}")
            if attempt < RETRY_COUNT:
                time.sleep(RETRY_BACKOFF_SECONDS)
    raise RuntimeError(f"呼叫 {url} 重試 {RETRY_COUNT} 次後仍失敗: {last_error}")


def fetch_monthly_tide_heights(station_id: str, year: int, month: int) -> dict:
    """
    抓單一潮汐站、單一月份的逐小時潮高資料。
    HHOT 回傳格式： {"fields": [...], "data": [[...], [...], ...]}

    重要：天文台真實回應格式跟一般直覺不同，這裡記錄清楚避免之後又解析錯：
    - fields 範例: ['MM', 'DD', '01', '02', '03', ..., '24']
    - 沒有獨立的「年」欄位（因為查詢時已經用 year 參數指定了，回應不重複給）
    - 沒有獨立的「時」欄位，而是把 24 小時「橫向展開」成 24 個欄位，
      欄位名稱直接是小時數字字串 "01"~"24"（"24" 代表當天 24:00，
      即次日00:00的潮高，仍算在當天這一列）
    - data 裡「每一列代表一天」，不是「每一列代表一個小時」，
      要自己把這一列展開成24筆 (小時, 潮高) 資料。

    這是透過實際呼叫 GitHub Actions runner（不受我的沙盒網路白名單限制）
    觀察到的真實回應後修正的，比天文台文件本身的敘述更可靠。
    """
    params = {
        "dataType": "HHOT",
        "rformat": "json",
        "station": station_id,
        "year": year,
        "month": month,
    }
    raw = fetch_with_retry(HKO_OPENDATA_URL, params)

    if "fields" not in raw or "data" not in raw:
        raise ValueError(f"HHOT 回應格式異常，缺少 fields/data: {raw}")

    fields = [f.strip() for f in raw["fields"]]
    rows = raw["data"]

    def find_field_index(candidates):
        for i, f in enumerate(fields):
            if any(c.lower() in f.lower() for c in candidates):
                return i
        return None

    idx_month = find_field_index(["mm", "month", "月"])
    idx_day = find_field_index(["dd", "day", "日"])

    if None in (idx_month, idx_day):
        raise ValueError(f"無法從 fields 對應到月/日欄位，原始 fields={fields}")

    # 小時欄位：找出所有「純數字字串」的欄位（"01"~"24"），
    # 記住它們在 fields 裡的 index，對應到實際小時數 (1~24)。
    hour_field_indices = []  # [(field_index, hour_number), ...]
    for i, f in enumerate(fields):
        if f.isdigit():
            hour_field_indices.append((i, int(f)))

    if not hour_field_indices:
        raise ValueError(f"無法從 fields 找到任何小時欄位 (應為'01'~'24')，原始 fields={fields}")

    daily_heights = {}  # {"2026-07-01": [{"hour": 1, "height_m": ...}, ...]}
    for row_num, row in enumerate(rows, start=1):
        # 防呆：理論上每一列長度應該跟 fields 一致，但政府資料偶有不一致的情況
        # （例如某天資料還沒補齊），這裡跳過異常列並記錄警告，而不是讓整個
        # 月份的抓取因為一列資料而全部失敗。
        if len(row) < max(idx_month, idx_day) + 1 or any(
            field_idx >= len(row) for field_idx, _ in hour_field_indices
        ):
            print(f"  [警告] 第{row_num}列資料長度異常 (長度={len(row)}, 預期={len(fields)})，跳過: {row}")
            continue

        m, d = row[idx_month], row[idx_day]
        date_key = f"{year:04d}-{int(m):02d}-{int(d):02d}"

        hourly_list = []
        for field_idx, hour_num in hour_field_indices:
            raw_value = row[field_idx]
            # 部分小時可能是空字串或 "N/A"（例如資料還沒釋出），跳過不採計，
            # 不要讓單一小時缺失害整天的資料報廢。
            try:
                height = float(raw_value)
            except (ValueError, TypeError):
                continue
            # "24" 代表當天24:00，為了跟一般 0-23 時制一致，轉成 hour=0 並不直觀，
            # 這裡保留天文台原始的 1-24 標示，前端顯示時只要知道 24 = 當天最後一刻即可。
            hourly_list.append({"hour": hour_num, "height_m": height})

        if hourly_list:
            daily_heights[date_key] = hourly_list

    return daily_heights


def fetch_lunar_date(target_date: date) -> str | None:
    """
    抓單一日期的農曆日期字串（例如 "二月初十"）。
    這支 API 只支援查單一日期，沒有區間查詢，所以一個月要呼叫 ~30 次。
    為了不要讓 CI 跑太久、也避免可能的速率限制，呼叫之間加小延遲。
    任何單日失敗只回 None，不影響其他日期。
    """
    try:
        raw = fetch_with_retry(HKO_LUNAR_URL, {"date": target_date.isoformat()})
        return raw.get("LunarDate")
    except RuntimeError as e:
        print(f"  農曆查詢失敗 ({target_date}): {e}")
        return None


def calculate_tide_range_score(hourly_heights: list[dict]) -> dict:
    """
    核心經驗公式：用「當天潮高振幅」換算大小潮背景分 (0-100)。

    振幅 = 當天最高潮高 - 當天最低潮高 (單位: 米)
    香港潮差通常在 0.5m ~ 2.5m 之間波動，這裡用簡單線性映射：
    - 振幅 >= 2.0m -> 接近 100 分 (大潮，水流強)
    - 振幅 <= 0.5m -> 接近 0 分 (小潮，水流弱)
    中間線性內插。這只是初版公式，之後可以替換成更精確的模型，
    重點是先把「資料管道」打通，公式本身之後隨時能調。
    """
    if not hourly_heights:
        return {"amplitude_m": None, "tide_range_score": None}

    heights = [h["height_m"] for h in hourly_heights]
    amplitude = round(max(heights) - min(heights), 2)

    AMP_MIN, AMP_MAX = 0.5, 2.0
    clamped = max(AMP_MIN, min(AMP_MAX, amplitude))
    score = round((clamped - AMP_MIN) / (AMP_MAX - AMP_MIN) * 100, 1)

    return {"amplitude_m": amplitude, "tide_range_score": score}


def process_spot(spot_id: str, cfg: dict, year: int, month: int) -> dict:
    """處理單一釣點，回傳要寫入 base_tide_<spot_id>.json 的完整內容。"""
    station_id = cfg["station_id"]
    print(f"[{spot_id}] 抓取潮汐站 {station_id} 的 {year}-{month:02d} 資料...")

    try:
        daily_heights = fetch_monthly_tide_heights(station_id, year, month)
    except (RuntimeError, ValueError) as e:
        print(f"[{spot_id}] 潮汐資料抓取失敗: {e}")
        return {
            "spot_id": spot_id,
            "spot_name": cfg["name"],
            "station_id": station_id,
            "status": "error",
            "error_message": str(e),
            "generated_at": None,
            "days": {},
        }

    days_output = {}
    for date_key, hourly_list in sorted(daily_heights.items()):
        score_info = calculate_tide_range_score(hourly_list)
        y, m, d = (int(x) for x in date_key.split("-"))
        lunar = fetch_lunar_date(date(y, m, d))
        time.sleep(0.3)  # 對農曆 API 客氣一點，避免被當成濫用流量

        days_output[date_key] = {
            "hourly_heights": sorted(hourly_list, key=lambda x: x["hour"]),
            "amplitude_m": score_info["amplitude_m"],
            "tide_range_score": score_info["tide_range_score"],
            "lunar_date": lunar,
        }

    return {
        "spot_id": spot_id,
        "spot_name": cfg["name"],
        "station_id": station_id,
        "station_note": cfg.get("station_note", ""),
        "status": "ok",
        "generated_at": date.today().isoformat(),
        "year": year,
        "month": month,
        "days": days_output,
    }


def main():
    validate_config()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    today = date.today()
    # 抓「下個月」的資料：每月1號執行時，當月資料通常已經有了，
    # 提前準備下個月才能讓網站隨時有完整未來一個月可看。
    next_month_date = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    target_year, target_month = next_month_date.year, next_month_date.month

    overall_success = True
    for spot_id, cfg in FISHING_SPOTS_CONFIG.items():
        result = process_spot(spot_id, cfg, target_year, target_month)
        output_path = OUTPUT_DIR / f"base_tide_{spot_id}.json"
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[{spot_id}] 已寫入 {output_path}")
        if result["status"] != "ok":
            overall_success = False

    if not overall_success:
        # 用非 0 結束碼讓 GitHub Actions 標記這次執行為「失敗」，
        # 方便你在 GitHub 介面上一眼看到，而不需要每次都翻 log。
        # 注意：已成功的釣點資料仍然會被寫入/保留，不會因為某一個釣點失敗而全部清空。
        print("\n部分釣點處理失敗，請檢查上方錯誤訊息。")
        sys.exit(1)

    print("\n全部釣點處理完成。")


if __name__ == "__main__":
    main()
