const BINANCE = "https://fapi.binance.com";
const SNAPSHOT = "data/snapshot.json";

const $ = (id) => document.getElementById(id);
const money = (value) => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (value, digits = 2) => `${Number(value).toFixed(digits)}%`;

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function riskFromRatio(ratio) {
  if (ratio >= 1) return { label: "Pi 触发", cls: "risk-high", score: 100, copy: "111DMA 已经上穿 2 x 350DMA，周期顶部风险信号触发。" };
  if (ratio >= 0.95) return { label: "预警区", cls: "risk-high", score: 92, copy: "Pi 指标非常接近交叉，进入周期顶部风险预警。" };
  if (ratio >= 0.85) return { label: "观察区", cls: "risk-watch", score: 72, copy: "Pi 指标开始接近顶部区域，需要结合链上和衍生品复核。" };
  return { label: "低风险", cls: "risk-low", score: Math.max(8, ratio * 70), copy: "Pi 指标距离顶部交叉仍远，当前不是 Pi 顶部区。" };
}

function heatColor(score) {
  if (score >= 85) return "var(--red)";
  if (score >= 60) return "var(--amber)";
  return "var(--green)";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function loadLiveData() {
  const [klines, premium, oi] = await Promise.all([
    fetchJson(`${BINANCE}/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=1500`),
    fetchJson(`${BINANCE}/fapi/v1/premiumIndex?symbol=BTCUSDT`),
    fetchJson(`${BINANCE}/fapi/v1/openInterest?symbol=BTCUSDT`),
  ]);
  return { klines, premium, oi, source: "Binance public API", snapshot: false };
}

async function loadData() {
  try {
    return await loadLiveData();
  } catch (error) {
    if (window.BTC_SNAPSHOT) {
      return { ...window.BTC_SNAPSHOT, source: "Embedded local snapshot", snapshot: true };
    }
    const fallback = await fetchJson(SNAPSHOT);
    return { ...fallback, source: "Local snapshot", snapshot: true };
  }
}

function computeMetrics(data) {
  const rows = data.klines.map((row) => ({
    time: Number(row[0]),
    date: new Date(Number(row[0])).toISOString().slice(0, 10),
    close: Number(row[4]),
  }));
  const closes = rows.map((row) => row.close);
  const latest = rows[rows.length - 1];
  const ma111 = average(closes.slice(-111));
  const ma350x2 = average(closes.slice(-350)) * 2;
  const ma200d = average(closes.slice(-200));
  const ma200w = average(closes.slice(-1400));
  const piRatio = ma111 / ma350x2;
  const fundingRate = Number(data.premium?.lastFundingRate || 0) * 100;
  const openInterest = Number(data.oi?.openInterest || 0);
  const risk = riskFromRatio(piRatio);
  const dmaDistance = ((latest.close / ma200d) - 1) * 100;
  const wmaDistance = ((latest.close / ma200w) - 1) * 100;
  const derivScore = Math.min(100, Math.abs(fundingRate) * 1800 + (fundingRate > 0.03 ? 20 : 0));

  return { rows, latest, ma111, ma350x2, ma200d, ma200w, piRatio, fundingRate, openInterest, risk, dmaDistance, wmaDistance, derivScore };
}

function setBar(id, score) {
  const el = $(id);
  el.style.width = `${Math.max(4, Math.min(100, score))}%`;
  el.style.background = heatColor(score);
}

function drawChart(rows, metrics) {
  const canvas = $("piChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth * window.devicePixelRatio;
  const height = 260 * window.devicePixelRatio;
  canvas.width = width;
  canvas.height = height;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, canvas.clientWidth, 260);

  const points = rows.slice(-520);
  const closes = rows.map((row) => row.close);
  const series = points.map((row, index) => {
    const globalIndex = rows.length - points.length + index;
    const sliceTo = globalIndex + 1;
    return {
      date: row.date,
      price: row.close,
      ma111: sliceTo >= 111 ? average(closes.slice(sliceTo - 111, sliceTo)) : null,
      ma350x2: sliceTo >= 350 ? average(closes.slice(sliceTo - 350, sliceTo)) * 2 : null,
    };
  });

  const values = series.flatMap((row) => [row.price, row.ma111, row.ma350x2]).filter(Boolean);
  const min = Math.min(...values) * 0.96;
  const max = Math.max(...values) * 1.04;
  const chartW = canvas.clientWidth - 52;
  const chartH = 212;
  const left = 42;
  const top = 14;
  const x = (i) => left + (i / (series.length - 1)) * chartW;
  const y = (value) => top + (1 - (value - min) / (max - min)) * chartH;

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const yy = top + (i / 4) * chartH;
    ctx.moveTo(left, yy);
    ctx.lineTo(left + chartW, yy);
  }
  ctx.stroke();

  function plot(key, color, widthLine) {
    ctx.strokeStyle = color;
    ctx.lineWidth = widthLine;
    ctx.beginPath();
    let started = false;
    series.forEach((row, i) => {
      if (!row[key]) return;
      if (!started) {
        ctx.moveTo(x(i), y(row[key]));
        started = true;
      } else {
        ctx.lineTo(x(i), y(row[key]));
      }
    });
    ctx.stroke();
  }

  plot("ma350x2", "#cf3f3f", 2);
  plot("ma111", "#2867c8", 2);
  plot("price", "#16878c", 1.6);

  ctx.fillStyle = "#667085";
  ctx.font = "12px system-ui";
  ctx.fillText(money(max), 0, top + 8);
  ctx.fillText(money(min), 0, top + chartH);
  ctx.fillText(points[0].date, left, 252);
  ctx.fillText(metrics.latest.date, left + chartW - 72, 252);
}

function renderTable(metrics) {
  const rows = [
    ["Pi Ratio", metrics.piRatio.toFixed(3), "<0.85 / 0.85-0.95 / 0.95-1 / >=1", metrics.risk.label, "周期顶部风险"],
    ["111DMA", money(metrics.ma111), "上穿 2 x 350DMA", metrics.piRatio >= 1 ? "触发" : "未触发", "Pi 快线"],
    ["2 x 350DMA", money(metrics.ma350x2), "被 111DMA 上穿", metrics.piRatio >= 0.85 ? "需观察" : "距离较远", "Pi 慢线"],
    ["200DMA", money(metrics.ma200d), "价格跌破需防守", metrics.dmaDistance >= 0 ? "站上" : "跌破", "中长期趋势"],
    ["200WMA", money(metrics.ma200w), "周期底部参考", metrics.wmaDistance >= 0 ? "站上" : "跌破", "大周期估值"],
    ["Funding", pct(metrics.fundingRate, 4), ">0.03% 偏热，>0.08% 过热", metrics.derivScore >= 60 ? "偏热" : "正常", "杠杆拥挤度"],
    ["Open Interest", `${metrics.openInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })} BTC`, "结合价格和 funding 判断", "跟踪", "清算风险"],
  ];

  $("metricTable").innerHTML = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
}

function render(data) {
  const metrics = computeMetrics(data);
  const riskClass = metrics.risk.cls;

  $("dataStatus").textContent = data.snapshot ? "本地快照" : "实时数据";
  $("riskLabel").textContent = metrics.risk.label;
  $("riskLabel").className = riskClass;
  $("riskCopy").textContent = metrics.risk.copy;
  $("price").textContent = money(metrics.latest.close);
  $("priceDate").textContent = metrics.latest.date;
  $("piRatio").textContent = metrics.piRatio.toFixed(3);
  $("piGap").textContent = `距离交叉 ${pct((metrics.piRatio - 1) * 100)}`;
  $("funding").textContent = pct(metrics.fundingRate, 4);
  $("fundingNote").textContent = `OI ${metrics.openInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })} BTC`;

  setBar("piBar", metrics.risk.score);
  $("piState").textContent = metrics.risk.label;
  $("piState").className = riskClass;

  const dmaScore = Math.min(100, Math.max(5, 50 + metrics.dmaDistance));
  setBar("dmaBar", dmaScore);
  $("dmaState").textContent = `${pct(metrics.dmaDistance, 1)}`;

  const wmaScore = Math.min(100, Math.max(5, 45 + metrics.wmaDistance / 2));
  setBar("wmaBar", wmaScore);
  $("wmaState").textContent = `${pct(metrics.wmaDistance, 1)}`;

  setBar("derivBar", metrics.derivScore);
  $("derivState").textContent = metrics.derivScore >= 85 ? "过热" : metrics.derivScore >= 60 ? "偏热" : "正常";

  $("sourceLine").textContent = `Source: ${data.source}, latest ${metrics.latest.date}`;
  drawChart(metrics.rows, metrics);
  renderTable(metrics);
}

async function boot() {
  $("dataStatus").textContent = "加载中";
  try {
    const data = await loadData();
    render(data);
  } catch (error) {
    $("dataStatus").textContent = "加载失败";
    $("riskLabel").textContent = "数据不可用";
    $("riskCopy").textContent = error.message;
  }
}

$("refreshBtn").addEventListener("click", boot);
window.addEventListener("resize", () => boot());
boot();
