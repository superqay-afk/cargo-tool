const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (n) => Number(n).toLocaleString("zh-CN");

function nowClock() {
  const el = $("#clock");
  if (!el) return;
  el.textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}
setInterval(nowClock, 1000);
nowClock();

const STAGES = [
  { id: 1, name: "智能解析" },
  { id: 2, name: "货源补全" },
  { id: 3, name: "快捷找车" },
  { id: 4, name: "已沉淀飞书" }
];

function createId(prefix) {
  const r = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${r}`;
}

function stageLabel(stageId) {
  const s = STAGES.find((x) => x.id === stageId);
  return s ? s.name : "未知阶段";
}

function stagePill(stageId, blocked) {
  const cls = blocked ? "pill red" : stageId >= 4 ? "pill green" : "pill yellow";
  return `<span class="${cls}">${stageLabel(stageId)}</span>`;
}

function safeText(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function splitBulkText(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  // 改为按行分割，每行一票
  return t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}

function guessDistrict(text, options) {
  const hit = options.find((x) => text.includes(x));
  return hit ? `${hit}区` : "";
}

async function parseSingleRaw(raw) {
  const text = String(raw || "").trim();
  
  const systemPrompt = `你是一个物流货源智能解析助手。用户会输入一段货源文本，请你提取其中的关键信息，并以严格的JSON格式输出。
需要的字段及其格式要求：
- A02_origin_city: 装货城市，如"成都市"
- A03_origin_district: 装货区县，如"青羊区"
- A06_destination_city: 卸货城市，如"广州市"
- A07_destination_district: 卸货区县，如"白云区"
- B01_goods_category_l1: 一级货类（如 冻品、冷鲜、常温、医药等）
- B02_goods_category_l2: 二级货类（如 猪肉、牛肉、海鲜、水果、蔬菜等）
- C01_vehicle_type: 车型（如 冷藏、保温、厢式、平板、高栏等，如果是冷藏车填"冷藏"）
- C02_vehicle_length: 车长（如 4.2米、6.8米、9.6米、13米、15米、17.5米等）
- D01_load_time_start: 装货时间（如"2026-04-18 上午"等）
- E01_freight_price: 运费，纯数字（如 30000）
- E03_payment_method: 付款方式（到付、回单后、卸货后）
- A04_origin_address_detail: 详细装货地址
- A08_destination_address_detail: 详细卸货地址
- B03_goods_weight_ton: 货物重量(吨)，纯数字
- B04_goods_volume_m3: 货物体积(方)，纯数字
- B06_temperature_requirement: 温度要求（冷冻、冷藏、常温等）
- B07_package_method: 包装方式（托盘、散装、纸箱等）
- F01_origin_contact_name: 装货人姓名
- F02_origin_contact_phone: 装货人电话
- F03_destination_contact_name: 卸货人姓名
- F04_destination_contact_phone: 卸货人电话
- G01_special_requirements: 特殊要求备注

如果无法确定某个字段，请将该字段省略。
请直接返回纯JSON对象，不要带有任何多余的解释，例如：
{"A02_origin_city": "成都市", "A06_destination_city": "广州市", "E01_freight_price": 30000}`;

  let out = {};
  try {
    const base = feishuBackendBase();
    const res = await fetch(`${base}/api/ai/deepseek_parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, system_prompt: systemPrompt })
    });
    const j = await res.json();
    out = j?.data || {};
  } catch(e) {
    console.error("Deepseek parse failed:", e);
    // fallback
    out.A02_origin_city = "成都市";
    out.A06_destination_city = "广州市";
  }

  const conf = {};
  const parsed = {};
  Object.keys(out).forEach((k) => {
    parsed[k] = { value: out[k], confidence: 0.95 }; // DeepSeek解析的置信度统一设高
  });

  const unrecognized = ["A04_origin_address_detail", "A08_destination_address_detail", "B03_goods_weight_ton", "B06_temperature_requirement", "F01_origin_contact_name"].filter((f) => !parsed[f]);

  const parsedCount = Object.keys(parsed).length;
  const midCount = 0;
  const unCount = unrecognized.length;
  const summary = `DeepSeek智能解析已完成：解析 ${parsedCount}个字段；未识别 ${unCount}个`;

  return { parsed, unrecognized, summary, raw_text_used: text.slice(0, 240) };
}

function maybeAlertHeavyCargo(sh) {
  if (!sh || sh.heavy_warned === true) return;
  const w = sh.parsed_result?.parsed?.B03_goods_weight_ton?.value;
  const n = parseFloat(String(w ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return;
  if (n >= 30) {
    sh.heavy_warned = true;
    alert(`识别到重货：约 ${n} 吨。\n\n建议确认：装卸要求、车型/车长、过磅、运费与限行。`);
  }
}

function completeCargoFromParsed(parsedFields) {
  const cargo = {};
  Object.entries(parsedFields || {}).forEach(([k, v]) => {
    cargo[k] = v.value;
  });

  const completed = [];

  const put = (field, value, source, conf) => {
    if (value === undefined || value === null || value === "") return;
    cargo[field] = value;
    completed.push({ field, value, source, conf });
  };

  put("A04_origin_address_detail", DATA.demo.origin_address, "历史记录", 0.95);
  put("A08_destination_address_detail", DATA.demo.destination_address, "历史记录", 0.95);

  put("F01_origin_contact_name", DATA.shipper_profile.cargo_habits.contact_at_origin.name, "历史记录", 0.95);
  put("F02_origin_contact_phone", DATA.shipper_profile.cargo_habits.contact_at_origin.phone, "历史记录", 0.95);
  put("F03_destination_contact_name", DATA.shipper_profile.cargo_habits.contact_at_destination.name, "历史记录", 0.95);
  put("F04_destination_contact_phone", DATA.shipper_profile.cargo_habits.contact_at_destination.phone, "历史记录", 0.95);

  put("E03_payment_method", DATA.shipper_profile.cargo_habits.payment_method, "历史记录", 0.9);
  put("E04_invoice_type", DATA.shipper_profile.cargo_habits.invoice_type || "普票", "历史记录", 0.9);
  put("G01_special_requirements", DATA.shipper_profile.cargo_habits.special_requirements_template, "历史记录", 0.9);
  put("Z01_client_quoted_price", Number(cargo.E01_freight_price || DATA.demo.freight_price), "业务字段", 0.95);
  put("Z02_platform_shelf_price", Number(cargo.E01_freight_price || DATA.demo.freight_price), "业务字段", 0.95);
  put("Z03_driver_deal_price", "", "业务字段", 0.9);
  put("Z04_margin_amount", "", "业务字段", 0.9);

  put("B06_temperature_requirement", DATA.demo.temp_requirement, "知识库参考", 0.9);

  put("C03_vehicle_width_wide", false, "默认规则", 0.9);
  put("C04_cold_machine_required", true, "默认规则", 0.9);
  put("E02_price_type", "一口价", "默认规则", 0.9);

  const stillMissing = ["B03_goods_weight_ton"].filter((x) => !cargo[x]);
  const suggestMissing = ["B07_goods_count"].filter((x) => !cargo[x]);

  const marketRef = DATA.market_data.route_market_price;
  const market_reference = `市场参考：P25 ¥${fmt(marketRef.price_p25)}，P50 ¥${fmt(marketRef.price_p50)}，P75 ¥${fmt(marketRef.price_p75)}`;

  return { cargo, completed_fields: completed, still_missing_required: stillMissing, still_missing_suggest: suggestMissing, market_reference };
}

function prematchDrivers(cargo) {
  const needType = cargo.C01_vehicle_type || "冷藏车";
  const needLen = cargo.C02_vehicle_length || "9.6米";
  const needWide = cargo.C03_vehicle_width_wide === true;
  const needCold = cargo.C04_cold_machine_required === true;

  const filtered = DATA.driver_pool
    .filter((d) => d.vehicle_type === needType)
    .filter((d) => d.vehicle_length === needLen)
    .filter((d) => (needWide ? d.vehicle_width_wide : true))
    .filter((d) => (needCold ? d.cold_machine !== false : true))
    .filter((d) => (d.distance_to_origin_km ?? 9999) <= 200);

  const levelScore = (l) => (l === "diamond" ? 40 : l === "gold" ? 30 : l === "normal" ? 20 : 10);
  const emptyScore = (s, src) => {
    if (s !== "空车") return 0;
    if (src === "司机主动上报") return 30;
    if (src === "平台推算") return 15;
    return 0;
  };
  const distScore = (km) => (km <= 20 ? 20 : km <= 50 ? 15 : km <= 100 ? 10 : 5);
  const routeScore = (d) => {
    const exp = d.platform_stats?.route_experience_chengdu_guangzhou ?? 0;
    if (exp >= 10) return 10;
    if (exp >= 3) return 5;
    if (exp >= 1) return 2;
    return 0;
  };

  const list = filtered
    .map((d) => {
      const km = d.distance_to_origin_km ?? 999;
      const score = levelScore(d.familiar_level) + emptyScore(d.empty_status, d.empty_status_source) + distScore(km) + routeScore(d);

      const warnings = [];
      if (d.empty_status_source === "未知") warnings.push("状态未知，建议电话确认");
      if ((d.current_location?.location_age_minutes ?? 0) > 180) warnings.push("定位已超3小时，位置可能已变化");
      if (d.empty_status_source === "平台推算") warnings.push("基于平台订单推算，线下接单情况未知");

      const lastCoop = d.cooperation_with_shipper?.last_order_date
        ? `${Math.max(1, Math.round((new Date("2026-03-27") - new Date(d.cooperation_with_shipper.last_order_date)) / 86400000))}天前合作 · ${d.cooperation_with_shipper.last_order_route || "成都→广州"} · ✅无客诉`
        : "暂无与该货主合作记录";

      const contactAvailable = d.familiar_level !== "stranger";

      return {
        driver_id: d.driver_id,
        display_name: d.name,
        familiar_level: d.familiar_level,
        familiar_level_label: d.familiar_level_label,
        vehicle_info: `${d.vehicle_length} ${d.vehicle_type} · ${d.cold_machine ? "有独立冷机" : "无冷机"}`,
        distance_label: `距装货地${km}km`,
        last_cooperation: lastCoop,
        empty_status_label: `${d.empty_status}${d.empty_status_source === "司机主动上报" ? "（主动上报）" : d.empty_status_source === "平台推算" ? "（平台推算）" : ""}`,
        empty_status_warning: warnings.length ? warnings.join("；") : null,
        score,
        recommend_action: contactAvailable ? "立刻联系" : "发货后可见",
        contact_available: contactAvailable,
        risk_notes: []
      };
    })
    .sort((a, b) => b.score - a.score);

  const by = { diamond: [], gold: [], normal: [], stranger: [] };
  list.forEach((x) => by[x.familiar_level].push(x));

  const top = [];
  top.push(...by.diamond);
  top.push(...by.gold.slice(0, 2));
  top.push(...by.normal.slice(0, 1));
  top.push(...by.stranger.slice(0, 1));

  return top.slice(0, 4);
}

function diagnoseRisks(cargo) {
  const risks = [];
  let canPublish = true;

  if (!cargo.A04_origin_address_detail) {
    risks.push({ rule_id: "RISK_000", level: "red", field: "A04_origin_address_detail", message: "装货地址不够详细", action: "block_until_fixed" });
    canPublish = false;
  }
  if (!cargo.A08_destination_address_detail) {
    risks.push({ rule_id: "RISK_001", level: "red", field: "A08_destination_address_detail", message: "卸货地址不够详细", action: "block_until_fixed" });
    canPublish = false;
  }
  if (!cargo.F01_origin_contact_name || !cargo.F02_origin_contact_phone) {
    risks.push({ rule_id: "RISK_002", level: "red", field: "F01_origin_contact_name", message: "装货联系人/电话缺失", action: "block_until_fixed" });
    canPublish = false;
  }
  if (!cargo.F03_destination_contact_name || !cargo.F04_destination_contact_phone) {
    risks.push({ rule_id: "RISK_002B", level: "red", field: "F03_destination_contact_name", message: "卸货联系人/电话缺失", action: "block_until_fixed" });
    canPublish = false;
  }

  if ((cargo.B01_goods_category_l1 === "冻品" || cargo.B01_goods_category_l1 === "医药") && !cargo.B06_temperature_requirement) {
    risks.push({ rule_id: "RISK_003", level: "red", field: "B06_temperature_requirement", message: "冷链货物未填温度要求", action: "block_until_fixed" });
    canPublish = false;
  }

  const price = Number(cargo.E01_freight_price || 0);
  const p25 = DATA.market_data.route_market_price.price_p25;
  const p75 = DATA.market_data.route_market_price.price_p75;
  if (price && price < p25) risks.push({ rule_id: "RISK_004", level: "yellow", field: "E01_freight_price", message: `当前运费低于市场P25（¥${fmt(p25)}）`, action: "warn_only" });
  if (price && price > p75) risks.push({ rule_id: "INFO_HIGH_PRICE", level: "blue", field: "E01_freight_price", message: `当前运费高于市场P75（¥${fmt(p75)}），成交速度通常更快`, action: "info_only" });
  if (!price) {
    risks.push({ rule_id: "RISK_005", level: "red", field: "E01_freight_price", message: "运费未填写", action: "block_until_fixed" });
    canPublish = false;
  }

    if (!cargo.B03_goods_weight_ton) risks.push({ rule_id: "INFO_MISSING_WEIGHT", level: "yellow", field: "B03_goods_weight_ton", message: "货物重量未填，建议补充", action: "warn_only" });
  if (!cargo.C01_vehicle_type || !cargo.C02_vehicle_length) {
    risks.push({ rule_id: "RISK_006", level: "red", field: "C01_vehicle_type", message: "车型/车长缺失", action: "block_until_fixed" });
    canPublish = false;
  }

  const summary = `风险 ${risks.length} 项（阻断 ${risks.filter((x) => x.level === "red").length}）`;
  return { can_publish: canPublish, risks, summary };
}

function buildShipment(rawText) {
  return {
    id: createId("SHPMENT"),
    feishu_record_id: null,
    raw_text: rawText,
    stage_id: 1,
    local_status: "draft",
    blocked: false,
    confirm: { price: false, load_time: false },
    match: { max_distance_km: 200, show_all_pool: false, assign_search: "" },
    s5_confirmed: false,
    parsed_result: null,
    completed_result: null,
    matched_drivers: [],
    selected_driver_ids: new Set(),
    strategy: "push",
    risk_result: null,
    tracking: null,
    platform: { cargo_id: "", order_id: "", driver_id: "", status: "" },
    lifecycle_events: [],
    created_at: Date.now(),
    updated_at: Date.now()
  };
}

const state = {
  view: "list",
  home_module: "fast",
  shipments: [],
  selected_id: null,
  pastedImageDataUrl: null,
  prefs: null,
  feishu_connected: false,
  feishu_scope: ""
};

function setView(view) {
  state.view = view;
  $("#view-list").classList.toggle("hidden", view !== "list");
  $("#view-batch-s2").classList.toggle("hidden", view !== "batch-s2");
  $("#view-prefs").classList.toggle("hidden", view !== "prefs");
  $("#view-detail").classList.toggle("hidden", view !== "detail");
}

function setHomeModule(moduleName) {
  state.home_module = moduleName;
  const sec = $("#module-fast");
  if (sec) sec.classList.remove("hidden");
  renderShipmentTable();
}

function getSelected() {
  return state.shipments.find((x) => x.id === state.selected_id) || null;
}

function updateBatchHint() {
  const hint = $("#batchHint");
  if (!hint) return;
  const total = state.shipments.length;
  const inProgress = state.shipments.filter((x) => calcFlowStatus(x) === "in_progress").length;
  const sunk = state.shipments.filter((x) => calcFlowStatus(x) === "sunk").length;
  hint.textContent = `总计 ${total} 票｜处理中 ${inProgress}｜已沉淀飞书 ${sunk}`;
}

function isSameDayCN(ts) {
  const now = new Date();
  const dt = new Date(ts || Date.now());
  const ymd = (d) => d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  return ymd(now) === ymd(dt);
}

function calcFlowStatus(sh) {
  if (sh.stage_id >= 4 || sh.local_status === "sunk_feishu") return "sunk";
  return "in_progress";
}

function appendLifecycleEvent(sh, event) {
  sh.lifecycle_events = sh.lifecycle_events || [];
  const item = {
    lifecycle_id: createId("LIFECYCLE"),
    local_cargo_id: sh.id,
    platform_cargo_id: sh.platform?.cargo_id || "",
    event_type: event.event_type,
    event_time: event.event_time || Date.now(),
    order_id: event.order_id || sh.platform?.order_id || "",
    driver_id: event.driver_id || sh.platform?.driver_id || "",
    driver_name: event.driver_name || "",
    driver_mobile: event.driver_mobile || "",
    truck_plate: event.truck_plate || "",
    deal_price: event.deal_price || "",
    deal_type: event.deal_type || sh.strategy || "",
    cancel_reason: event.cancel_reason || "",
    gtv: event.gtv || "",
    raw_platform_response: event.raw_platform_response || null
  };
  sh.lifecycle_events.push(item);
}

function renderTableInto(tableEl, list, mode) {
  const t = tableEl;
  if (!t) return;
  t.innerHTML = "";
  const head = document.createElement("tr");
  head.innerHTML = "<th>货源</th><th>关键信息</th><th>阶段/状态</th><th>操作</th>";
  t.appendChild(head);

  list
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .forEach((sh) => {
      const route = (sh.completed_result?.cargo?.A02_origin_city || sh.parsed_result?.parsed?.A02_origin_city?.value || "").replace("市", "") + "→" + (sh.completed_result?.cargo?.A06_destination_city || sh.parsed_result?.parsed?.A06_destination_city?.value || "").replace("市", "");
      const goods = sh.completed_result?.cargo?.B01_goods_category_l1 ? `${sh.completed_result.cargo.B01_goods_category_l1}${sh.completed_result.cargo.B02_goods_category_l2 || ""}` : "";
      const v = sh.completed_result?.cargo?.C02_vehicle_length || sh.parsed_result?.parsed?.C02_vehicle_length?.value || "";
      const price = sh.completed_result?.cargo?.E01_freight_price || sh.parsed_result?.parsed?.E01_freight_price?.value;
      const flowLabel = stagePill(sh.stage_id, sh.blocked);
      let opHtml = `<button class="btn-ghost" data-act="open" data-id="${sh.id}">进入</button>`;
      if (mode === "manage") opHtml += `<button class="btn-secondary" data-act="next" data-id="${sh.id}">下一步</button>`;

      const op = document.createElement("tr");
      op.innerHTML = `
        <td class="mono">${safeText(sh.id.slice(-10))}</td>
        <td>
          <div>${safeText(route || "未识别路线")}</div>
          <div class="small muted">${safeText(goods)} ${safeText(v)} ${price ? `¥${fmt(price)}` : ""}</div>
        </td>
        <td>${flowLabel}</td>
        <td class="table-actions">${opHtml}</td>
      `;
      t.appendChild(op);
    });

  t.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const sh = state.shipments.find((x) => x.id === id);
    if (!sh) return;
    if (act === "open") openDetail(id);
    if (act === "next") await runNextStep(sh);
  };
}

function renderShipmentTable() {
  const manageList = state.shipments;
  renderTableInto($("#shipmentTable"), manageList, "manage");
  updateBatchHint();
}

async function runNextStep(sh) {
  if (sh.stage_id === 1) {
    if (!sh.parsed_result) sh.parsed_result = await parseSingleRaw(sh.raw_text);
    maybeAlertHeavyCargo(sh);
    sh.completed_result = completeCargoFromParsed(sh.parsed_result?.parsed || {});
    sh.stage_id = 2;
    sh.local_status = "pending_review";
  } else if (sh.stage_id === 2) {
    if (!(sh.confirm?.price === true && sh.confirm?.load_time === true)) {
      alert("请先确认运费和装货时间");
      openDetail(sh.id);
      return;
    }
    if (!sh.risk_result) {
      const cargo = sh.completed_result?.cargo || {};
      sh.risk_result = diagnoseRisks(cargo);
    }
    sh.blocked = !sh.risk_result.can_publish;
    if (!sh.risk_result.can_publish) {
      alert("有阻断风险，请先修复");
      openDetail(sh.id);
      return;
    }
    if (sh.s5_confirmed !== true) {
      alert("请先勾选确认信息无误");
      openDetail(sh.id);
      return;
    }
    const mapping = ensureDispatchMappings(sh);
    if (!mapping.ok) {
      alert(mapping.message || "字段映射校验失败");
      openDetail(sh.id);
      return;
    }
    const sink = await sinkShipmentsToFeishu([sh]);
    if (!sink.ok) {
      alert(sink.message || "沉淀飞书失败");
      openDetail(sh.id);
      return;
    }
    sh.local_status = "sunk_feishu";
    sh.stage_id = 3;
  } else if (sh.stage_id === 3) {
    openDetail(sh.id);
    return;
  }
  sh.updated_at = Date.now();
  renderShipmentTable();
}

function openDetail(id) {
  state.selected_id = id;
  setView("detail");
  renderDetail();
}

function renderStepper(sh) {
  const box = $("#stepper");
  box.innerHTML = "";
  STAGES.forEach((s) => {
    const div = document.createElement("div");
    let cls = "step clickable";
    if (s.id < sh.stage_id) cls += " done";
    if (s.id === sh.stage_id) cls += " current";
    if (sh.blocked && s.id === sh.stage_id) cls += " blocked";
    div.className = cls;
    div.dataset.stage = s.id;
    div.innerHTML = `<div class="num">${s.id}</div><div class="name">${s.name}</div><div class="hint">${s.id < sh.stage_id ? "已完成" : s.id === sh.stage_id ? (sh.blocked ? "阻断" : "进行中") : "未开始"}</div>`;
    
    div.onclick = () => {
      const published = (sh.local_status === "on_shelf" || sh.local_status === "dealt" || sh.local_status === "in_transit" || sh.local_status === "completed" || sh.stage_id >= 4);
      if (!published || s.id >= 4) {
        sh.stage_id = s.id;
        sh.updated_at = Date.now();
        renderDetail();
        renderShipmentTable();
      }
    };
    box.appendChild(div);
  });
}

function showStagePanel(stageId) {
  const panelId = Number(stageId || 1);
  $$(".panel").forEach((p) => {
    const sid = Number(p.dataset.stage);
    const show = panelId === 2 ? (sid === 1 || sid === 2) : sid === panelId;
    p.classList.toggle("hidden", !show);
  });
}

function renderParsedTable(parsed) {
  const t = $("#parsedTable");
  t.innerHTML = "";
  const head = document.createElement("tr");
  head.innerHTML = "<th>字段</th><th>中文名</th><th>值</th><th>置信度</th>";
  t.appendChild(head);

  Object.entries(parsed || {}).forEach(([k, v]) => {
    const c = v.confidence;
    const pill = c >= 0.9 ? '<span class="pill green">高</span>' : c >= 0.6 ? '<span class="pill yellow">中</span>' : '<span class="pill red">低</span>';
    const tr = document.createElement("tr");
    const zh = window.FIELD_LABELS?.[k] || "";
    tr.innerHTML = `<td>${safeText(k)}</td><td>${safeText(zh)}</td><td>${safeText(v.value)}</td><td>${pill} ${c.toFixed(2)}</td>`;
    t.appendChild(tr);
  });
}

function renderDriverCards(sh) {
  const box = $("#driverCards");
  box.innerHTML = "";

  const renderOne = (d) => {
    const warn = d.empty_status_warning ? `<div class="small muted">${safeText(d.empty_status_warning)}</div>` : "";
    const typeBadge = d.familiar_level === "stranger" ? '<span class="pill yellow">生车</span>' : '<span class="pill blue">熟车</span>';
    const contactBadge = d.contact_available ? '<span class="pill green">可电话</span>' : '<span class="pill yellow">发货后可联系</span>';
    const checked = sh.selected_driver_ids.has(d.driver_id) ? "checked" : "";
    const canCall = d.contact_available && String(d.phone || "").trim();
    const callBtn = canCall ? `<a class="btn-ghost" href="tel:${safeText(String(d.phone).replace(/\s/g, ""))}">电话联系</a>` : `<span class="small muted">生车不显示电话，发货到平台后可联系</span>`;
    const extraBtn = sh.strategy === "push" && checked ? `<button class="confirm-btn" data-action="confirm" data-driver="${safeText(d.driver_id)}">确认接单</button>` : sh.strategy === "assign" && checked ? `<button class="confirm-btn" data-action="assign" data-driver="${safeText(d.driver_id)}">指派</button>` : "";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="muted">${typeBadge} ${safeText(d.familiar_level_label)} ${contactBadge}</div>
      <div><strong>${safeText(d.display_name)}</strong> · <span>${safeText(d.vehicle_info)}</span></div>
      <div class="muted">${safeText(d.distance_label)}</div>
      <div class="muted">${safeText(d.last_cooperation)}</div>
      <div>${safeText(d.empty_status_label)}</div>
      ${warn}
      <div class="score">综合评分 ${d.score}</div>
      <div class="actions" style="justify-content:space-between; gap:.5rem">
        <label><input type="checkbox" data-driver="${d.driver_id}" ${checked}> 选择</label>
        <div style="display:flex; gap:.5rem; align-items:center">${callBtn} ${extraBtn}</div>
      </div>
    `;
    return card;
  };

  sh.matched_drivers.forEach((d) => box.appendChild(renderOne(d)));

  box.onchange = (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-driver]');
    if (!cb) return;
    if (cb.checked) sh.selected_driver_ids.add(cb.dataset.driver);
    else sh.selected_driver_ids.delete(cb.dataset.driver);
    $("#selectedDrivers").textContent = Array.from(sh.selected_driver_ids).join(", ");
    sh.updated_at = Date.now();
  };

  box.onclick = (e) => {
    const btn = e.target.closest('button[data-action][data-driver]');
    if (!btn) return;
    const driverId = btn.dataset.driver;
    if (!sh.selected_driver_ids.has(driverId)) return;
    if (btn.dataset.action === "confirm") {
      sh.platform = sh.platform || {};
      sh.platform.order_id = sh.platform.order_id || `ORD-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      sh.platform.driver_id = driverId;
      sh.platform.status = "dealt";
      sh.local_status = "dealt";
      sh.updated_at = Date.now();
      renderShipmentTable();
      if (sh.stage_id >= 4) sinkShipmentsToFeishu([sh]);
      alert("已确认接单（模拟）：状态已回流飞书（如已沉淀）。");
    }
    if (btn.dataset.action === "assign") {
      sh.platform = sh.platform || {};
      sh.platform.order_id = sh.platform.order_id || `ORD-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      sh.platform.driver_id = driverId;
      sh.platform.status = "assign_sent";
      sh.local_status = "on_shelf";
      sh.updated_at = Date.now();
      renderShipmentTable();
      if (sh.stage_id >= 4) sinkShipmentsToFeishu([sh]);
      alert("已指派（模拟）：已生成订单号并回流飞书（如已沉淀）。");
    }
  };
}

function renderRiskList(risk) {
  $("#riskSummary").textContent = risk?.summary || "";
  const box = $("#riskList");
  box.innerHTML = "";
  (risk?.risks || []).forEach((r) => {
    const div = document.createElement("div");
    div.className = r.level === "red" ? "risk-red" : r.level === "yellow" ? "risk-yellow" : "risk-blue";
    div.textContent = `${r.level.toUpperCase()} ${r.field}：${r.message}`;
    box.appendChild(div);
  });
}

function toDatetimeLocal(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.includes("T")) return v.slice(0, 16);
  const m = v.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  return "";
}

function fromDatetimeLocal(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return v;
  return `${m[1]} ${m[2]}`;
}

function renderS3TopBar(sh) {
  const cargo = sh.completed_result?.cargo || {};
  const origin = (cargo.A02_origin_city || "").replace("市", "");
  const dest = (cargo.A06_destination_city || "").replace("市", "");
  const route = origin && dest ? `${origin}→${dest}` : "路线待确认";
  const goods = cargo.B01_goods_category_l1 ? `${cargo.B01_goods_category_l1}${cargo.B02_goods_category_l2 || ""}` : "货类待确认";
  const vehicle = `${cargo.C01_vehicle_type || "车型待确认"} ${cargo.C02_vehicle_length || "车长待确认"}`.trim();
  const weight = cargo.B03_goods_weight_ton ? `${cargo.B03_goods_weight_ton}吨` : "吨位待确认";
  const volume = cargo.B04_goods_volume_m3 ? `${cargo.B04_goods_volume_m3}方` : "方量可选";
  const price = cargo.E01_freight_price ? `¥${fmt(cargo.E01_freight_price)}` : "价格待确认";
  const time = cargo.D01_load_time_start ? cargo.D01_load_time_start : "装货时间待确认";
  const chips = [
    { k: "线路", v: route },
    { k: "货类", v: goods },
    { k: "车型/车长", v: vehicle },
    { k: "吨/方", v: `${weight} / ${volume}` },
    { k: "运费", v: price },
    { k: "装货", v: time }
  ];
  $("#s3TopBar").innerHTML = chips.map((x) => `<span class="chip"><span class="muted">${safeText(x.k)}：</span>${safeText(x.v)}</span>`).join("");
}

const GEO = {
  "广东省": {"广州市": ["天河区", "白云区", "黄埔区"], "深圳市": ["南山区", "福田区", "宝安区"]},
  "四川省": {"成都市": ["武侯区", "双流区", "高新区"], "绵阳市": ["涪城区", "游仙区"]},
  "浙江省": {"杭州市": ["余杭区", "西湖区", "萧山区"]}
};
const GOODS = {
  "普货": ["普货", "设备", "建材", "日用品"],
  "生鲜": ["冻肉", "冻品", "鲜活水产", "海鲜"],
  "农产品": ["蔬菜", "水果", "谷物", "绿通"]
};
const MODELS = ["平板", "高栏", "厢式", "冷藏", "保温"];
const LENGTHS = ["4.2米", "6.8米", "9.6米", "13米", "13.7米", "15米", "17.5米"];

const POIS = [
  { id: "poi_cd_qy_ghd_1", province: "四川省", city: "成都市", district: "青羊区", level: 5, title: "青羊区光华大道-仓库A", sub: "四川省成都市青羊区光华大道三段88号1栋（可进17.5米）" },
  { id: "poi_cd_wuh_1", province: "四川省", city: "成都市", district: "武侯区", level: 5, title: "武侯区天府三街-冷库", sub: "四川省成都市武侯区天府三街199号B区（需提前30分钟）" },
  { id: "poi_cd_sl_1", province: "四川省", city: "成都市", district: "双流区", level: 5, title: "双流机场路-物流园", sub: "四川省成都市双流区机场路三段6号XX物流园3号门" },
  { id: "poi_gz_by_1", province: "广东省", city: "广州市", district: "白云区", level: 4, title: "白云区石井-市场", sub: "广东省广州市白云区石井街道X路X号（卸货排队）" },
  { id: "poi_gz_th_1", province: "广东省", city: "广州市", district: "天河区", level: 3, title: "天河区-园区", sub: "广东省广州市天河区XXX园区" },
  { id: "poi_sz_ns_1", province: "广东省", city: "深圳市", district: "南山区", level: 4, title: "南山区科技园-门店", sub: "广东省深圳市南山区科技园科兴路88号" },
  { id: "poi_hz_xh_1", province: "浙江省", city: "杭州市", district: "西湖区", level: 4, title: "西湖区文三路-仓库", sub: "浙江省杭州市西湖区文三路XXX号" }
];

function renderStage3(sh) {
  const completed = sh.completed_result;
  if (!completed) return;
  const cargo = completed.cargo || {};
  
  const el = (id) => document.getElementById(id);
  if (!el('s2TopBar')) return;
  sh.ui = sh.ui || {};
  
  const market14 = DATA.market_data.route_market_price;
  $("#completeSummary").textContent = `已补全 ${completed.completed_fields?.length || 0} 个字段；参考价 P25 ¥${fmt(market14.price_p25)} / P50 ¥${fmt(market14.price_p50)}`;

  renderS3TopBar(sh);

  const popOpts = (sel, arr, val) => {
    if(!sel) return;
    sel.innerHTML = '<option value="">请选择</option>' + arr.map(a => `<option value="${a}" ${a===val?'selected':''}>${a}</option>`).join('');
  };
  
  const popGeo = (pEl, cEl, dEl, pVal, cVal, dVal, onChange) => {
    if(!pEl) return;
    popOpts(pEl, Object.keys(GEO), pVal);
    const updateC = () => {
      const pv = pEl.value;
      popOpts(cEl, pv ? Object.keys(GEO[pv]||{}) : [], pv === pVal ? cVal : '');
      updateD();
      if (onChange) onChange();
    };
    const updateD = () => {
      const pv = pEl.value;
      const cv = cEl.value;
      popOpts(dEl, (pv && cv) ? (GEO[pv][cv]||[]) : [], (pv===pVal && cv===cVal) ? dVal : '');
      if (onChange) onChange();
    };
    pEl.onchange = updateC;
    cEl.onchange = updateD;
    updateC();
  };
  
  const clearPoi = (poiInput, suggestBox) => {
    if (!poiInput) return;
    poiInput.dataset.poiId = "";
    poiInput.dataset.poiLevel = "";
    poiInput.dataset.poiTitle = "";
    poiInput.dataset.poiSub = "";
    if (suggestBox) suggestBox.classList.add("hidden");
  };
  const origPoiInput = el('f_orig_poi');
  const destPoiInput = el('f_dest_poi');
  const origSuggest = el('f_orig_poi_suggest');
  const destSuggest = el('f_dest_poi_suggest');

  popGeo(el('f_orig_prov'), el('f_orig_city'), el('f_orig_dist'), cargo.A01_origin_province, cargo.A02_origin_city, cargo.A03_origin_district, () => clearPoi(origPoiInput, origSuggest));
  popGeo(el('f_dest_prov'), el('f_dest_city'), el('f_dest_dist'), cargo.A05_destination_province, cargo.A06_destination_city, cargo.A07_destination_district, () => clearPoi(destPoiInput, destSuggest));

  const fillPoiInput = (poiInput, poi) => {
    if (!poiInput || !poi) return;
    poiInput.value = `${poi.title} ${poi.sub}`;
    poiInput.dataset.poiId = poi.id;
    poiInput.dataset.poiLevel = String(poi.level || "");
    poiInput.dataset.poiTitle = poi.title || "";
    poiInput.dataset.poiSub = poi.sub || "";
  };

  if (cargo.A04_origin_address_detail) origPoiInput.value = cargo.A04_origin_address_detail;
  if (cargo.A08_destination_address_detail) destPoiInput.value = cargo.A08_destination_address_detail;

  const histLoad = (k) => {
    try { return JSON.parse(localStorage.getItem(k) || "[]") || []; } catch (e) { return []; }
  };
  const histSave = (k, list) => {
    try { localStorage.setItem(k, JSON.stringify(list || [])); } catch (e) {}
  };
  const histUpsert = (k, poi) => {
    const list = histLoad(k).filter((x) => x && x.id !== poi.id);
    list.unshift(poi);
    histSave(k, list.slice(0, 8));
  };
  const renderHistSelect = (sel, list) => {
    if (!sel) return;
    sel.innerHTML = `<option value="">${sel.id === "f_orig_history" ? "历史装货地" : "历史卸货地"}</option>` + list.map((x) => `<option value="${safeText(x.id)}">${safeText(x.title)}</option>`).join("");
  };

  const bindPoiSearch = (side) => {
    const isOrig = side === "orig";
    const provEl = el(isOrig ? "f_orig_prov" : "f_dest_prov");
    const cityEl = el(isOrig ? "f_orig_city" : "f_dest_city");
    const distEl = el(isOrig ? "f_orig_dist" : "f_dest_dist");
    const poiInput = el(isOrig ? "f_orig_poi" : "f_dest_poi");
    const suggest = el(isOrig ? "f_orig_poi_suggest" : "f_dest_poi_suggest");
    const histSel = el(isOrig ? "f_orig_history" : "f_dest_history");
    const histKey = isOrig ? "hist_origin_poi" : "hist_dest_poi";

    const refreshHist = () => renderHistSelect(histSel, histLoad(histKey));
    refreshHist();

    if (histSel) {
      histSel.onchange = () => {
        const id = histSel.value;
        if (!id) return;
        const list = histLoad(histKey);
        const poi = list.find((x) => x.id === id);
        if (!poi) return;
        provEl.value = poi.province;
        provEl.onchange && provEl.onchange();
        cityEl.value = poi.city;
        cityEl.onchange && cityEl.onchange();
        distEl.value = poi.district;
        distEl.onchange && distEl.onchange();
        fillPoiInput(poiInput, poi);
      };
    }

    let lastItems = [];
    const renderSuggest = (items) => {
      if (!suggest) return;
      lastItems = items;
      if (!items.length) {
        suggest.classList.add("hidden");
        suggest.innerHTML = "";
        return;
      }
      suggest.innerHTML = items.map((x) => {
        return `<div class="poi-item" data-poi="${safeText(x.id)}"><div class="t">${safeText(x.title)}</div><div class="s">${safeText(x.sub)}</div></div>`;
      }).join("");
      suggest.classList.remove("hidden");
    };

    const findCandidates = () => {
      const kw = String(poiInput.value || "").trim();
      const pv = String(provEl.value || "").trim();
      const cv = String(cityEl.value || "").trim();
      const dv = String(distEl.value || "").trim();
      if (!pv || !cv || !dv || kw.length < 2) return [];
      const list = POIS.filter((x) => x.province === pv && x.city === cv && x.district === dv && (`${x.title} ${x.sub}`).includes(kw)).slice(0, 8);
      if (list.length) return list;
      const minLv = isOrig ? 5 : 3;
      return [
        { id: `mock_${side}_1_${pv}_${cv}_${dv}_${kw}`, province: pv, city: cv, district: dv, level: minLv, title: `${dv}${kw}-门店`, sub: `${pv}${cv}${dv}${kw}路88号` },
        { id: `mock_${side}_2_${pv}_${cv}_${dv}_${kw}`, province: pv, city: cv, district: dv, level: minLv, title: `${dv}${kw}-仓库`, sub: `${pv}${cv}${dv}${kw}大道199号` },
        { id: `mock_${side}_3_${pv}_${cv}_${dv}_${kw}`, province: pv, city: cv, district: dv, level: minLv, title: `${dv}${kw}-物流园`, sub: `${pv}${cv}${dv}${kw}物流园3号门` }
      ];
    };

    if (poiInput) {
      poiInput.oninput = () => {
        clearPoi(poiInput, suggest);
        renderSuggest(findCandidates());
      };
      poiInput.onfocus = () => {
        if (!poiInput.dataset.poiId) renderSuggest(findCandidates());
      };
      poiInput.onblur = () => setTimeout(() => suggest && suggest.classList.add("hidden"), 150);
    }

    if (suggest) {
      suggest.onclick = (e) => {
        const it = e.target.closest(".poi-item");
        if (!it) return;
        const id = it.dataset.poi;
        const poi = lastItems.find((x) => x.id === id);
        if (!poi) return;
        fillPoiInput(poiInput, poi);
        histUpsert(histKey, poi);
        refreshHist();
        suggest.classList.add("hidden");
      };
    }
  };

  bindPoiSearch("orig");
  bindPoiSearch("dest");
  
  popOpts(el('f_goods_l1'), Object.keys(GOODS), cargo.B01_goods_category_l1);
  const updateL2 = () => {
    const l1 = el('f_goods_l1').value;
    popOpts(el('f_goods_l2'), l1 ? GOODS[l1] : [], l1 === cargo.B01_goods_category_l1 ? cargo.B02_goods_category_l2 : '');
  };
  el('f_goods_l1').onchange = updateL2;
  updateL2();
  
  el('f_weight').value = cargo.B03_goods_weight_ton || '';
  el('f_volume').value = cargo.B04_goods_volume_m3 || '';
  if (sh.ui.volume_manual !== true) sh.ui.volume_manual = false;
  if (sh.ui.volume_autofilled !== true) sh.ui.volume_autofilled = false;
  el('f_volume').oninput = () => {
    const v = String(el('f_volume').value || "").trim();
    if (!v) {
      sh.ui.volume_manual = false;
      sh.ui.volume_autofilled = false;
      return;
    }
    sh.ui.volume_manual = true;
    sh.ui.volume_autofilled = false;
  };
  el('f_weight').oninput = () => {
    const w = parseFloat(el('f_weight').value);
    if (isNaN(w)) return;
    if (sh.ui.volume_manual === true) return;
    const cur = String(el('f_volume').value || "").trim();
    if (!cur || sh.ui.volume_autofilled === true) {
      el('f_volume').value = (w / 3).toFixed(1);
      sh.ui.volume_autofilled = true;
    }
  };
  
  el('f_temp').value = cargo.B06_temperature_requirement || '';
  el('f_pack').value = cargo.B07_package_method || '';
  
  el('f_use_type').value = cargo.C05_use_type || '整车';
  const renderMulti = (container, arr, selectedStr) => {
    const selArr = (selectedStr||'').split(',').map(x=>x.trim());
    container.innerHTML = arr.map(a => `<label><input type="checkbox" value="${a}" ${selArr.includes(a)?'checked':''}> ${a}</label>`).join('');
  };
  renderMulti(el('f_models'), MODELS, cargo.C01_vehicle_type);
  renderMulti(el('f_lengths'), LENGTHS, cargo.C02_vehicle_length);
  
  const lt = cargo.D01_load_time_start || ''; 
  const dMatch = lt.match(/^(\d{4}-\d{2}-\d{2})/);
  el('f_load_date').value = dMatch ? dMatch[1] : new Date().toISOString().slice(0,10);
  const sMatch = lt.match(/(全天|上午|下午|晚上)/);
  if(sMatch) {
     Array.from(el('f_load_time_slot').options).forEach(o => {
       if(o.value.includes(sMatch[1])) o.selected = true;
     });
  }
  el('f_price').value = cargo.E01_freight_price || '';
  
  const payStr = cargo.E03_payment_method || ''; 
  el('f_pay_type').value = payStr.includes('回单') ? '回单后' : '卸货后';
  const dayMatch = payStr.match(/(\d+)天/);
  el('f_pay_days').value = dayMatch ? dayMatch[1] : '';
  
  el('f_orig_name').value = cargo.F01_origin_contact_name || '';
  el('f_orig_phone').value = cargo.F02_origin_contact_phone || '';
  el('f_dest_name').value = cargo.F03_destination_contact_name || '';
  el('f_dest_phone').value = cargo.F04_destination_contact_phone || '';
  
  el('f_remark').value = cargo.G01_special_requirements || '';
  
  const mr7 = DATA.market_data.route_market_price_7d;
  $("#price7d").innerHTML = `近7天：P25 ¥${fmt(mr7.price_p25)} / P50 ¥${fmt(mr7.price_p50)}（${safeText(mr7.trend)}）`;

  renderRiskList(sh.risk_result);

  el('btnSinkFeishu').onclick = () => {
     const c = sh.completed_result.cargo;
     c.A01_origin_province = el('f_orig_prov').value;
     c.A02_origin_city = el('f_orig_city').value;
     c.A03_origin_district = el('f_orig_dist').value;
     c.A04_origin_address_detail = el('f_orig_poi').value;
     c.A05_destination_province = el('f_dest_prov').value;
     c.A06_destination_city = el('f_dest_city').value;
     c.A07_destination_district = el('f_dest_dist').value;
     c.A08_destination_address_detail = el('f_dest_poi').value;
     
     c.B01_goods_category_l1 = el('f_goods_l1').value;
     c.B02_goods_category_l2 = el('f_goods_l2').value;
     c.B03_goods_weight_ton = parseFloat(el('f_weight').value);
     c.B04_goods_volume_m3 = parseFloat(el('f_volume').value);
     c.B06_temperature_requirement = el('f_temp').value;
     c.B07_package_method = el('f_pack').value;
     
     c.C05_use_type = el('f_use_type').value;
     c.C01_vehicle_type = Array.from(el('f_models').querySelectorAll('input:checked')).map(x=>x.value).join(',');
     c.C02_vehicle_length = Array.from(el('f_lengths').querySelectorAll('input:checked')).map(x=>x.value).join(',');
     
     c.D01_load_time_start = el('f_load_date').value + ' ' + el('f_load_time_slot').value;
     c.E01_freight_price = parseFloat(el('f_price').value);
     c.E03_payment_method = el('f_pay_type').value + (el('f_pay_days').value ? el('f_pay_days').value + '天' : '');
     
     c.F01_origin_contact_name = el('f_orig_name').value;
     c.F02_origin_contact_phone = el('f_orig_phone').value;
     c.F03_destination_contact_name = el('f_dest_name').value;
     c.F04_destination_contact_phone = el('f_dest_phone').value;
     
     c.G01_special_requirements = el('f_remark').value;
     
     const errors = [];
     const req = (ok, msg) => { if (!ok) errors.push(msg); };
     const oPoiLevel = Number(el('f_orig_poi').dataset.poiLevel || 0);
     const dPoiLevel = Number(el('f_dest_poi').dataset.poiLevel || 0);
     req(Boolean(c.A01_origin_province && c.A02_origin_city && c.A03_origin_district), "装货地省市区必填");
     req(Boolean(el('f_orig_poi').dataset.poiId), "装货详细地址必须从搜索结果中选择（POI）");
     req(oPoiLevel >= 5, "装货地必须到五级地址（请选更精确的POI）");
     req(Boolean(c.A05_destination_province && c.A06_destination_city && c.A07_destination_district), "卸货地省市区必填");
     req(Boolean(el('f_dest_poi').dataset.poiId), "卸货详细地址必须从搜索结果中选择（POI）");
     req(dPoiLevel >= 3, "卸货地至少到三级地址（请选POI）");
     req(Boolean(c.B01_goods_category_l1), "一级品类必填");
     req(Boolean(c.B02_goods_category_l2), "二级品类必填");
     req(Number.isFinite(c.B03_goods_weight_ton) && c.B03_goods_weight_ton > 0, "重量必填");
     req(Boolean(c.B06_temperature_requirement), "温度要求必填");
     req(Boolean(c.B07_package_method), "包装方式必填");
     req(Boolean(c.C05_use_type), "用车类型必填");
     req(Boolean(c.C01_vehicle_type), "车型必填（至少选1个）");
     req(Boolean(c.C02_vehicle_length), "车长必填（至少选1个）");
     req(Boolean(el('f_load_date').value) && Boolean(el('f_load_time_slot').value), "装货时间必填");
     req(Number.isFinite(c.E01_freight_price) && c.E01_freight_price > 0, "运费必填");
     const payDays = Number(el('f_pay_days').value);
     req(Boolean(el('f_pay_type').value), "付款周期必填");
     req(Number.isFinite(payDays) && payDays >= 0, "付款周期天数必填");

     if (errors.length) {
       alert(errors.join("\n"));
       return;
     }

     sh.risk_result = diagnoseRisks(c);
     sh.blocked = !sh.risk_result.can_publish;
     renderRiskList(sh.risk_result);
     if (!sh.risk_result.can_publish) {
       alert("诊断发现阻断项，请先补齐/修正后再沉淀飞书");
       return;
     }

     sh.updated_at = Date.now();

     sinkShipmentsToFeishu([sh]).then((rs) => {
       sh.local_status = "sunk_feishu";
       sh.stage_id = 3;
       sh.updated_at = Date.now();
       renderDetail(sh);
       renderShipmentTable();
     }).catch(err => {
       console.error(err);
       alert("沉淀飞书失败（网络/权限原因）。已本地保存，将继续进入找车环节。");
       sh.stage_id = 3;
       sh.updated_at = Date.now();
       renderDetail(sh);
       renderShipmentTable();
     });
  };
}

function driverCandidatesForMatch(cargo, maxDistanceKm, strategy) {
  const parseList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const normType = (t) => {
    const v = String(t || "").trim();
    if (!v) return "";
    if (v.endsWith("车")) return v;
    if (v === "冷藏") return "冷藏车";
    if (v === "保温") return "保温车";
    return v;
  };
  const needTypes = parseList(cargo.C01_vehicle_type).map(normType).filter(Boolean);
  const needLens = parseList(cargo.C02_vehicle_length);
  const typeHit = (dType) => {
    const dt = String(dType || "").trim();
    if (!needTypes.length) return true;
    return needTypes.some((x) => dt === x || dt.includes(x) || x.includes(dt));
  };
  const lenHit = (dLen) => {
    const dl = String(dLen || "").trim();
    if (!needLens.length) return true;
    return needLens.some((x) => dl === x || dl.includes(x) || x.includes(dl));
  };
  const base = DATA.driver_pool
    .filter((d) => typeHit(d.vehicle_type))
    .filter((d) => lenHit(d.vehicle_length))
    .filter((d) => (cargo.C03_vehicle_width_wide ? d.vehicle_width_wide : true))
    .filter((d) => (cargo.C04_cold_machine_required ? d.cold_machine !== false : true))
    .filter((d) => (d.distance_to_origin_km ?? 9999) <= maxDistanceKm);

  const levelScore = (l) => (l === "diamond" ? 40 : l === "gold" ? 30 : l === "normal" ? 20 : 10);
  const emptyScore = (status, src) => {
    if (status !== "空车") return 0;
    if (src === "司机主动上报") return 30;
    if (src === "平台推算") return 15;
    return 0;
  };
  const distScore = (km) => (km <= 20 ? 20 : km <= 50 ? 15 : km <= 100 ? 10 : 5);
  const routeScore = (d) => {
    const exp = d.platform_stats?.route_experience_chengdu_guangzhou ?? 0;
    if (exp >= 10) return 10;
    if (exp >= 3) return 5;
    if (exp >= 1) return 2;
    return 0;
  };

  const list = base
    .map((d) => {
      const km = d.distance_to_origin_km ?? 999;
      const score = levelScore(d.familiar_level) + emptyScore(d.empty_status, d.empty_status_source) + distScore(km) + routeScore(d);

      const warnings = [];
      if (d.empty_status_source === "未知") warnings.push("状态未知，建议电话确认");
      if ((d.current_location?.location_age_minutes ?? 0) > 180) warnings.push("定位已超3小时，位置可能已变化");
      if (d.empty_status_source === "平台推算") warnings.push("基于平台订单推算，线下接单情况未知");

      const lastCoop = d.cooperation_with_shipper?.last_order_date
        ? `${Math.max(1, Math.round((new Date("2026-03-27") - new Date(d.cooperation_with_shipper.last_order_date)) / 86400000))}天前合作 · ${d.cooperation_with_shipper.last_order_route || "成都→广州"} · ✅无客诉`
        : "暂无与该货主合作记录";

      const contactAvailable = d.familiar_level !== "stranger";

      return {
        driver_id: d.driver_id,
        display_name: d.name,
        phone: contactAvailable ? String(d.phone || "") : "",
        familiar_level: d.familiar_level,
        familiar_level_label: d.familiar_level_label,
        vehicle_info: `${d.vehicle_length} ${d.vehicle_type} · ${d.cold_machine ? "有独立冷机" : "无冷机"}`,
        distance_label: `距装货地${km}km`,
        distance_km: km,
        last_cooperation: lastCoop,
        empty_status_label: `${d.empty_status}${d.empty_status_source === "司机主动上报" ? "（主动上报）" : d.empty_status_source === "平台推算" ? "（平台推算）" : ""}`,
        empty_status_warning: warnings.length ? warnings.join("；") : null,
        score,
        recommend_action: contactAvailable ? "立刻联系" : "发货后可见",
        contact_available: contactAvailable,
        risk_notes: []
      };
    })
    .sort((a, b) => b.score - a.score);

  if (strategy === "push") {
    return list
      .filter((x) => x.familiar_level !== "stranger")
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 200);
  }

  if (strategy === "open" || strategy === "assign") {
    return list
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 6);
  }

  return list.slice(0, 6);
}

function renderStrategySection(sh) {
  const box = $("#strategySection");
  const active = sh.strategy;
  const card = (key, title, sub, hint) => {
    const cls = `strategy-card ${active === key ? "active" : ""}`;
    return `<div class="${cls}" data-strategy="${safeText(key)}"><div class="title">${safeText(title)}</div><div class="sub">${safeText(sub)}</div><div class="hint">${safeText(hint)}</div></div>`;
  };
  box.innerHTML = `
    <div class="strategy-section">
      <div class="strategy-cards">
        ${card("open", "一键发货到运满满", "发布到平台并自动补全", "适合最快成交")}
        ${card("assign", "发货并指派", "发布同时指定司机", "需要司机确认")}
        ${card("push", "附近熟车", "仅展示运力池车辆", "按距离排序")}
      </div>
      <div class="panel-mini ${active === "assign" ? "" : "hidden"}" id="assignBox">
        <label>手机号搜索运力</label>
        <input id="assignSearch" placeholder="输入手机号或姓名关键字">
        <div id="assignResults" class="small"></div>
      </div>
      <div class="panel-mini ${active === "open" ? "" : "hidden"}" id="openActionBox">
        <div class="small muted">发货到平台后可查看全部附近车辆</div>
        <div class="actions" style="margin-top:.5rem">
          <button id="btnOpenPublishNow" class="confirm-btn">立即发货（自动补全信息）</button>
        </div>
      </div>
    </div>
  `;

  const cards = box.querySelectorAll(".strategy-card");
  cards.forEach((c) => {
    c.onclick = () => {
      sh.strategy = c.dataset.strategy;
      sh.updated_at = Date.now();
      renderStage4(sh);
      renderShipmentTable();
    };
  });

  const publishBtn = $("#btnOpenPublishNow");
  if (publishBtn) {
    publishBtn.onclick = () => {
      sh.platform = sh.platform || {};
      if (!sh.platform.order_id) sh.platform.order_id = `ORD-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      sh.platform.status = "on_shelf";
      sh.local_status = "on_shelf";
      sh.updated_at = Date.now();
      renderShipmentTable();
      if (sh.stage_id >= 4) sinkShipmentsToFeishu([sh]);
      alert("已模拟发货到平台：已生成订单号，并将尝试回流到飞书（如已沉淀）。");
    };
  }

  const searchEl = $("#assignSearch");
  if (searchEl) {
    searchEl.value = sh.match.assign_search || "";
    const renderResults = () => {
      const q = searchEl.value.trim();
      sh.match.assign_search = q;
      const res = $("#assignResults");
      if (!q) {
        res.innerHTML = `<span class="muted">输入手机号或姓名进行搜索</span>`;
        return;
      }
      const list = DATA.driver_pool.filter((d) => String(d.phone || "").includes(q) || String(d.name || "").includes(q));
      res.innerHTML = list
        .slice(0, 6)
        .map((d) => `<div><button class="btn-ghost" data-pick="${safeText(d.driver_id)}">选择</button> ${safeText(d.name)} <span class="muted mono">${safeText(d.phone)}</span></div>`)
        .join("");
      res.querySelectorAll("[data-pick]").forEach((b) => {
        b.onclick = () => {
          sh.selected_driver_ids = new Set([b.dataset.pick]);
          $("#selectedDrivers").textContent = Array.from(sh.selected_driver_ids).join(", ");
          sh.updated_at = Date.now();
          renderShipmentTable();
        };
      });
    };
    searchEl.oninput = renderResults;
    renderResults();
  }
}

function renderStage4(sh) {
  const cargo = sh.completed_result?.cargo || {};

  renderStrategySection(sh);

  const distSel = $("#distanceSelect");
  distSel.value = String(sh.match.max_distance_km || 200);
  distSel.onchange = () => {
    sh.match.max_distance_km = Number(distSel.value);
    sh.matched_drivers = driverCandidatesForMatch(cargo, sh.match.max_distance_km, sh.strategy);
    sh.updated_at = Date.now();
    renderStage4(sh);
    renderShipmentTable();
  };

  const toggle = $("#showAllToggle");
  if (toggle) toggle.closest("label")?.classList.add("hidden");

  sh.matched_drivers = driverCandidatesForMatch(cargo, sh.match.max_distance_km || 200, sh.strategy);
  const note = sh.strategy === "push" ? "（仅运力池，不限数量）" : "（展示 6 位，发货到平台后可查看全部附近车辆）";
  $("#matchSummary").textContent = `${sh.match.max_distance_km || 200}km 范围内 ${sh.matched_drivers.length} 位司机 ${note}`;
  $("#selectedDrivers").textContent = Array.from(sh.selected_driver_ids).join(", ");
  renderDriverCards(sh);
}

function renderSinkSummary(sh) {
  const cargo = sh.completed_result?.cargo || {};
  const origin = (cargo.A02_origin_city || "").replace("市", "");
  const dest = (cargo.A06_destination_city || "").replace("市", "");
  const route = origin && dest ? `${origin}→${dest}` : "未识别路线";
  const goods = cargo.B01_goods_category_l1 ? `${cargo.B01_goods_category_l1}${cargo.B02_goods_category_l2 || ""}` : "未识别货类";
  const price = cargo.E01_freight_price ? `¥${fmt(cargo.E01_freight_price)}` : "未填";
  const record = sh.feishu_record_id || "未回写";
  const updated = new Date(sh.updated_at || Date.now()).toLocaleString("zh-CN", { hour12: false });
  const draftKeys = Object.keys(sh.platform_draft || {});
  $("#sinkSummary").innerHTML = `
    <div><strong>${safeText(route)}</strong> · ${safeText(goods)} · ${safeText(price)}</div>
    <div class="small muted">记录ID：<span class="mono">${safeText(record)}</span></div>
    <div class="small muted">时间：${safeText(updated)}</div>
    <div class="small muted">字段：${safeText(draftKeys.join(", ") || "未生成")}</div>
  `;
}

function renderDetail() {
  const sh = getSelected();
  if (!sh) return;

  const title = `货源详情 ${sh.id.slice(-10)}`;
  $("#detailTitle").textContent = title;
  const flow = calcFlowStatus(sh);
  const flowText = flow === "sunk" ? "已沉淀飞书" : "处理中";
  $("#detailSub").textContent = `${stageLabel(sh.stage_id)} · ${flowText}${sh.blocked ? "（阻断）" : ""}`;

  $("#detailRaw").value = sh.raw_text;

  renderStepper(sh);
  showStagePanel(sh.stage_id);

  if (sh.stage_id >= 1) {
    const parseSummary = sh.parsed_result?.summary || "";
    $("#parseSummary").textContent = parseSummary || "暂无解析结果";
    renderParsedTable(sh.parsed_result?.parsed || {});
    const ul = $("#unrecognizedList");
    ul.innerHTML = "";
    (sh.parsed_result?.unrecognized || []).forEach((f) => {
      const li = document.createElement("li");
      li.className = "clickable-field";
      const zh = window.FIELD_LABELS?.[f] || f;
      li.innerHTML = `${safeText(zh)} <span class="small muted mono">(${safeText(f)})</span>`;
      li.onclick = () => {
        // 自动流转到 S3 智能补全，并聚焦该字段
        sh.stage_id = 2;
        if (!sh.completed_result) {
          sh.completed_result = completeCargoFromParsed(sh.parsed_result.parsed);
        }
        sh.updated_at = Date.now();
        renderDetail();
        renderShipmentTable();
        
        // 延迟聚焦，等待 DOM 渲染
        setTimeout(() => {
          const input = document.querySelector(`[data-field="${f}"]`);
          if (input) {
            input.focus();
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            input.classList.add("highlight-flash");
            setTimeout(() => input.classList.remove("highlight-flash"), 2000);
          }
        }, 100);
      };
      ul.appendChild(li);
    });
  }

  if (sh.stage_id >= 2) {
    renderStage3(sh);
  }

  if (sh.stage_id >= 3) renderStage4(sh);
  if (sh.stage_id >= 4) renderSinkSummary(sh);
}

function bindTabs() {}
function initChannels() {}

function addShipmentsFromRawList(rawList) {
  const added = [];
  const existing = new Set(state.shipments.map((x) => (x.raw_text || "").trim()));
  rawList.forEach((raw) => {
    const text = String(raw || "").trim();
    if (!text) return;
    if (existing.has(text)) return;
    existing.add(text);
    const sh = buildShipment(text);
    state.shipments.push(sh);
    added.push(sh);
  });
  renderShipmentTable();
  return added;
}

async function handleCreateFromPaste() {
  const list = splitBulkText($("#unifiedInput").value);
  if (!list.length) return;
  const added = addShipmentsFromRawList(list);
  
  const btn = $("#btnCreateFromPaste");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "解析中...";
  }

  // 自动开始解析所有新增的货源（仅进入智能解析，不自动补全）
  for (const sh of added) {
    if (sh.stage_id === 1) {
      sh.parsed_result = await parseSingleRaw(sh.raw_text);
      maybeAlertHeavyCargo(sh);
      // 解析结果检查：如果没有解析出关键字段（如路线），标记为阻断
      if (!sh.parsed_result.parsed.A02_origin_city || !sh.parsed_result.parsed.A06_destination_city) {
        sh.blocked = true;
      } else {
        sh.stage_id = 1;
      }
    }
  }
  
  if (btn) {
    btn.disabled = false;
    btn.textContent = "自动解析";
  }

  setView("batch-s2");
  renderS2BatchList(added);
}

function renderS2BatchList(list) {
  const box = $("#s2BatchList");
  box.innerHTML = "";
  
  list.forEach(sh => {
    const card = document.createElement("div");
    card.className = "batch-card";
    card.dataset.id = sh.id;
    
    const route = (sh.parsed_result?.parsed?.A02_origin_city?.value || "").replace("市", "") + "→" + (sh.parsed_result?.parsed?.A06_destination_city?.value || "").replace("市", "");
    const goods = sh.parsed_result?.parsed?.B01_goods_category_l1?.value || "";
    const vehicle = sh.parsed_result?.parsed?.C02_vehicle_length?.value || "";
    
    let statusHtml = "";
    if (sh.blocked) {
      statusHtml = `<span class="pill red">解析失败</span>`;
    } else {
      statusHtml = `<span class="pill green">解析成功</span> <span class="small muted">已生成本地货源</span>`;
    }
    
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${route || "未识别路线"} ${goods} ${vehicle}</div>
        <div class="card-status">${statusHtml}</div>
      </div>
      <div class="card-body">
        <div class="small mono">${safeText(sh.raw_text)}</div>
      </div>
      <div class="card-actions">
        ${sh.blocked ? `<button class="btn-primary btn-sm" data-id="${sh.id}" data-act="retry">重新编辑并解析</button>` : ""}
        <button class="btn-ghost btn-sm" data-id="${sh.id}" data-act="detail">查看详情</button>
        <button class="btn-danger btn-sm" data-id="${sh.id}" data-act="delete">删除</button>
      </div>
    `;
    box.appendChild(card);
  });
  
  box.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) {
      const c = e.target.closest(".batch-card");
      if (!c) return;
      openDetail(c.dataset.id);
      return;
    }
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const sh = state.shipments.find(x => x.id === id);
    if (!sh) return;
    
    if (act === "retry") {
      const newText = prompt("编辑原始文本并重新解析：", sh.raw_text);
      if (newText !== null) {
        btn.disabled = true;
        btn.textContent = "解析中...";
        sh.raw_text = newText;
        sh.parsed_result = await parseSingleRaw(sh.raw_text);
        if (!sh.parsed_result.parsed.A02_origin_city || !sh.parsed_result.parsed.A06_destination_city) {
          sh.blocked = true;
        } else {
          sh.blocked = false;
          sh.stage_id = 1;
        }
        sh.updated_at = Date.now();
        renderS2BatchList(list);
      }
    } else if (act === "detail") {
      openDetail(id);
    } else if (act === "delete") {
      if (confirm("确定删除这票货源吗？")) {
        state.shipments = state.shipments.filter(x => x.id !== id);
        renderS2BatchList(list.filter(x => x.id !== id));
      }
    }
  };
}

async function batchParse() {
  let n = 0;
  for (const sh of state.shipments) {
    if (sh.stage_id === 1) {
      sh.parsed_result = await parseSingleRaw(sh.raw_text);
      maybeAlertHeavyCargo(sh);
      sh.stage_id = 1;
      sh.updated_at = Date.now();
      n += 1;
    }
  }
  $("#batchHint").textContent = `已批量解析${n}票`;
  renderShipmentTable();
}

async function batchComplete() {
  let n = 0;
  for (const sh of state.shipments) {
    if (sh.stage_id === 1) {
      if (!sh.parsed_result) sh.parsed_result = await parseSingleRaw(sh.raw_text);
      sh.completed_result = completeCargoFromParsed(sh.parsed_result?.parsed || {});
      sh.stage_id = 2;
      sh.local_status = "pending_review";
      sh.updated_at = Date.now();
      n += 1;
    }
  }
  $("#batchHint").textContent = `已批量补全${n}票`;
  renderShipmentTable();
}

function batchMatch() {
  const candidates = state.shipments.filter((sh) => sh.stage_id === 3 && sh.risk_result?.can_publish === true);
  const ready = [];
  const failed = [];
  candidates.forEach((sh) => {
    const mapping = ensureDispatchMappings(sh);
    if (mapping.ok) ready.push(sh);
    else failed.push(`${sh.id.slice(-6)}: ${mapping.message || "映射校验失败"}`);
  });
  if (!ready.length) {
    const msg = failed.length
      ? `无可沉淀：${failed.slice(0, 2).join(" | ")}${failed.length > 2 ? " ..." : ""}`
      : "没有可沉淀货源";
    $("#batchHint").textContent = msg;
    renderFeishuHint(msg);
    return Promise.resolve();
  }
  return sinkShipmentsToFeishu(ready).then((rs) => {
    if (!rs.ok) {
      $("#batchHint").textContent = rs.message || "批量沉淀失败";
      return;
    }
    const failedTxt = failed.length ? `；失败 ${failed.length} 票` : "";
    $("#batchHint").textContent = `已批量沉淀飞书：创建 ${rs.created || 0}，更新 ${rs.updated || 0}${failedTxt}`;
    const failedHint = failed.length ? `；失败 ${failed.length} 票（${failed.slice(0, 2).join(" | ")}${failed.length > 2 ? " ..." : ""}）` : "";
    renderFeishuHint(`批量沉淀完成：创建 ${rs.created || 0}，更新 ${rs.updated || 0}${failedHint}`);
    renderShipmentTable();
  });
}

function setDetailStrategy(sh, v) {
  sh.strategy = v;
  sh.updated_at = Date.now();
  renderDetail();
}

function bindDetailActions() {
  $("#btnBack").onclick = () => {
    state.selected_id = null;
    setView("list");
    renderShipmentTable();
  };
  $("#btnStepBack").onclick = () => {
    const sh = getSelected();
    if (!sh) return;
    if (sh.stage_id <= 1 || sh.stage_id > 3) return;
    if (sh.stage_id === 3) {
      sh.matched_drivers = [];
      sh.selected_driver_ids = new Set();
    } else if (sh.stage_id === 2) {
      sh.completed_result = null;
    }
    sh.stage_id -= 1;
    sh.updated_at = Date.now();
    renderDetail();
    renderShipmentTable();
  };

  $("#btnDelete").onclick = () => {
    const sh = getSelected();
    if (!sh) return;
    state.shipments = state.shipments.filter((x) => x.id !== sh.id);
    state.selected_id = null;
    setView("list");
    renderShipmentTable();
  };

  $("#btnDetailParse").onclick = async () => {
    const sh = getSelected();
    if (!sh) return;
    const btn = $("#btnDetailParse");
    btn.disabled = true;
    btn.textContent = "解析中...";
    sh.raw_text = $("#detailRaw").value.trim();
    sh.parsed_result = await parseSingleRaw(sh.raw_text);
    maybeAlertHeavyCargo(sh);
    sh.completed_result = completeCargoFromParsed(sh.parsed_result?.parsed || {});
    sh.stage_id = 2;
    sh.blocked = false;
    sh.updated_at = Date.now();
    btn.disabled = false;
    btn.textContent = "保存并重新解析";
    renderDetail();
    renderShipmentTable();
  };

  const btnDetailComplete = $("#btnDetailComplete");
  if (btnDetailComplete) btnDetailComplete.onclick = () => {
    const sh = getSelected();
    if (!sh) return;
    sh.completed_result = completeCargoFromParsed(sh.parsed_result?.parsed || {});
    sh.confirm = { price: false, load_time: false };
    sh.s5_confirmed = false;
    sh.stage_id = 2;
    sh.local_status = "pending_review";
    sh.updated_at = Date.now();
    renderDetail();
    renderShipmentTable();
  };

  const btnDetailMatch = $("#btnDetailMatch");
  if (btnDetailMatch) btnDetailMatch.onclick = () => {
    const sh = getSelected();
    if (!sh) return;
    if (!(sh.confirm?.price === true && sh.confirm?.load_time === true)) {
      alert("请先确认运费和装货时间");
      return;
    }
    const cargo = sh.completed_result?.cargo || {};
    sh.risk_result = diagnoseRisks(cargo);
    sh.blocked = !sh.risk_result.can_publish;
    sh.stage_id = sh.risk_result.can_publish ? 3 : 2;
    sh.local_status = sh.risk_result.can_publish ? "ready" : "pending_review";
    sh.updated_at = Date.now();
    renderDetail();
    renderShipmentTable();
  };

  const btnToMode = $("#btnToMode");
  if (btnToMode) btnToMode.onclick = () => {
    const sh = getSelected();
    if (!sh) return;
    if (sh.risk_result?.can_publish !== true) {
      alert("有阻断风险，请先修复");
      return;
    }
    sh.stage_id = 3;
    sh.updated_at = Date.now();
    renderDetail();
    renderShipmentTable();
  };

  const sinkBack = $("#btnBackToListFromSink");
  if (sinkBack) {
    sinkBack.onclick = () => {
      setView("list");
      renderShipmentTable();
    };
  }
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

async function importFileToShipments(file) {
  if (!file) return [];
  if (!window.XLSX) throw new Error("XLSX库未加载");
  const buf = await readFileAsArrayBuffer(file);
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const rawList = [];
  rows.forEach((r) => {
    const raw = r.raw_input || r["原始文本"] || r["原始输入"] || r["text"];
    if (raw) {
      rawList.push(String(raw));
      return;
    }
    const from = r["出发地"] || r["发货地"] || r["装货地"] || "";
    const to = r["目的地"] || r["收货地"] || r["卸货地"] || "";
    const goods = r["货物"] || r["货物名称"] || "";
    const vlen = r["车长"] || r["车型"] || "";
    const time = r["时间"] || r["装货时间"] || "";
    const price = r["运费"] || "";
    const pay = r["付款"] || r["付款方式"] || "";
    const parts = [];
    if (from && to) parts.push(`[${from}→${to}]`);
    if (goods) parts.push(`[${goods}]`);
    if (vlen) parts.push(`[${vlen}]`);
    if (time) parts.push(`[${time}]`);
    if (price) parts.push(`[${price}]`);
    if (pay) parts.push(`[${pay}]`);
    const built = parts.join("");
    if (built) rawList.push(built);
  });

  return rawList;
}

async function parseImageWithBailian(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result; // data:image/png;base64,...
      try {
        const base = feishuBackendBase();
        const res = await fetch(`${base}/api/ai/bailian_ocr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_data_url: base64Data })
        });
        const j = await res.json();
        resolve(String(j?.text || "").trim());
      } catch (e) {
        console.error("Bailian parse failed:", e);
        resolve("");
      }
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

function bindUnifiedBox() {
  const dz = $("#unifiedBox");
  const ta = $("#unifiedInput");
  const hint = $("#fileHint");

  const onFiles = async (files) => {
    let total = 0;
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        hint.textContent = "正在通过阿里云百炼解析图片，请稍候...";
        const text = await parseImageWithBailian(f);
        if (text) {
          ta.value = [ta.value, text].filter(Boolean).join("\n");
          hint.textContent = "图片解析完成！";
        } else {
          hint.textContent = "图片解析失败或未找到文本。";
        }
      } else if (/\.(xlsx|xls|csv)$/i.test(f.name) || f.type.includes("sheet") || f.type.includes("csv")) {
        try {
          const list = await importFileToShipments(f);
          ta.value = [ta.value, ...list].filter(Boolean).join("\n");
          hint.textContent = `已从Excel/CSV提取${list.length}条货源。`;
        } catch (e) {
          hint.textContent = `导入失败：${e.message || e}`;
        }
      } else if (f.type === "text/plain") {
        const txt = await f.text();
        ta.value = [ta.value, txt].filter(Boolean).join("\n");
      }
    }
  };

  dz.ondragover = (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  };
  dz.ondragleave = () => dz.classList.remove("drag");
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer?.files?.length) {
      onFiles(e.dataTransfer.files);
    } else {
      const txt = e.dataTransfer.getData("text/plain");
      if (txt) ta.value = [ta.value, txt].filter(Boolean).join("\n");
    }
  };

  dz.addEventListener("paste", async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const img = items.find((it) => it.type.startsWith("image/"));
    if (img) {
      e.preventDefault(); // Prevent default image paste handling
      const file = img.getAsFile();
      if (file) {
        hint.textContent = "正在通过阿里云百炼解析截图，请稍候...";
        const text = await parseImageWithBailian(file);
        if (text) {
          ta.value = [ta.value, text].filter(Boolean).join("\n");
          hint.textContent = "截图解析完成！";
        } else {
          hint.textContent = "截图解析失败或未找到文本。";
        }
      }
      return;
    }
    
    // Handle text paste
    const txt = e.clipboardData?.getData("text/plain");
    if (txt) {
      // Only manually append if the user is not actively focusing the textarea
      if (document.activeElement !== ta) {
        e.preventDefault();
        ta.value = [ta.value, txt].filter(Boolean).join("\n");
      }
    }
  });
}

function bindImagePaste() {}

function bindListActions() {
  const exampleBtn = $("#btnInsertExample");
  if (exampleBtn) {
    exampleBtn.onclick = () => {
      const ta = $("#unifiedInput");
      if (!ta) return;
      const arr = String(DATA?.demo?.sample_bulk_text || "").split(/\n/g).map((x) => x.trim()).filter(Boolean);
      const sampleOne = String(DATA?.demo?.sample_text || "").trim();
      const list = arr.length ? arr : sampleOne ? [sampleOne] : [];
      if (!list.length) return;
      if (!state.example_cursor) state.example_cursor = 0;
      const idx = state.example_cursor % list.length;
      state.example_cursor += 1;
      const sample = list[idx];
      if (!sample) return;
      const cur = String(ta.value || "").trim();
      ta.value = cur ? `${cur}\n${sample}` : sample;
      ta.focus();
      const hint = $("#fileHint");
      if (hint) hint.textContent = "已插入示例";
    };
  }
  $("#btnCreateFromPaste").onclick = handleCreateFromPaste;
  const safeBatch = (fn) => async () => {
    await fn();
  };
  $("#btnBatchParse").onclick = safeBatch(batchParse);
  $("#btnBatchComplete").onclick = safeBatch(batchComplete);
  $("#btnBatchMatch").onclick = safeBatch(batchMatch);
}

const FEISHU = {
  backend: "http://127.0.0.1:8787",
  app_token: "H3tqbQt8CamXfIskpzncdUg4nkf",
  table_id: "tblnvisXxqZjkOw1",
  view_id: "vewNhBX7cO",
  doc_url: ""
};

function feishuBackendBase() {
  const host = window.location.hostname;
  const port = String(window.location.port || "");
  if (host === "127.0.0.1" || host === "localhost") {
    if (port && port !== "8787") return "http://127.0.0.1:8787";
    return window.location.origin;
  }
  return window.location.origin;
}
const FEISHU_BOOTSTRAP_FIELDS = [
  "cargo_id",
  "raw_text",
  "stage_id",
  "local_status",
  "blocked",
  "created_at",
  "updated_at",
  "origin_city",
  "destination_city",
  "goods_category",
  "vehicle_type",
  "vehicle_length",
  "load_time",
  "temp_requirement",
  "client_quoted_price",
  "platform_shelf_price",
  "driver_deal_price",
  "margin_amount",
  "platform_cargo_id",
  "platform_order_id",
  "platform_driver_id",
  "platform_status"
];

const PLATFORM_DRAFT_SPECS = [
  { platform_field: "cargo_name", label: "货物名称", local_field: "B02_goods_category_l2", required: true, default_rule: "direct" },
  { platform_field: "first_category_name", label: "一级货类", local_field: "B01_goods_category_l1", required: true, default_rule: "direct" },
  { platform_field: "cargo_weight", label: "货物重量(吨)", local_field: "B03_goods_weight_ton", required: true, default_rule: "direct" },
  { platform_field: "cargo_capacity", label: "货物体积(方)", local_field: "B04_goods_volume_m3", required: false, default_rule: "direct" },
  { platform_field: "truck_type_name", label: "车型", local_field: "C01_vehicle_type", required: true, default_rule: "direct" },
  { platform_field: "truck_len", label: "车长", local_field: "C02_vehicle_length", required: true, default_rule: "remove_meter" },
  { platform_field: "load_addr", label: "装货地址", local_field: "A04_origin_address_detail", required: true, default_rule: "direct" },
  { platform_field: "unloading_addr", label: "卸货地址", local_field: "A08_destination_address_detail", required: true, default_rule: "direct" },
  { platform_field: "load_time", label: "装货时间", local_field: "D01_load_time_start", required: true, default_rule: "datetime_ymdhm" },
  { platform_field: "on_shelf_price", label: "上架价格", local_field: "Z02_platform_shelf_price", required: true, default_rule: "direct" },
  { platform_field: "pay_method", label: "付款方式", local_field: "E03_payment_method", required: true, default_rule: "payment_method_normalize" }
];

const PREFS_KEY = "cargo_tool_prefs_v1";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const driverPool = (DATA.driver_pool || []).map((d) => ({
    uid: d.driver_id,
    name: d.name,
    phone: d.phone,
    plate: d.license_plate,
    vehicle_type: d.vehicle_type,
    vehicle_length: d.vehicle_length,
    tags: [
      d.familiar_level === "diamond" ? "钻石熟车" : d.familiar_level === "gold" ? "黄金熟车" : d.familiar_level === "normal" ? "青铜熟车" : "近期未接"
    ],
    is_self_owned: false,
    orders_count: d.platform_stats?.orders_total ?? 0,
    rating: d.platform_stats?.rating_good_pct ?? 0,
    joined_date: d.platform_stats?.joined_at ?? "",
    wechat_name: d.wechat_profile?.wechat_name ?? "",
    wechat_avatar_url: d.wechat_profile?.avatar_url ?? ""
  }));
  return {
    field_mappings: PLATFORM_DRAFT_SPECS.map((x) => ({
      local_field: x.local_field,
      local_value: "",
      platform_field: x.platform_field,
      platform_value: "",
      transform_rule: x.default_rule,
      note: ""
    })),
    shipping_prefs: {
      payment_method_default: DATA.shipper_profile?.cargo_habits?.payment_method || "到付",
      invoice_type_default: DATA.shipper_profile?.cargo_habits?.invoice_type || "普票",
      dedup_same_day_only: true,
      dedup_default_action: "confirm_create",
      risk_price_low_ratio: 0.8,
      risk_price_high_ratio: 1.2
    },
    driver_pool: driverPool,
    feishu_field_map: {
      cargo_id: "cargo_id",
      raw_text: "raw_text",
      stage_id: "stage_id",
      blocked: "blocked",
      created_at: "created_at",
      updated_at: "updated_at",
      platform_cargo_id: "platform_cargo_id",
      platform_order_id: "platform_order_id",
      platform_driver_id: "platform_driver_id",
      platform_status: "platform_status"
    }
  };
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function applyTransformRule(rule, rawValue, context) {
  const value = rawValue ?? "";
  const r = String(rule || "direct");
  if (r === "direct") return value;
  if (r === "remove_meter") return String(value || "").replace(/米/g, "");
  if (r === "payment_method_normalize") return String(value || "").includes("月结") ? "月结" : String(value || "");
  if (r === "datetime_ymdhm") return fromDatetimeLocal(toDatetimeLocal(String(value || "")));
  if (r === "bool_assign") return context?.sh?.strategy === "assign" ? 1 : 0;
  if (r === "deal_mode_enum") return context?.sh?.strategy === "open" ? 1 : 2;
  return value;
}

function buildPlatformDraftFromLocal(sh, mappings) {
  const cargo = sh.completed_result?.cargo || {};
  const rows = Array.isArray(mappings) ? mappings : [];
  const missing = [];
  const draft = {
    cargo_id: sh.platform?.cargo_id || "",
    shipper_id: DATA.shipper_profile?.shipper_id || "",
    deal_mode: applyTransformRule("deal_mode_enum", "", { sh }),
    is_point_cargo: applyTransformRule("bool_assign", "", { sh }),
    on_shelf_time: fromDatetimeLocal(toDatetimeLocal(new Date().toISOString().slice(0, 16)))
  };

  PLATFORM_DRAFT_SPECS.forEach((spec) => {
    const matched = rows.find((m) => {
      if (m.platform_field !== spec.platform_field) return false;
      if (!m.local_value) return true;
      return String(cargo[m.local_field] ?? "") === String(m.local_value);
    });
    const localField = matched?.local_field || spec.local_field;
    const raw = cargo[localField];
    const transformed = applyTransformRule(matched?.transform_rule || spec.default_rule, raw, { sh, row: matched, spec });
    const finalValue = matched?.platform_value ? matched.platform_value : transformed;
    draft[spec.platform_field] = finalValue;
    if (spec.required && (finalValue === undefined || finalValue === null || String(finalValue).trim() === "")) {
      missing.push(spec);
    }
  });

  return { ok: missing.length === 0, draft, missing };
}

function ensureDispatchMappings(sh) {
  const prefs = state.prefs || loadPrefs();
  state.prefs = prefs;
  if (!Array.isArray(prefs.field_mappings)) prefs.field_mappings = [];
  const cargo = sh.completed_result?.cargo || {};
  PLATFORM_DRAFT_SPECS.forEach((spec) => {
    const has = prefs.field_mappings.some((m) => m.platform_field === spec.platform_field);
    if (!has) {
      prefs.field_mappings.push({
        local_field: spec.local_field,
        local_value: "",
        platform_field: spec.platform_field,
        platform_value: "",
        transform_rule: spec.default_rule,
        note: "系统默认映射"
      });
    }
  });

  const localKeys = Object.keys(cargo);
  for (const spec of PLATFORM_DRAFT_SPECS.filter((x) => x.required)) {
    const map = prefs.field_mappings.find((m) => m.platform_field === spec.platform_field) || { local_field: spec.local_field };
    if (!Object.prototype.hasOwnProperty.call(cargo, map.local_field)) {
      const fix = prompt(`平台字段【${spec.label}】映射到不存在字段【${map.local_field}】。\n请输入新的货主字段 code：`, spec.local_field);
      if (fix === null) return { ok: false, message: "已取消发货：请先纠正映射字段" };
      map.local_field = String(fix || "").trim();
      if (!map.local_field) return { ok: false, message: "已取消发货：映射字段不能为空" };
    }
    if (!localKeys.includes(map.local_field) || cargo[map.local_field] === undefined || cargo[map.local_field] === null || String(cargo[map.local_field]).trim() === "") {
      const input = prompt(`平台必填【${spec.label}】缺值，请填写（本地字段：${map.local_field}）：`, "");
      if (input === null) return { ok: false, message: "已取消发货：平台必填未补齐" };
      const txt = String(input).trim();
      if (!txt) return { ok: false, message: "已取消发货：平台必填未补齐" };
      cargo[map.local_field] = txt;
    }
  }

  if (sh.completed_result) sh.completed_result.cargo = cargo;
  const built = buildPlatformDraftFromLocal(sh, prefs.field_mappings);
  if (!built.ok) {
    return {
      ok: false,
      message: `已取消发货：平台草稿缺少必填：${built.missing.map((x) => x.label).join("、")}`
    };
  }
  sh.platform_draft = built.draft;
  savePrefs(prefs);
  return { ok: true, draft: built.draft };
}

function maskName(name) {
  const n = String(name || "").trim();
  if (!n) return "师傅";
  return `${n.slice(0, 1)}师傅`;
}

function maskPhone(phone) {
  const s = String(phone || "").trim();
  return s.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
}

function maskPlate(plate) {
  const s = String(plate || "").trim();
  if (s.length <= 4) return s;
  return `${s.slice(0, 2)}**${s.slice(-3)}`;
}

async function copyText(text) {
  const t = String(text || "");
  try {
    await navigator.clipboard.writeText(t);
    alert("已复制");
  } catch {
    prompt("复制以下内容：", t);
  }
}

function renderPrefs() {
  const prefs = state.prefs || loadPrefs();
  state.prefs = prefs;

  const tabs = $$("#view-prefs .tab");
  const panels = $$("#view-prefs .tab-panel");
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.classList.toggle("active", x === t));
      const key = t.dataset.tab;
      panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== key));
    };
  });

  const platformOptions = [
    ...PLATFORM_DRAFT_SPECS.map((x) => ({ code: x.platform_field, label: x.label })),
    { code: "deal_mode", label: "议价模式" },
    { code: "is_point_cargo", label: "是否指派" },
    { code: "on_shelf_time", label: "上架时间" }
  ];

  const rows = prefs.field_mappings || [];
  const mapTable = `
    <table class="field-table">
      <tr><th>本地字段</th><th>本地值(选填)</th><th>平台字段</th><th>平台值(选填)</th><th>转换</th><th>备注</th><th></th></tr>
      ${rows
        .map((r, idx) => {
          const opts = platformOptions
            .map((o) => `<option value="${safeText(o.code)}" ${o.code === r.platform_field ? "selected" : ""}>${safeText(o.label)}（${safeText(o.code)}）</option>`)
            .join("");
          return `
            <tr>
              <td><input data-map="local_field" data-idx="${idx}" value="${safeText(r.local_field || "")}" placeholder="例如 A04_origin_address_detail"></td>
              <td><input data-map="local_value" data-idx="${idx}" value="${safeText(r.local_value || "")}" placeholder="可选：仅当本地值=该值时命中"></td>
              <td>
                <select data-map="platform_field" data-idx="${idx}">
                  <option value=""></option>
                  ${opts}
                </select>
              </td>
              <td><input data-map="platform_value" data-idx="${idx}" value="${safeText(r.platform_value || "")}" placeholder="可选：覆盖转换结果"></td>
              <td>
                <select data-map="transform_rule" data-idx="${idx}">
                  <option value="direct" ${r.transform_rule === "direct" ? "selected" : ""}>direct</option>
                  <option value="remove_meter" ${r.transform_rule === "remove_meter" ? "selected" : ""}>remove_meter</option>
                  <option value="payment_method_normalize" ${r.transform_rule === "payment_method_normalize" ? "selected" : ""}>payment_method_normalize</option>
                  <option value="datetime_ymdhm" ${r.transform_rule === "datetime_ymdhm" ? "selected" : ""}>datetime_ymdhm</option>
                  <option value="deal_mode_enum" ${r.transform_rule === "deal_mode_enum" ? "selected" : ""}>deal_mode_enum</option>
                  <option value="bool_assign" ${r.transform_rule === "bool_assign" ? "selected" : ""}>bool_assign</option>
                </select>
              </td>
              <td><input data-map="note" data-idx="${idx}" value="${safeText(r.note || "")}" placeholder="规则说明"></td>
              <td><button class="btn-danger btn-sm" data-act="rm-map" data-idx="${idx}">删除</button></td>
            </tr>
          `;
        })
        .join("")}
    </table>
    <div class="actions">
      <button id="btnAddMap" class="btn-secondary">新增映射</button>
    </div>
  `;
  $("#prefsMapBox").innerHTML = mapTable;

  $("#prefsMapBox").oninput = (e) => {
    const el = e.target.closest("[data-map]");
    if (!el) return;
    const idx = Number(el.dataset.idx);
    const key = el.dataset.map;
    prefs.field_mappings[idx][key] = el.value;
  };
  $("#prefsMapBox").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "btnAddMap") {
      prefs.field_mappings.push({
        local_field: "",
        local_value: "",
        platform_field: "",
        platform_value: "",
        transform_rule: "direct",
        note: ""
      });
      renderPrefs();
      return;
    }
    if (b.dataset.act === "rm-map") {
      prefs.field_mappings.splice(Number(b.dataset.idx), 1);
      renderPrefs();
      return;
    }
  };

  const sp = prefs.shipping_prefs || {};
  $("#prefsShipBox").innerHTML = `
    <div class="grid-2">
      <div>
        <label>付款默认值</label>
        <input id="prefPay" value="${safeText(sp.payment_method_default || "")}">
      </div>
      <div>
        <label>开票默认值</label>
        <input id="prefInvoice" value="${safeText(sp.invoice_type_default || "")}">
      </div>
      <div>
        <label>去重范围（北京时间）</label>
        <select id="prefDedupScope">
          <option value="same_day" ${sp.dedup_same_day_only !== false ? "selected" : ""}>仅当天</option>
        </select>
      </div>
      <div>
        <label>疑似重复默认动作</label>
        <select id="prefDedupDefault">
          <option value="confirm_create" ${sp.dedup_default_action === "confirm_create" ? "selected" : ""}>确认入库</option>
          <option value="ignore" ${sp.dedup_default_action === "ignore" ? "selected" : ""}>忽略</option>
        </select>
      </div>
      <div>
        <label>低价阈值</label>
        <input id="prefLow" type="number" step="0.01" min="0" value="${safeText(sp.risk_price_low_ratio ?? 0.8)}">
      </div>
      <div>
        <label>高价阈值</label>
        <input id="prefHigh" type="number" step="0.01" min="0" value="${safeText(sp.risk_price_high_ratio ?? 1.2)}">
      </div>
    </div>
  `;
  $("#prefsShipBox").oninput = () => {
    prefs.shipping_prefs.payment_method_default = $("#prefPay").value.trim();
    prefs.shipping_prefs.invoice_type_default = $("#prefInvoice").value.trim();
    prefs.shipping_prefs.dedup_same_day_only = $("#prefDedupScope").value === "same_day";
    prefs.shipping_prefs.dedup_default_action = $("#prefDedupDefault").value;
    prefs.shipping_prefs.risk_price_low_ratio = Number($("#prefLow").value || 0.8);
    prefs.shipping_prefs.risk_price_high_ratio = Number($("#prefHigh").value || 1.2);
  };

  const pool = prefs.driver_pool || [];
  const renderPool = () => {
    return `
      <div class="actions">
        <button id="btnAddDriver" class="btn-secondary">新增司机</button>
      </div>
      <div class="batch-list">
        ${pool
          .map((d, idx) => {
            const tags = []
              .concat(d.is_self_owned ? ["自有车"] : [])
              .concat(d.tags || [])
              .filter(Boolean)
              .map((t) => `<span class="pill blue">${safeText(t)}</span>`)
              .join(" ");
            const w = d.wechat_name ? `<div class="small muted">微信：${safeText(d.wechat_name)}</div>` : "";
            return `
              <div class="batch-card">
                <div class="card-header">
                  <div class="card-title">${safeText(maskName(d.name))} · ${safeText(maskPlate(d.plate))}</div>
                  <div>${tags}</div>
                </div>
                <div class="card-body">
                  <div>${safeText(maskPhone(d.phone))} · ${safeText(d.vehicle_length)} ${safeText(d.vehicle_type)}</div>
                  <div class="small muted">接单 ${safeText(d.orders_count)} 单 · 好评率 ${safeText(d.rating)}% · 加入 ${safeText(d.joined_date)}</div>
                  ${w}
                </div>
                <div class="card-actions">
                  <a class="btn-ghost btn-sm" href="tel:${safeText(String(d.phone || '').trim())}">电话</a>
                  <button class="btn-ghost btn-sm" data-act="wx" data-idx="${idx}">微信联系</button>
                  <button class="btn-ghost btn-sm" data-act="copywx" data-idx="${idx}">复制微信</button>
                  <button class="btn-ghost btn-sm" data-act="copy" data-idx="${idx}">复制信息</button>
                  <button class="btn-danger btn-sm" data-act="rm" data-idx="${idx}">删除</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  };
  $("#prefsPoolBox").innerHTML = renderPool();
  $("#prefsPoolBox").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "btnAddDriver") {
      const name = prompt("司机姓名（展示会脱敏）：", "");
      if (!name) return;
      const phone = prompt("手机号：", "");
      const plate = prompt("车牌号：", "");
      const vlen = prompt("车长（如 4.2米）：", "4.2米");
      const vtype = prompt("车型（如 冷藏车）：", "冷藏车");
      const wechat = prompt("微信名称（可选）：", "");
      pool.unshift({
        uid: createId("DRIVER"),
        name,
        phone,
        plate,
        vehicle_type: vtype,
        vehicle_length: vlen,
        tags: ["青铜熟车"],
        is_self_owned: false,
        orders_count: 0,
        rating: 100,
        joined_date: new Date().toISOString().slice(0, 10),
        wechat_name: wechat,
        wechat_avatar_url: ""
      });
      prefs.driver_pool = pool;
      renderPrefs();
      return;
    }
    const idx = Number(b.dataset.idx);
    const d = pool[idx];
    if (!d) return;
    if (b.dataset.act === "wx") {
      alert("已通过扫码号推送固定消息（演示）");
      return;
    }
    if (b.dataset.act === "copywx") {
      copyText(d.wechat_name || "");
      return;
    }
    if (b.dataset.act === "copy") {
      const txt = [
        `司机姓名：${maskName(d.name)}`,
        `手机号：${String(d.phone || "")}`,
        `车长车型：${String(d.vehicle_length || "")} ${String(d.vehicle_type || "")}`.trim(),
        `车牌：${String(d.plate || "")}`,
        `微信名称：${String(d.wechat_name || "")}`
      ].join("\n");
      copyText(txt);
      return;
    }
    if (b.dataset.act === "rm") {
      if (!confirm("确定删除该司机吗？")) return;
      pool.splice(idx, 1);
      prefs.driver_pool = pool;
      renderPrefs();
      return;
    }
  };

  const feishuKeys = Object.keys(prefs.feishu_field_map || {});
  $("#prefsFeishuBox").innerHTML = `
    <div class="actions">
      <button id="btnFeishuLoadFields" class="btn-secondary">读取飞书字段</button>
      <button id="btnFeishuInitFields" class="btn-secondary">初始化字段</button>
    </div>
    <div id="feishuPermissionHint" class="small"></div>
    <div id="feishuFieldsHint" class="small"></div>
    <table class="field-table" id="feishuMapTable"></table>
  `;
  const feishuTable = $("#feishuMapTable");
  const renderFeishuMap = (fieldNames) => {
    feishuTable.innerHTML = `<tr><th>Web 字段</th><th>飞书字段</th></tr>` + feishuKeys
      .map((k) => {
        const opts = (fieldNames || [])
          .map((n) => `<option value="${safeText(n)}" ${prefs.feishu_field_map[k] === n ? "selected" : ""}>${safeText(n)}</option>`)
          .join("");
        return `<tr><td class="mono small">${safeText(k)}</td><td><select data-fk="${safeText(k)}"><option value=""></option>${opts}</select></td></tr>`;
      })
      .join("");
    feishuTable.onchange = (e) => {
      const sel = e.target.closest("select[data-fk]");
      if (!sel) return;
      prefs.feishu_field_map[sel.dataset.fk] = sel.value;
    };
  };
  renderFeishuMap([]);
  const perm = hasFeishuScope(state.feishu_scope);
  const permHint = $("#feishuPermissionHint");
  if (permHint) {
    permHint.textContent = perm.canCreateField
      ? "权限：可初始化字段"
      : "权限不足：缺少 base:field:create";
  }
  const initBtn = $("#btnFeishuInitFields");
  if (initBtn) initBtn.disabled = !perm.canCreateField;

  $("#btnFeishuLoadFields").onclick = async () => {
    const hint = $("#feishuFieldsHint");
    hint.textContent = "读取中...";
    try {
      const base = feishuBackendBase();
      const res = await fetch(`${base}/api/bitable/fields?app_token=${encodeURIComponent(FEISHU.app_token)}&table_id=${encodeURIComponent(FEISHU.table_id)}`, { credentials: "include" });
      const j = await res.json();
      const items = j?.data?.items || j?.data?.fields || j?.data?.field_list || [];
      const names = items.map((x) => x.field_name || x.name).filter(Boolean);
      hint.textContent = `已读取 ${names.length} 个字段`;
      renderFeishuMap(names);
    } catch (e) {
      hint.textContent = `读取失败：${e?.message || e}`;
    }
  };
  $("#btnFeishuInitFields").onclick = async () => {
    const hint = $("#feishuFieldsHint");
    const scope = String(state.feishu_scope || "");
    if (!scope.includes("base:field:create")) {
      hint.textContent = "缺少 base:field:create";
      alert("缺少 base:field:create，请开通后重新连接飞书");
      return;
    }
    hint.textContent = "初始化字段中...";
    try {
      const payload = {
        field_names: FEISHU_BOOTSTRAP_FIELDS,
        field_type_map: {
          stage_id: 2,
          blocked: 7,
          created_at: 5,
          updated_at: 5
        }
      };
      const base = feishuBackendBase();
      const res = await fetch(`${base}/api/bitable/fields/init?app_token=${encodeURIComponent(FEISHU.app_token)}&table_id=${encodeURIComponent(FEISHU.table_id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      const j = await res.json();
      const created = j.created?.length || 0;
      const skipped = j.skipped?.length || 0;
      const failed = j.failed?.length || 0;
      hint.textContent = `初始化完成：新增 ${created}，已存在 ${skipped}，失败 ${failed}`;
      $("#btnFeishuLoadFields").click();
    } catch (e) {
      hint.textContent = `初始化失败：${e?.message || e}`;
    }
  };
}

function renderFeishuHint(text) {
  const el = $("#feishuHint");
  if (!el) return;
  el.textContent = text || "";
}

function hasFeishuScope(scope) {
  const s = String(scope || "");
  return {
    canCreateField: s.includes("base:field:create"),
    canReadField: s.includes("base:field:read")
  };
}

function renderFeishuPill(status, label) {
  const el = $("#feishuStatusPill");
  if (!el) return;
  el.classList.remove("green", "yellow", "red", "blue");
  if (status === "connected") el.classList.add("green");
  else if (status === "error") el.classList.add("red");
  else el.classList.add("yellow");
  el.textContent = label || "飞书：未知";
}

function renderFeishuMainButton() {
  const btn = $("#btnFeishuMain");
  if (!btn) return;
  btn.textContent = state.feishu_connected ? "已连接（可重连）" : "连接飞书";
}

async function feishuCheck() {
  renderFeishuPill("checking", "飞书：检查中");
  try {
    const base = feishuBackendBase();
    const res = await fetch(`${base}/api/feishu/status`, { credentials: "include" });
    const j = await res.json();
    state.feishu_scope = String(j.scope || "");
    if (j.connected) {
      state.feishu_connected = true;
      const name = j.user_info?.name || j.user_info?.en_name || j.user_info?.open_id || "";
      renderFeishuPill("connected", `飞书：已连接${name ? " · " + name : ""}`);
      renderFeishuHint("");
    } else {
      state.feishu_connected = false;
      renderFeishuPill("disconnected", "飞书：未连接");
      renderFeishuHint("飞书未连接，请先点“连接飞书”完成登录授权");
    }
    renderFeishuMainButton();
  } catch (e) {
    state.feishu_connected = false;
    renderFeishuPill("error", "飞书：后端不可用");
    renderFeishuHint(`飞书后端不可用：${e?.message || e}`);
    alert("飞书后端不可用：本地请确认已启动 feishu_backend.py（127.0.0.1:8787）；线上请检查 /api 是否可用");
    renderFeishuMainButton();
  }
}

function feishuLogin() {
  const base = feishuBackendBase();
  const toolUrl = `${window.location.origin}/`;
  const url = `${base}/auth/feishu/login?tool_url=${encodeURIComponent(toolUrl)}`;
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    renderFeishuHint("浏览器拦截了新标签页：请允许弹窗后重试，或复制链接在新标签页打开：" + url);
    alert("浏览器拦截了新标签页（弹窗）。\n\n请允许此站点打开新标签页后重试。\n\n你也可以复制链接手动在新标签页打开：\n" + url);
  }
}

async function feishuReauth() {
  try {
    const base = feishuBackendBase();
    await fetch(`${base}/api/feishu/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" });
  } catch {}
  state.feishu_connected = false;
  state.feishu_scope = "";
  renderFeishuPill("disconnected", "飞书：未连接");
  renderFeishuMainButton();
  feishuLogin();
}

function getFeishuFieldName(key) {
  const prefs = state.prefs || loadPrefs();
  const m = prefs.feishu_field_map || {};
  return m[key] || "";
}

function shipmentToFeishuFields(sh) {
  const fields = {};
  const put = (k, v) => {
    const name = getFeishuFieldName(k);
    if (!name) return;
    fields[name] = v;
  };
  put("cargo_id", sh.id);
  put("raw_text", sh.raw_text);
  put("stage_id", sh.stage_id);
  put("local_status", sh.local_status || "");
  put("blocked", sh.blocked === true);
  put("created_at", sh.created_at);
  put("updated_at", sh.updated_at);
  put("platform_cargo_id", sh.platform?.cargo_id || "");
  put("platform_order_id", sh.platform?.order_id || "");
  put("platform_driver_id", sh.platform?.driver_id || "");
  put("platform_status", sh.platform?.status || "");
  return fields;
}

function feishuRecordToShipment(rec) {
  const fields = rec?.fields || {};
  const get = (k) => fields[getFeishuFieldName(k)] ?? "";
  const sh = buildShipment(String(get("raw_text") || ""));
  const cargoId = String(get("cargo_id") || "").trim();
  if (cargoId) sh.id = cargoId;
  sh.feishu_record_id = rec.record_id || null;
  const sid = Number(get("stage_id") || 1);
  sh.stage_id = Number.isFinite(sid) ? Math.max(1, Math.min(4, sid)) : 1;
  sh.blocked = Boolean(get("blocked"));
  sh.created_at = Number(get("created_at") || Date.now());
  sh.updated_at = Number(get("updated_at") || Date.now());
  sh.platform = {
    cargo_id: String(get("platform_cargo_id") || ""),
    order_id: String(get("platform_order_id") || ""),
    driver_id: String(get("platform_driver_id") || ""),
    status: String(get("platform_status") || "")
  };
  sh.local_status = String(get("local_status") || "");
  if (sh.stage_id >= 4 || sh.local_status === "sunk_feishu") sh.local_status = "sunk_feishu";
  else if (sh.stage_id >= 3) sh.local_status = "ready";
  else sh.local_status = "pending_review";
  return sh;
}

async function sinkShipmentsToFeishu(list) {
  const targets = (list || []).filter((sh) => sh.stage_id >= 3 && sh.risk_result?.can_publish === true);
  if (!targets.length) return { ok: false, message: "没有可沉淀货源" };

  const creates = [];
  const updates = [];
  targets.forEach((sh) => {
    const fields = shipmentToFeishuFields(sh);
    if (sh.feishu_record_id) updates.push({ record_id: sh.feishu_record_id, fields, _ship: sh });
    else creates.push({ fields, _ship: sh });
  });

  if (creates.length) {
    const base = feishuBackendBase();
    const res = await fetch(`${base}/api/bitable/records/batch_create?app_token=${encodeURIComponent(FEISHU.app_token)}&table_id=${encodeURIComponent(FEISHU.table_id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: creates.map((x) => ({ fields: x.fields })) }),
      credentials: "include"
    });
    const j = await res.json();
    if (j.code !== 0) return { ok: false, message: `沉淀失败：${j.msg || "unknown"}` };
    const created = j?.data?.records || j?.data?.items || [];
    for (let i = 0; i < creates.length; i += 1) {
      const sh = creates[i]._ship;
      if (created[i]?.record_id) sh.feishu_record_id = created[i].record_id;
    }
  }

  if (updates.length) {
    const payload = updates.map((x) => ({ record_id: x.record_id, fields: x.fields }));
    const base = feishuBackendBase();
    const res = await fetch(`${base}/api/bitable/records/batch_update?app_token=${encodeURIComponent(FEISHU.app_token)}&table_id=${encodeURIComponent(FEISHU.table_id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: payload }),
      credentials: "include"
    });
    const j = await res.json();
    if (j.code !== 0) return { ok: false, message: `沉淀失败：${j.msg || "unknown"}` };
  }

  targets.forEach((sh) => {
    sh.stage_id = 4;
    sh.local_status = "sunk_feishu";
    sh.updated_at = Date.now();
  });
  return { ok: true, created: creates.length, updated: updates.length };
}

async function feishuPullOverwrite() {
  renderFeishuHint("拉取中...");
  const body = { view_id: FEISHU.view_id, page_size: 200 };
  const base = feishuBackendBase();
  const res = await fetch(`${base}/api/bitable/records/search?app_token=${encodeURIComponent(FEISHU.app_token)}&table_id=${encodeURIComponent(FEISHU.table_id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include"
  });
  const j = await res.json();
  if (j.code !== 0) {
    renderFeishuHint(`拉取失败：${j.msg || "unknown"}`);
    return;
  }
  const items = j?.data?.items || [];
  state.shipments = items.map(feishuRecordToShipment);
  setView("list");
  renderShipmentTable();
  renderFeishuHint(`已从飞书覆盖 Web：${state.shipments.length} 票`);
}

async function feishuPushOverwrite() {
  renderFeishuHint("沉淀中...");
  const rs = await sinkShipmentsToFeishu(state.shipments);
  if (!rs.ok) {
    renderFeishuHint(rs.message || "沉淀失败");
    return;
  }
  renderShipmentTable();
  renderFeishuHint(`已沉淀飞书：创建 ${rs.created || 0} 条，更新 ${rs.updated || 0} 条`);
}

function boot() {
  bindUnifiedBox();
  bindListActions();
  bindDetailActions();

  const finishBtn = $("#btnS2Finish");
  if (finishBtn) {
    finishBtn.onclick = () => {
      setView("list");
      setHomeModule("fast");
      renderShipmentTable();
    };
  }
  const backBtn = $("#btnS2Back");
  if (backBtn) {
    backBtn.onclick = () => {
      setView("list");
      setHomeModule("fast");
      renderShipmentTable();
    };
  }

  state.prefs = loadPrefs();

  const btnPrefs = $("#btnPrefs");
  if (btnPrefs) {
    btnPrefs.onclick = () => {
      setView("prefs");
      renderPrefs();
    };
  }
  const btnPrefsBack = $("#btnPrefsBack");
  if (btnPrefsBack) {
    btnPrefsBack.onclick = () => {
      setView("list");
      renderShipmentTable();
    };
  }
  const btnPrefsSave = $("#btnPrefsSave");
  if (btnPrefsSave) {
    btnPrefsSave.onclick = () => {
      savePrefs(state.prefs || loadPrefs());
      alert("已保存偏好设置");
    };
  }

  const btnMain = $("#btnFeishuMain");
  const dropdown = $("#feishuDropdown");
  const closeMenu = () => {
    if (dropdown) dropdown.open = false;
  };
  if (btnMain) {
    btnMain.onclick = () => {
      closeMenu();
      feishuLogin();
    };
  }
  const btnCheck = $("#btnFeishuCheck");
  if (btnCheck) {
    btnCheck.onclick = () => {
      closeMenu();
      feishuCheck();
    };
  }
  const btnPull = $("#btnFeishuPull");
  if (btnPull) {
    btnPull.onclick = () => {
      closeMenu();
      feishuPullOverwrite();
    };
  }
  const btnPush = $("#btnFeishuPush");
  if (btnPush) {
    btnPush.onclick = () => {
      closeMenu();
      feishuPushOverwrite();
    };
  }
  const btnReauth = $("#btnFeishuReauth");
  if (btnReauth) {
    btnReauth.onclick = () => {
      closeMenu();
      feishuReauth();
    };
  }
  if (dropdown) {
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target)) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  setView("list");
  setHomeModule("fast");
  renderShipmentTable();
  feishuCheck();
  renderFeishuMainButton();

  const docBtn = $("#btnOpenFeishuDoc");
  if (docBtn) {
    const url = String(FEISHU.doc_url || "").trim();
    if (url) docBtn.href = url;
    else {
      docBtn.href = "#";
      docBtn.onclick = (e) => {
        e.preventDefault();
        alert("未配置飞书文档链接：请在代码里设置 FEISHU.doc_url（或后续在偏好设置提供入口）");
      };
    }
  }

  window.addEventListener("message", (event) => {
    const d = event?.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "feishu_authed") {
      feishuCheck();
    }
  });
}

document.addEventListener("DOMContentLoaded", boot);
