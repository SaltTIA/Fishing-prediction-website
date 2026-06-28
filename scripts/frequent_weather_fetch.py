"""
工作流 B：每 3 小時更新 —— 即時天氣與風向地形匹配
================================================
觸發：每 3 小時一次 (見 .github/workflows/frequent_weather.yml)

做的事：
1. 抓「Current Weather Report (rhrread)」：取得即時降雨、氣壓走勢用的溫度/濕度等資料。
2. 抓「9-day Weather Forecast (fnd)」：取得逐日的風向/風速文字描述（如 "東北風 3 級"），
   並解析成角度數字，用於跟各釣點的 facing_direction 比對。
3. 讀取工作流 A 產出的 base_tide_<spot_id>.json 當背景分。
4. 用「風向 vs 地形朝向」算出避風/頂風加權，再跟潮汐背景分融合，
   輸出最終 tide_score_<spot_id>.json（前端直接讀這個檔案畫圖）。

重要說明（天文台 API 的實際限制，請知悉）：
------------------------------------------------
天文台公開 API 裡，沒有任何資料集提供「結構化、逐3小時更新的風速/風向數字」。
最接近的選項只有「9-day Weather Forecast」裡的 forecastWind 文字欄位
（例如 "East force 3 to 4" / "東風3至4級"），且這是「逐日」預報、不是逐3小時。

因此本腳本採取的折衷做法是：
  - 風向：解析 forecastWind 文字裡的方位詞（東/南/西/北及其組合）轉成角度。
  - 風速：解析文字中的「級」數字（蒲福風級 Beaufort scale），轉換成大略風速。
  - 更新頻率：雖然 workflow 每 3 小時跑一次，但風向資料本身是「當天預報」，
    同一天內每次抓到的可能是同一份預報（除非天文台更新了 forecastDesc）。
    這點之後可以考慮换成天文台「天氣現況報告」逐百字描述，或加裝氣象站 API。
這不是偷工減料，而是現有免費資料源的真實限制，誠實標註在輸出 JSON 的
"data_source_note" 欄位中，避免之後你或使用者誤以為這是逐3小時的真實風速。
"""

import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from spots_config import FISHING_SPOTS_CONFIG, validate_config

HKO_WEATHER_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php"
REQUEST_TIMEOUT = 15

DATA_DIR = Path(__file__).parent.parent / "data"

# 方位詞 -> 角度 (0=北, 90=東, 180=南, 270=西)，由細到粗排列方便比對
DIRECTION_MAP = [
    ("東北東", 67.5), ("東南東", 112.5), ("西南西", 247.5), ("西北西", 292.5),
    ("東北", 45), ("東南", 135), ("西南", 225), ("西北", 315),
    ("北", 0), ("東", 90), ("南", 180), ("西", 270),
]

# 蒲福風級 -> 大約風速 (km/h)，取級別中位數估算
BEAUFORT_KMH = {
    1: 3, 2: 8, 3: 15, 4: 25, 5: 35, 6: 45, 7: 56, 8: 68, 9: 81, 10: 95, 11: 110, 12: 120,
}


def fetch_json(params: dict) -> dict:
    resp = requests.get(HKO_WEATHER_URL, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def parse_wind_direction(wind_text: str) -> float | None:
    """
    從天文台中文風向描述（如 "東至東北風3至4級"）解析出角度。
    取文字裡第一個出現的方位詞；若完全沒有方位詞（例如「微風」、「風向不定」），回傳 None，
    呼叫端要能處理 None（代表當天無法做地形加權，背景分原樣輸出）。
    """
    if not wind_text:
        return None
    for direction_word, angle in DIRECTION_MAP:
        if direction_word in wind_text:
            return angle
    return None


def parse_wind_speed_kmh(wind_text: str) -> float | None:
    """
    解析「X至Y級」或「X級」抓最大級數，轉成大約 km/h。
    找不到數字就回 None。
    """
    if not wind_text:
        return None
    levels = [int(n) for n in re.findall(r"(\d+)\s*級", wind_text)]
    if not levels:
        return None
    max_level = max(levels)
    return BEAUFORT_KMH.get(max_level, BEAUFORT_KMH[12])


def angle_difference(a: float, b: float) -> float:
    """兩個方位角之間的最小夾角差 (0-180度)。"""
    diff = abs(a - b) % 360
    return min(diff, 360 - diff)


def calculate_wind_terrain_score(wind_angle: float | None, facing_direction: float) -> dict:
    """
    風向 vs 釣點朝向的加權分 (0-100)。

    邏輯：
    - 風從「正對釣點朝向吹來」(夾角接近180度，即頂頭風從海面吹向岸) 通常代表
      該側有風浪、走水較活，多數釣場經驗認為這樣更易聚魚 -> 給較高分。
    - 風跟釣點朝向「同向」(夾角接近0，風從陸地吹向海面，岸邊變成下風/平靜側)
      通常代表岸邊水面平靜、適合操作但魚口可能較弱 -> 中等分。
    - 這是簡化的經驗假設，不同魚種、不同地形實際情況差異很大，
      務必之後依實際釣況反饋調整這個函式，不要當成絕對標準。

    若 wind_angle 是 None（解析失敗），回傳 score=None，讓上層知道要忽略風向因子，
    不要默默塞一個錯誤的中間值進去誤導融合結果。
    """
    if wind_angle is None:
        return {"wind_angle": None, "angle_diff": None, "wind_terrain_score": None}

    diff = angle_difference(wind_angle, facing_direction)
    # diff=180 (頂風) -> 100分； diff=0 (順風/背風) -> 40分（仍給基本分，不是0，
    # 因為風平浪靜也是能釣，只是相對沒那麼活躍）
    score = round(40 + (diff / 180) * 60, 1)
    return {"wind_angle": wind_angle, "angle_diff": round(diff, 1), "wind_terrain_score": score}


def fetch_current_weather() -> dict:
    """即時天氣現況 (rhrread)：用於取得降雨、氣溫等輔助資訊。"""
    raw = fetch_json({"dataType": "rhrread", "lang": "tc"})
    rainfall_list = raw.get("rainfall", {}).get("data", [])
    has_rain = any(
        item.get("max", 0) and float(item.get("max", 0)) > 0 for item in rainfall_list
    )
    return {
        "update_time": raw.get("updateTime"),
        "has_rain_somewhere": has_rain,
        "raw_warning_message": raw.get("warningMessage", []),
    }


def fetch_forecast_wind() -> dict | None:
    """
    9-day forecast (fnd)：抓今天的 forecastWind 文字。
    回傳 {"wind_text": "...", "forecast_date": "20260701"} 或 None（API失敗時）。
    """
    raw = fetch_json({"dataType": "fnd", "lang": "tc"})
    forecasts = raw.get("weatherForecast", [])
    if not forecasts:
        return None
    today_forecast = forecasts[0]  # 列表第一筆就是今天/明天起算的第一天
    return {
        "wind_text": today_forecast.get("forecastWind", ""),
        "forecast_date": today_forecast.get("forecastDate"),
        "weather_desc": today_forecast.get("forecastWeather", ""),
    }


def load_base_tide(spot_id: str) -> dict | None:
    """讀取工作流 A 產出的背景分檔案。若還沒跑過工作流 A 或檔案損毀，回 None。"""
    path = DATA_DIR / f"base_tide_{spot_id}.json"
    if not path.exists():
        print(f"[{spot_id}] 找不到 {path}，請先執行工作流 A (monthly_tide_fetch.py)")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[{spot_id}] base_tide 檔案損毀: {e}")
        return None


def build_24h_score_series(base_tide: dict, wind_score_info: dict, has_rain: bool) -> list[dict]:
    """
    融合背景分（工作流A）與風向地形分（這次抓到的），產出未來24小時的綜合指數。

    今天與明天各自的 tide_range_score 在 base_tide["days"] 裡用日期查找；
    若 base_tide 是「下個月」資料而今天還在當月，可能查不到對應日期，
    這種邊界情況直接 fallback 用 base_tide 裡第一筆可用的日期分數，
    並在輸出加註 "fallback_used": true，不讓前端因為查無資料而整段空白。
    """
    now = datetime.now(timezone(timedelta(hours=8)))  # 香港時區 UTC+8
    days_data = base_tide.get("days", {})

    series = []
    for h in range(24):
        ts = now + timedelta(hours=h)
        date_key = ts.strftime("%Y-%m-%d")
        day_info = days_data.get(date_key)
        fallback_used = False

        if day_info is None and days_data:
            # 查無當天資料（常見原因：base_tide 存的是下個月，但現在還沒到月底）
            first_available_key = sorted(days_data.keys())[0]
            day_info = days_data[first_available_key]
            fallback_used = True

        tide_score = day_info.get("tide_range_score") if day_info else None
        wind_score = wind_score_info.get("wind_terrain_score")

        # 融合公式：潮汐背景分佔 60%，風向地形分佔 40%；
        # 若某一項是 None（資料缺失），就只用另一項（不要讓單一缺失污染整體分數）。
        if tide_score is not None and wind_score is not None:
            final_score = round(tide_score * 0.6 + wind_score * 0.4, 1)
        elif tide_score is not None:
            final_score = tide_score
        elif wind_score is not None:
            final_score = wind_score
        else:
            final_score = None

        # 下雨時做一個簡單扣分（很多釣場經驗認為持續大雨會讓魚口轉差，輕雨影響較小，
        # 這裡先用「有降雨記錄」就扣10分的粗略規則，之後可以依雨量分級細化）
        if final_score is not None and has_rain:
            final_score = max(0, round(final_score - 10, 1))

        series.append({
            "datetime": ts.strftime("%Y-%m-%dT%H:00:00+08:00"),
            "hour": ts.hour,            # 0-23，供前端 chart.js tooltip 與 app.js matchHr 使用
            "tide_range_score": tide_score,
            "wind_terrain_score": wind_score,
            "final_score": final_score,
            "fallback_used": fallback_used,
        })

    return series


def process_spot(spot_id: str, cfg: dict, wind_angle: float | None,
                  wind_speed_kmh: float | None, has_rain: bool) -> dict:
    base_tide = load_base_tide(spot_id)
    wind_score_info = calculate_wind_terrain_score(wind_angle, cfg["facing_direction"])

    if base_tide is None or base_tide.get("status") != "ok":
        return {
            "spot_id": spot_id,
            "spot_name": cfg["name"],
            "status": "error",
            "error_message": "缺少有效的 base_tide 背景資料，請確認工作流 A 已成功執行",
            "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(),
            "hourly_scores": [],
        }

    hourly_scores = build_24h_score_series(base_tide, wind_score_info, has_rain)

    return {
        "spot_id": spot_id,
        "spot_name": cfg["name"],
        "station_id": cfg["station_id"],        # 供前端 spot-meta 顯示潮汐站資訊
        "station_note": cfg.get("station_note", ""),
        "status": "ok",
        "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        "current_wind_angle": wind_angle,
        "current_wind_speed_kmh": wind_speed_kmh,
        "facing_direction": cfg["facing_direction"],
        "has_rain_somewhere_in_hk": has_rain,
        "hourly_scores": hourly_scores,
        "target_fish": cfg["target_fish"],
        "data_source_note": (
            "風向資料來自天文台9天預報的文字描述（逐日更新），"
            "並非逐3小時的即時觀測風速風向；潮汐背景分來自天文台預測潮汐API。"
        ),
    }


def main():
    validate_config()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("抓取即時天氣現況...")
    try:
        current_weather = fetch_current_weather()
        has_rain = current_weather["has_rain_somewhere"]
    except requests.RequestException as e:
        print(f"即時天氣抓取失敗，預設無雨繼續執行: {e}")
        has_rain = False

    print("抓取9天預報（風向文字）...")
    wind_angle, wind_speed_kmh = None, None
    try:
        forecast = fetch_forecast_wind()
        if forecast:
            wind_text = forecast["wind_text"]
            wind_angle = parse_wind_direction(wind_text)
            wind_speed_kmh = parse_wind_speed_kmh(wind_text)
            print(f"  風向文字: '{wind_text}' -> 角度={wind_angle}, 風速約={wind_speed_kmh}km/h")
    except requests.RequestException as e:
        print(f"9天預報抓取失敗，本次將忽略風向加權: {e}")

    overall_success = True
    for spot_id, cfg in FISHING_SPOTS_CONFIG.items():
        print(f"[{spot_id}] 計算綜合垂釣指數...")
        result = process_spot(spot_id, cfg, wind_angle, wind_speed_kmh, has_rain)
        output_path = DATA_DIR / f"tide_score_{spot_id}.json"
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[{spot_id}] 已寫入 {output_path}")
        if result["status"] != "ok":
            overall_success = False

    if not overall_success:
        print("\n部分釣點處理失敗，請檢查上方錯誤訊息（通常是還沒跑過工作流A）。")
        sys.exit(1)

    print("\n全部釣點處理完成。")


if __name__ == "__main__":
    main()
