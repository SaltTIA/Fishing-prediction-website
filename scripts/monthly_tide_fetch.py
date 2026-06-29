"""
工作流 A：每月更新 —— 基礎潮汐與月相背景分
================================================
觸發：每月 1 號凌晨 (見 .github/workflows/monthly_tide.yml)

做的事：
1. 對每個釣點，呼叫天文台「Hourly heights of astronomical tides (HHOT)」API，
   抓「當月」和「下個月」兩個月的逐小時潮高預測。
2. 用潮高的「日振幅」(當天最高潮 - 最低潮) 來判斷大潮/小潮。
3. 同時呼叫農曆轉換 API，標註每天的農曆日期。
4. 輸出 docs/data/base_tide_<spot_id>.json，給工作流 B 讀取後做動態融合。

為何同時抓當月和下個月：
  工作流 A 不一定只在月初執行（手動觸發可以在任何時候）。
  如果只抓「下個月」，本月剩餘日子就沒有潮汐資料，
  工作流 B 讀不到今天的資料就只能走 fallback，顯示「暫無每小時資料」。
  同時抓兩個月可確保任何時間執行工作流 A 後，工作流 B 都能找到今天的資料。
"""

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from spots_config import FISHING_SPOTS_CONFIG, validate_config

HKO_OPENDATA_URL = "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php"
HKO_LUNAR_URL = "https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php"

OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"
REQUEST_TIMEOUT = 15
RETRY_COUNT = 3
RETRY_BACKOFF_SECONDS = 5


def fetch_with_retry(url: str, params: dict) -> dict:
    last_error = None
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if "Please include valid parameters" in resp.text:
                raise RuntimeError(
                    f"天文台 opendata.php 回應「invalid parameters」。請求網址: {resp.url}"
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
    回傳 {"2026-06-29": [{"hour": 1, "height_m": ...}, ...], ...}
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

    hour_field_indices = []
    for i, f in enumerate(fields):
        if f.isdigit():
            hour_field_indices.append((i, int(f)))

    if not hour_field_indices:
        raise ValueError(f"無法從 fields 找到任何小時欄位，原始 fields={fields}")

    daily_heights = {}
    for row_num, row in enumerate(rows, start=1):
        if len(row) < max(idx_month, idx_day) + 1 or any(
            field_idx >= len(row) for field_idx, _ in hour_field_indices
        ):
            print(f"  [警告] 第{row_num}列資料長度異常，跳過: {row}")
            continue

        m, d = row[idx_month], row[idx_day]
        date_key = f"{year:04d}-{int(m):02d}-{int(d):02d}"

        hourly_list = []
        for field_idx, hour_num in hour_field_indices:
            try:
                height = float(row[field_idx])
            except (ValueError, TypeError):
                continue
            hourly_list.append({"hour": hour_num, "height_m": height})

        if hourly_list:
            daily_heights[date_key] = hourly_list

    return daily_heights


def fetch_lunar_date(target_date: date) -> str | None:
    try:
        raw = fetch_with_retry(HKO_LUNAR_URL, {"date": target_date.isoformat()})
        return raw.get("LunarDate")
    except RuntimeError as e:
        print(f"  農曆查詢失敗 ({target_date}): {e}")
        return None


def calculate_tide_range_score(hourly_heights: list[dict]) -> dict:
    if not hourly_heights:
        return {"amplitude_m": None, "tide_range_score": None}

    heights = [h["height_m"] for h in hourly_heights]
    amplitude = round(max(heights) - min(heights), 2)

    AMP_MIN, AMP_MAX = 0.5, 2.0
    clamped = max(AMP_MIN, min(AMP_MAX, amplitude))
    score = round((clamped - AMP_MIN) / (AMP_MAX - AMP_MIN) * 100, 1)

    return {"amplitude_m": amplitude, "tide_range_score": score}


def process_spot(spot_id: str, cfg: dict, year_months: list[tuple]) -> dict:
    """
    處理單一釣點，同時抓多個月份的資料，合併後寫入同一個 JSON。
    year_months: [(2026, 6), (2026, 7)] 這樣的列表
    """
    station_id = cfg["station_id"]
    print(f"[{spot_id}] 抓取潮汐站 {station_id}，目標月份: {year_months}")

    all_daily_heights = {}
    fetch_error = None

    for year, month in year_months:
        print(f"  [{spot_id}] 抓取 {year}-{month:02d}...")
        try:
            monthly = fetch_monthly_tide_heights(station_id, year, month)
            all_daily_heights.update(monthly)
            print(f"  [{spot_id}] {year}-{month:02d} 取得 {len(monthly)} 天資料")
        except (RuntimeError, ValueError) as e:
            print(f"  [{spot_id}] {year}-{month:02d} 抓取失敗: {e}")
            fetch_error = e

    if not all_daily_heights:
        return {
            "spot_id": spot_id,
            "spot_name": cfg["name"],
            "station_id": station_id,
            "status": "error",
            "error_message": str(fetch_error),
            "generated_at": None,
            "days": {},
        }

    days_output = {}
    for date_key, hourly_list in sorted(all_daily_heights.items()):
        score_info = calculate_tide_range_score(hourly_list)
        y, m, d = (int(x) for x in date_key.split("-"))
        lunar = fetch_lunar_date(date(y, m, d))
        time.sleep(0.3)

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
        "months": [f"{y}-{m:02d}" for y, m in year_months],
        "days": days_output,
    }


def main():
    validate_config()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    today = date.today()

    # 同時抓「當月」和「下個月」：
    #   - 當月：確保今天和本月剩餘日子有資料（手動觸發在月中也能正常顯示）
    #   - 下個月：讓網站在月底也有完整的未來一個月可看
    this_month = (today.year, today.month)
    next_month_date = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    next_month = (next_month_date.year, next_month_date.month)
    year_months = [this_month, next_month]

    print(f"輸出目錄：{OUTPUT_DIR}")
    print(f"抓取月份：{[f'{y}-{m:02d}' for y, m in year_months]}")

    overall_success = True
    for spot_id, cfg in FISHING_SPOTS_CONFIG.items():
        result = process_spot(spot_id, cfg, year_months)
        output_path = OUTPUT_DIR / f"base_tide_{spot_id}.json"
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[{spot_id}] 已寫入 {output_path}，共 {len(result.get('days', {}))} 天")
        if result["status"] != "ok":
            overall_success = False

    if not overall_success:
        print("\n部分釣點處理失敗，請檢查上方錯誤訊息。")
        sys.exit(1)

    print(f"\n全部 {len(FISHING_SPOTS_CONFIG)} 個釣點處理完成。")


if __name__ == "__main__":
    main()
