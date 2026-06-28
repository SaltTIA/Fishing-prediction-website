"""
工作流 B：每 3 小時即時天氣與綜合指數計算腳本
==================================================
1. 從天文台 fnd API 抓取 9 天預報（含風向文字）
2. 從天文台 rhrread API 抓取即時天氣（含降雨）
3. 讀取工作流A產出的 base_tide_<spot_id>.json，取今日潮汐分
4. 融合：final_score = tide_score*0.6 + wind_score*0.4，有雨 -10
5. 輸出 docs/data/tide_score_<spot_id>.json（前端直接讀取）

工作流A輸出的 base_tide_*.json 結構：
{
  "days": {
    "2026-07-01": {
      "hourly_heights": [{"hour": 1, "height_m": 1.23}, ...],
      "amplitude_m": 1.5,
      "tide_range_score": 66.7,
      "lunar_date": "初六"
    }
  }
}
"""

import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

from spots_config import FISHING_SPOTS_CONFIG

HKO_WEATHER_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php"
OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"
RETRY_COUNT = 3
RETRY_DELAY = 5


# ================================================================
# 工具函式
# ================================================================

def fetch_with_retry(url, params, timeout=20):
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"  [嘗試 {attempt}/{RETRY_COUNT}] 請求失敗: {e}")
            if attempt < RETRY_COUNT:
                time.sleep(RETRY_DELAY)
    raise RuntimeError(f"超過重試次數，放棄: {url} {params}")


# 中文方位詞 → 角度（0=北, 90=東, 180=南, 270=西）
DIRECTION_MAP = {
    "北":   0,   "東北": 45,  "東":   90,  "東南": 135,
    "南":  180,  "西南": 225, "西":   270, "西北": 315,
    "北北東": 22, "東北東": 67, "東東南": 112, "東南東": 112,
    "南南東": 157, "南南西": 202, "西南西": 247,
    "西西北": 292, "北北西": 337,
}

def parse_wind_direction(text):
    """從「東北風3至4級」這類文字解析風向角度。找不到回傳 None。"""
    for kw, angle in sorted(DIRECTION_MAP.items(), key=lambda x: -len(x[0])):
        if kw in text:
            return angle
    return None

def parse_wind_speed_kmh(text):
    """解析「3至4級」→ 估算 km/h（蒲福風級近似轉換）。"""
    beaufort_to_kmh = {1:3, 2:9, 3:19, 4:28, 5:38, 6:50, 7:61, 8:74, 9:88, 10:102}
    match = re.search(r'(\d+)至(\d+)級', text)
    if match:
        avg_bf = (int(match.group(1)) + int(match.group(2))) / 2
        return beaufort_to_kmh.get(round(avg_bf), 30)
    match2 = re.search(r'(\d+)級', text)
    if match2:
        return beaufort_to_kmh.get(int(match2.group(1)), 20)
    return 20


def fetch_forecast():
    """抓取 9 天預報，提取今天和明天的風向文字。"""
    raw = fetch_with_retry(HKO_WEATHER_URL, {"dataType": "fnd", "lang": "tc"})
    forecasts = raw.get("weatherForecast", [])
    result = []
    for f in forecasts[:2]:
        wind_text = f.get("forecastWind", "")
        result.append({
            "date":           f.get("forecastDate", ""),
            "wind_text":      wind_text,
            "wind_direction": parse_wind_direction(wind_text),
            "wind_speed_kmh": parse_wind_speed_kmh(wind_text),
            "weather_desc":   f.get("forecastWeather", ""),
        })
    return result


def fetch_current_weather():
    """抓取即時天氣，主要用於判斷是否有降雨。"""
    raw = fetch_with_retry(HKO_WEATHER_URL, {"dataType": "rhrread", "lang": "tc"})
    rainfall_list = raw.get("rainfall", {}).get("data", [])
    has_rain = any(
        float(r.get("max", 0) or 0) > 0
        for r in rainfall_list
        if r.get("max") not in (None, "", "N/A")
    )
    return {
        "has_rain":       has_rain,
        "update_time":    raw.get("updateTime", ""),
        "humidity":       raw.get("humidity", {}).get("data", [{}])[0].get("value"),
        "rainfall_count": sum(
            1 for r in rainfall_list
            if float(r.get("max", 0) or 0) > 0
        ),
    }


# ================================================================
# 評分函式
# ================================================================

def calculate_wind_terrain_score(wind_direction, spot_facing, wind_speed_kmh=20):
    if wind_direction is None:
        return 50.0
    diff = abs(wind_direction - spot_facing) % 360
    if diff > 180:
        diff = 360 - diff
    base = 60 - (diff / 180) * 20
    wind_penalty = max(0, (wind_speed_kmh - 60) / 10) * 5
    score = base - wind_penalty
    return round(max(0.0, min(100.0, score)), 1)


def build_24h_score_series(tide_today, wind_score, has_rain):
    """
    建立 24 小時的逐小時綜合垂釣指數。
    tide_today 是今日每小時潮高列表 [{"hour": 1, "height_m": 1.23}, ...]
    """
    series = []
    day_heights = [x["height_m"] for x in tide_today]
    day_min, day_max = min(day_heights), max(day_heights)
    amp = day_max - day_min

    for h_data in tide_today:
        hour     = h_data["hour"]
        height_m = h_data["height_m"]

        if amp > 0:
            tide_score = ((height_m - day_min) / amp) * 100
        else:
            tide_score = 50.0

        combined = tide_score * 0.6 + wind_score * 0.4
        if has_rain:
            combined -= 10
        final = round(max(0.0, min(100.0, combined)), 1)

        series.append({
            "hour":        hour,
            "height_m":    round(height_m, 3),
            "tide_score":  round(tide_score, 1),
            "wind_score":  wind_score,
            "final_score": final,
        })

    return series


# ================================================================
# 主流程
# ================================================================

def process_spot(spot_id, cfg, forecast, current_weather):
    hkt = timezone(timedelta(hours=8))
    today_str = datetime.now(hkt).strftime("%Y-%m-%d")

    # 讀取工作流A的潮汐背景資料
    # 工作流A輸出結構：{"days": {"2026-07-01": {"hourly_heights": [...], "tide_range_score": ..., ...}}}
    base_path = OUTPUT_DIR / f"base_tide_{spot_id}.json"
    tide_today = []
    tide_score_fallback = 50.0

    if base_path.exists():
        with open(base_path, encoding="utf-8") as f:
            base_data = json.load(f)

        days = base_data.get("days", {})
        today_data = days.get(today_str, {})

        # 取今日逐小時潮高（工作流A的key是 hourly_heights，不是 daily_heights）
        tide_today = today_data.get("hourly_heights", [])

        # fallback 潮汐分：優先用今日的 tide_range_score，否則用 50
        tide_score_fallback = today_data.get("tide_range_score", 50.0) or 50.0

        if not tide_today:
            print(f"[{spot_id}] base_tide 存在但今日({today_str})無潮高資料，使用 fallback")
    else:
        print(f"[{spot_id}] 找不到 {base_path}，使用 fallback 潮汐分")

    # 風向分
    wind_direction = None
    wind_speed_kmh = 20
    wind_text = ""
    if forecast:
        wind_direction = forecast[0]["wind_direction"]
        wind_speed_kmh = forecast[0]["wind_speed_kmh"]
        wind_text      = forecast[0]["wind_text"]
    wind_score = calculate_wind_terrain_score(
        wind_direction, cfg["facing_direction"], wind_speed_kmh
    )

    has_rain = current_weather.get("has_rain", False)

    # 逐小時系列
    if tide_today:
        hourly_scores = build_24h_score_series(tide_today, wind_score, has_rain)
        overall_score = round(
            sum(h["final_score"] for h in hourly_scores) / len(hourly_scores), 1
        )
    else:
        combined = tide_score_fallback * 0.6 + wind_score * 0.4
        if has_rain:
            combined -= 10
        overall_score = round(max(0.0, min(100.0, combined)), 1)
        hourly_scores = []

    return {
        "spot_id":        spot_id,
        "spot_name":      cfg["name"],
        "station_id":     cfg["station_id"],
        "station_note":   cfg.get("station_note", ""),
        "target_fish":    cfg["target_fish"],
        "status":         "ok",
        "overall_score":  overall_score,
        "hourly_scores":  hourly_scores,
        "wind_score":     wind_score,
        "tide_score_today": tide_score_fallback,
        "has_rain":       has_rain,
        "wind_direction": wind_direction,
        "wind_text":      wind_text,
        "data_source_note": (
            "風向來自天文台9天預報文字解析（逐日，非逐小時實測值），"
            "準確度有限。潮汐來自工作流A(HHOT)。"
        ),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "date": today_str,
    }


def main():
    from spots_config import validate_config
    validate_config()

    print(f"輸出目錄：{OUTPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("抓取 9 天天氣預報...")
    try:
        forecast = fetch_forecast()
        print(f"  今日風向文字：{forecast[0]['wind_text'] if forecast else '—'}")
    except Exception as e:
        print(f"  預報抓取失敗（使用空白）：{e}")
        forecast = []

    print("抓取即時天氣...")
    try:
        current_weather = fetch_current_weather()
        print(f"  降雨：{'有' if current_weather['has_rain'] else '無'}")
    except Exception as e:
        print(f"  即時天氣抓取失敗（使用空白）：{e}")
        current_weather = {"has_rain": False}

    errors = []
    for spot_id, cfg in FISHING_SPOTS_CONFIG.items():
        print(f"[{spot_id}] 計算綜合指數...")
        try:
            result   = process_spot(spot_id, cfg, forecast, current_weather)
            out_path = OUTPUT_DIR / f"tide_score_{spot_id}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print(f"[{spot_id}] overall_score={result['overall_score']}，已寫入 {out_path}")
        except Exception as e:
            print(f"[{spot_id}] 處理失敗：{e}")
            errors.append(spot_id)

    if errors:
        print(f"\n部分釣點失敗：{errors}")
        sys.exit(1)
    else:
        print(f"\n全部 {len(FISHING_SPOTS_CONFIG)} 個釣點處理完成。")


if __name__ == "__main__":
    main()
