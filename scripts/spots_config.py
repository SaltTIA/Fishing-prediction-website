"""
釣點與魚種中繼資料設定檔 (Single Source of Truth)
==================================================
工作流 A (monthly_tide_fetch.py) 與工作流 B (frequent_weather_fetch.py)
都從這裡 import FISHING_SPOTS_CONFIG，避免設定散落在多個檔案。

重要備註（請詳閱，這關係到資料準確度）：
------------------------------------------------
1. station_id 必須是香港天文台「預測潮汐 API (HHOT/HLT)」支援的 14 個潮汐站代碼之一：
   CCH(長洲) CLK(赤鱲角) CMW(芝麻灣) KCT(葵涌) KLW(高流灣) LOP(樂安排)
   MWC(馬灣) QUB(鰓魚涌) SPW(石壁) TAO(大澳) TBT(尖鼻咀) TMW(大廟灣)
   TPK(大埔滘) WAG(橫瀾島)

   天文台「沒有」吐露港、尖沙咀專屬潮汐站，必須借用地理位置最近的代碼，
   潮高趨勢會有誤差（尤其吐露港是內灣，實際潮時可能與 TPK 有落差），
   之後若要更準，可改用水文處驗潮站或自行做潮時偏移校正。

2. facing_direction 是「釣點面向海的方位角」(0=北, 90=東, 180=南, 270=西)，
   用於工作流 B 計算「風向 vs 地形」的避風/頂風加權，數值為估計值，
   建議實地確認後微調。

3. target_fish 純粹是前端展示用的靜態標籤，不影響運算，
   之後可以無限擴充，不會動到任何 Python 計算邏輯。
"""

FISHING_SPOTS_CONFIG = {
    "tolo_harbour": {
        "name": "吐露港",
        "station_id": "TPK",       # 借用大埔滘 (Tai Po Kau)，最接近的官方潮汐站
        "station_note": "天文台無吐露港專屬站，借用大埔滘(TPK)資料",
        "facing_direction": 70,    # 東北東
        "target_fish": [
            {"name": "黑沙鱲", "type": "底棲/鯛科"},
            {"name": "黃腳鱲", "type": "底棲/鯛科"},
            {"name": "烏頭", "type": "上層/雜食"},
            {"name": "泥鯭", "type": "全水層"},
        ],
    },
    "tsim_sha_tsui": {
        "name": "尖沙咀",
        "station_id": "QUB",       # 借用鰓魚涌 (Quarry Bay)，維港內潮汐特性接近
        "station_note": "借用鰓魚涌(QUB)資料代表維港潮汐",
        "facing_direction": 180,   # 朝南（維港本流）
        "target_fish": [
            {"name": "牛屎鱲", "type": "底棲/岩礁"},
            {"name": "細鱗", "type": "中下層"},
            {"name": "鱸魚", "type": "掠食性"},
        ],
    },
    "cheung_chau": {
        "name": "長洲",
        "station_id": "CCH",       # 長洲本身就有官方站，最準
        "station_note": "長洲本身設有官方潮汐站，資料最準確",
        "facing_direction": 200,   # 西南
        "target_fish": [
            {"name": "黑鱲", "type": "底棲/鯛科"},
        ],
    },
    "ng_tung_river": {
        "name": "梧桐河",
        "station_id": "KLW",       # 借用高流灣 (Kau Lau Wan)，沙頭角海一帶最近站
        "station_note": "借用高流灣(KLW)資料，梧桐河出海口位於沙頭角海",
        "facing_direction": 135,   # 東南（面向沙頭角海）
        "target_fish": [
            {"name": "羅非魚", "type": "雜食/上層"},
            {"name": "塘虱", "type": "底棲/雜食"},
            {"name": "生魚", "type": "掠食性"},
            {"name": "鯪魚", "type": "底棲/雜食"},
        ],
    },
    "tsuen_wan_pier": {
        "name": "荃灣碼頭",
        "station_id": "KCT",       # 葵涌 (Kwai Chung)，與荃灣同處藍巴勒海峽
        "station_note": "借用葵涌(KCT)資料，荃灣碼頭位於藍巴勒海峽",
        "facing_direction": 225,   # 西南（面向藍巴勒海峽）
        "target_fish": [
            {"name": "烏頭", "type": "上層/雜食"},
            {"name": "金鼓", "type": "底棲/鯛科"},
            {"name": "牛屎鱲", "type": "底棲/岩礁"},
            {"name": "泥鯭", "type": "全水層"},
        ],
    },
    "tuen_mun_pier": {
        "name": "屯門碼頭",
        "station_id": "TBT",       # 尖鼻咀 (Tsim Bei Tsui)，就在屯門旁，最近官方站
        "station_note": "借用尖鼻咀(TBT)資料，為屯門一帶最近官方潮汐站",
        "facing_direction": 270,   # 朝西（面向青山灣出口）
        "target_fish": [
            {"name": "烏頭", "type": "上層/雜食"},
            {"name": "黃腳鱲", "type": "底棲/鯛科"},
            {"name": "石狗公", "type": "底棲/岩礁"},
            {"name": "泥鯭", "type": "全水層"},
        ],
    },
    "tin_shui_wai_river": {
        "name": "天水圍河",
        "station_id": "TBT",       # 借用尖鼻咀 (Tsim Bei Tsui)，天水圍最近官方潮汐站
        "station_note": "借用尖鼻咀(TBT)資料，天水圍河近后海灣",
        "facing_direction": 315,   # 西北（河道走向）
        "target_fish": [
            {"name": "羅非魚", "type": "淡水/底層"},
            {"name": "鯉魚", "type": "淡水/底層"},
            {"name": "鯽魚", "type": "淡水/底層"},
            {"name": "生魚", "type": "掠食性"},
        ],
    },
}

# 天文台預測潮汐 API 支援的全部站碼（用於程式內驗證，避免打錯字）
VALID_STATION_IDS = {
    "CCH", "CLK", "CMW", "KCT", "KLW", "LOP", "MWC",
    "QUB", "SPW", "TAO", "TBT", "TMW", "TPK", "WAG",
}


def validate_config():
    """啟動時自我檢查，設定檔打錯字會直接在 CI 失敗，而不是默默產生壞資料。"""
    errors = []
    for spot_id, cfg in FISHING_SPOTS_CONFIG.items():
        if cfg["station_id"] not in VALID_STATION_IDS:
            errors.append(
                f"釣點 '{spot_id}' 的 station_id '{cfg['station_id']}' "
                f"不是天文台合法潮汐站代碼"
            )
        if not (0 <= cfg["facing_direction"] <= 360):
            errors.append(f"釣點 '{spot_id}' 的 facing_direction 超出 0-360 範圍")
        if not cfg.get("target_fish"):
            errors.append(f"釣點 '{spot_id}' 沒有設定 target_fish")
    if errors:
        raise ValueError("設定檔錯誤：\n" + "\n".join(f"  - {e}" for e in errors))


if __name__ == "__main__":
    validate_config()
    print(f"設定檔驗證通過，共 {len(FISHING_SPOTS_CONFIG)} 個釣點。")
