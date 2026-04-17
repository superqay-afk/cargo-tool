from pathlib import Path
import json
import random
from datetime import datetime, timedelta


BASE = Path(__file__).parent / "知识库"
BASE.mkdir(parents=True, exist_ok=True)
random.seed(7)

cities = [
    ("四川省", "成都市", "青羊区"),
    ("四川省", "成都市", "双流区"),
    ("广东省", "广州市", "白云区"),
    ("上海市", "上海市", "浦东新区"),
    ("北京市", "北京市", "朝阳区"),
    ("重庆市", "重庆市", "渝北区"),
]


def write_records(filename: str, title: str, records: list[dict]):
    content = [
        f"# {title}",
        "",
        f"## 模拟数据（{len(records)}条）",
        "",
        "```json",
        json.dumps(records, ensure_ascii=False, indent=2),
        "```",
        "",
    ]
    (BASE / filename).write_text("\n".join(content), encoding="utf-8")


def main():
    # 01
    r01 = []
    for i in range(1, 101):
        r01.append(
            {
                "shipper_id": f"SHP_{i:04d}",
                "company_name": f"示例货主{i:03d}",
                "account_type": "3PL",
                "contact_name": f"调度{i:03d}",
                "contact_phone": f"13{random.randint(100000000, 999999999)}",
                "default_payment_method": random.choice(["到付", "月结", "预付"]),
                "default_invoice_type": random.choice(["普票", "专票", "不需要"]),
                "timezone": "Asia/Shanghai",
                "status": "active",
            }
        )
    write_records("01_货主主数据知识库.md", "货主主数据知识库", r01)

    # 02
    r02 = []
    for i in range(1, 101):
        o = cities[(i - 1) % len(cities)]
        d = cities[(i + 1) % len(cities)]
        r02.append(
            {
                "lane_id": f"LANE_{i:04d}",
                "origin_province": o[0],
                "origin_city": o[1],
                "origin_district": o[2],
                "destination_province": d[0],
                "destination_city": d[1],
                "destination_district": d[2],
                "route_key": f"{o[1]}-{d[1]}-{random.choice(['9.6冷藏', '13米高栏', '7.6厢车'])}",
                "distance_km": random.randint(60, 2200),
                "std_eta_hours": random.randint(4, 48),
                "active": True,
            }
        )
    write_records("02_线路知识库.md", "线路知识库", r02)

    # 03
    r03 = []
    for i in range(1, 101):
        r03.append(
            {
                "rule_id": f"CVR_{i:04d}",
                "goods_category_l1": random.choice(["冻品", "冷鲜", "水果", "蔬菜", "常温"]),
                "goods_category_l2": random.choice(["猪肉", "牛肉", "海鲜", "水果", "蔬菜"]),
                "required_vehicle_type": random.choice(["冷藏车", "高栏", "厢式货车"]),
                "allowed_vehicle_lengths": random.sample(
                    ["4.2米", "6.8米", "7.6米", "9.6米", "13米"], k=2
                ),
                "temp_requirement": random.choice(["-18℃以下", "0-4℃", "常温"]),
                "loading_method": random.choice(["人工装卸", "叉车", "自装自卸"]),
                "is_blocking": random.choice([True, False]),
            }
        )
    write_records("03_货物车辆约束知识库.md", "货物车辆约束知识库", r03)

    # 04
    r04 = []
    for i in range(1, 101):
        r04.append(
            {
                "memory_id": f"MEM_{i:04d}",
                "shipper_id": f"SHP_{(i % 100) + 1:04d}",
                "lane_id": f"LANE_{(i % 100) + 1:04d}",
                "field_name": random.choice(
                    [
                        "A04_origin_address_detail",
                        "A08_destination_address_detail",
                        "F01_origin_contact_name",
                        "E03_payment_method",
                    ]
                ),
                "field_value": f"历史值_{i:03d}",
                "use_count": random.randint(3, 80),
                "last_used_at": (datetime(2026, 3, 1) + timedelta(hours=i)).strftime(
                    "%Y-%m-%d %H:%M:%S"
                ),
                "confidence": round(random.uniform(0.7, 0.99), 2),
            }
        )
    write_records("04_历史发货行为知识库.md", "历史发货行为知识库", r04)

    # 05
    r05 = []
    for i in range(1, 101):
        r05.append(
            {
                "dedup_id": f"DEDUP_{i:04d}",
                "shipper_id": f"SHP_{(i % 100) + 1:04d}",
                "biz_date_cn": "2026-03-27",
                "raw_text_hash": f"hash_{i:04d}",
                "fingerprint": f"成都广州_冻品_9.6_{800 + i}_{28000 + i * 20}",
                "status": random.choice(["pending_confirm", "confirmed_create", "ignored"]),
                "chosen_action": random.choice(["confirm_create", "ignore"]),
            }
        )
    write_records("05_重复判定索引知识库.md", "重复判定索引知识库", r05)

    # 06
    r06 = []
    for i in range(1, 101):
        r06.append(
            {
                "driver_id": f"DRV_{i:04d}",
                "name": f"司机{i:03d}",
                "phone": f"13{random.randint(100000000, 999999999)}",
                "familiar_level": random.choice(["diamond", "gold", "normal", "stranger"]),
                "vehicle_type": random.choice(["冷藏车", "高栏", "厢式货车"]),
                "vehicle_length": random.choice(["4.2米", "6.8米", "7.6米", "9.6米", "13米"]),
                "distance_to_origin_km": random.randint(1, 500),
                "empty_status": random.choice(["空车", "在途", "未知"]),
                "route_exp_count": random.randint(0, 60),
                "contact_allowed": random.choice([True, True, False]),
            }
        )
    write_records("06_运力池知识库.md", "运力池知识库", r06)

    # 07
    r07 = []
    for i in range(1, 101):
        lv = random.choice(["red", "yellow", "blue"])
        action = "block_until_fixed" if lv == "red" else ("warn_only" if lv == "yellow" else "suggest_only")
        r07.append(
            {
                "rule_id": f"RISK_{i:04d}",
                "level": lv,
                "name": random.choice(["卸货地址不精确", "装货时间模糊", "冻品未填温度", "运费低于市场P25"]),
                "trigger_expression": f"expr_{i:04d}",
                "action": action,
                "message": f"风险提示_{i:04d}",
                "fix_suggestion": f"修复建议_{i:04d}",
                "source": "取消归因",
            }
        )
    write_records("07_风险规则知识库.md", "风险规则知识库", r07)

    # 08
    r08 = []
    for i in range(1, 101):
        p50 = random.randint(8000, 42000)
        r08.append(
            {
                "market_id": f"MKT_{i:04d}",
                "lane_id": f"LANE_{(i % 100) + 1:04d}",
                "vehicle_type": random.choice(["冷藏车", "高栏"]),
                "vehicle_length": random.choice(["7.6米", "9.6米", "13米"]),
                "goods_type": random.choice(["冻品", "冷鲜", "水果", "蔬菜"]),
                "window_days": random.choice([7, 14]),
                "p25": p50 - random.randint(500, 2500),
                "p50": p50,
                "p75": p50 + random.randint(500, 2500),
                "sample_count": random.randint(12, 260),
                "trend": random.choice(["上行", "下行", "持平"]),
            }
        )
    write_records("08_市场行情知识库.md", "市场行情知识库", r08)

    # 09
    stages = ["货源统一录入", "智能解析", "智能补全", "风险诊断", "发货模式", "发货追踪"]
    r09 = []
    for i in range(1, 101):
        c1 = cities[(i - 1) % len(cities)]
        c2 = cities[(i + 2) % len(cities)]
        stage = stages[(i - 1) % len(stages)]
        r09.append(
            {
                "cargo_id": f"CG_20260327_{i:04d}",
                "shipper_id": f"SHP_{(i % 100) + 1:04d}",
                "raw_input": f"[{c1[1]}{c1[2]}→{c2[1]}{c2[2]}][冻品猪肉][9.6冷藏][明早8点][{28000 + i * 10}][到付]",
                "stage_name": stage,
                "parse_status": "done" if stage != "货源统一录入" else "pending",
                "risk_status": "passed" if stage in ["发货模式", "发货追踪"] else "pending",
                "publish_status": "published" if stage == "发货追踪" else "draft",
                "order_id": f"ORD_{i:06d}" if stage == "发货追踪" else "",
                "created_at": (datetime(2026, 3, 27) + timedelta(minutes=i * 2)).strftime("%Y-%m-%d %H:%M:%S"),
                "updated_at": (datetime(2026, 3, 27) + timedelta(minutes=i * 3)).strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
    write_records("09_货源知识库.md", "货源知识库", r09)

    # 11
    r11 = []
    for i in range(1, 57):
        r11.append(
            {
                "field_index": i,
                "field_code": f"shipper_field_{i:03d}",
                "field_type": "string",
                "field_name_zh": f"货主字段{i:03d}",
                "level": "L2",
            }
        )
    write_records("11_平台货主标准字段知识库.md", "平台货主标准字段知识库", r11)

    # 12
    mapping = [
        {"local_field": "cargo_id", "platform_field": "cargo_id", "mapping_desc": "主键映射", "note": "一对一"},
        {"local_field": "shipper_id", "platform_field": "shipper_id", "mapping_desc": "货主映射", "note": "一对一"},
        {"local_field": "raw_input", "platform_field": "cargo_desc", "mapping_desc": "原始文本映射备注", "note": "可为空"},
        {"local_field": "stage_name", "platform_field": "cargo_status_desc", "mapping_desc": "阶段映射状态描述", "note": "规则转换"},
        {"local_field": "publish_status", "platform_field": "cargo_status_id", "mapping_desc": "发货状态映射", "note": "规则转换"},
        {"local_field": "order_id", "platform_field": "order_id", "mapping_desc": "订单映射", "note": "一对一"},
        {"local_field": "created_at", "platform_field": "create_time", "mapping_desc": "创建时间映射", "note": "一对一"},
        {"local_field": "updated_at", "platform_field": "update_time", "mapping_desc": "更新时间映射", "note": "一对一"},
        {"local_field": "(派生)origin_city", "platform_field": "start_city", "mapping_desc": "起点城市映射", "note": "来自解析"},
        {"local_field": "(派生)destination_city", "platform_field": "end_city", "mapping_desc": "终点城市映射", "note": "来自解析"},
        {"local_field": "(派生)vehicle_length", "platform_field": "truck_len", "mapping_desc": "车长映射", "note": "枚举转换"},
        {"local_field": "(派生)freight_price", "platform_field": "on_shelf_price", "mapping_desc": "运费映射", "note": "元单位"},
    ]
    write_records("12_本地货源与平台货源字段映射表.md", "本地货源与平台货源字段映射表", mapping)

    # 13
    actual = []
    items = [
        ("cargo_id", "货源ID", "关键主键", "是", "货源统一录入"),
        ("shipper_id", "货主ID", "关键主键", "是", "货源统一录入"),
        ("cargo_name", "货物名称", "展示与匹配", "是", "智能解析"),
        ("first_category_name", "一级货类", "品类识别", "是", "智能解析"),
        ("cargo_weight", "货物重量(吨)", "运力匹配", "是", "智能补全"),
        ("cargo_capacity", "货物体积(方)", "运力匹配", "否", "智能补全"),
        ("truck_type_name", "需求车型", "运力筛选", "是", "智能补全"),
        ("truck_len", "需求车长", "运力筛选", "是", "智能补全"),
        ("load_addr", "装货地址", "路径与风控", "是", "智能补全"),
        ("unloading_addr", "卸货地址", "路径与风控", "是", "智能补全"),
        ("load_time", "装货时间", "时效匹配", "是", "智能补全"),
        ("on_shelf_price", "上架运价", "成交决策", "是", "智能补全"),
        ("pay_method", "付款方式", "成交沟通", "是", "智能补全"),
        ("cargo_status_desc", "货源状态描述", "状态展示", "是", "风险诊断"),
        ("deal_mode", "议价模式", "发货策略", "是", "发货模式"),
        ("is_point_cargo", "是否指派", "发货策略", "是", "发货模式"),
        ("on_shelf_time", "上架时间", "状态跟踪", "是", "发货模式"),
        ("order_id", "订单ID", "成交关联", "否", "发货追踪"),
        ("driver_id", "司机ID", "成交关联", "否", "发货追踪"),
        ("order_status", "订单状态", "履约状态", "否", "发货追踪"),
        ("finish_time", "完单时间", "履约时序", "否", "发货追踪"),
        ("cancel_time", "取消时间", "违约分析", "否", "发货追踪"),
        ("gtv", "GTV(元)", "经营分析", "否", "发货追踪"),
        ("create_time", "创建时间", "审计字段", "是", "全流程"),
        ("update_time", "更新时间", "审计字段", "是", "全流程"),
    ]
    for a, b, c, d, e in items:
        actual.append(
            {"field_code": a, "field_name_zh": b, "purpose": c, "required": d, "stage": e}
        )
    write_records("13_平台发货实际使用字段表.md", "平台发货实际使用字段表", actual)

    print("生成完成")


if __name__ == "__main__":
    main()
