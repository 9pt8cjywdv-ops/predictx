/* GENESIS AI administrator dashboard. No external dependencies. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (v, d = 2) => (v < 0 ? "-$" : "$") + Math.abs(+v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const usdShort = (v) => { const a = Math.abs(v); return a >= 1e6 ? usd(v / 1e6, 1) + "M" : a >= 1e3 ? usd(v / 1e3, 1) + "k" : usd(v, a < 10 ? 2 : 0); };
  const pct = (v) => (v * 100).toFixed(1) + "%";
  const signCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const dt = (s) => (s ? s.replace("T", " ").slice(0, 16) : "—");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
    lget(k) { try { return localStorage.getItem(k); } catch { return null; } },
    lset(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  let token = store.get("genesis_token");
  let role = null;
  let tab = "overview";
  let settings = null;
  let selectedAgent = null;
  let cache = {};
  let lbSort = { key: "net_profit", dir: -1 };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { logout(); throw new Error("unauthorised"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
    return data;
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 4000);
  }
  async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); await refresh(true); return r; } catch (e) { toast("⚠ " + e.message); } }

  // ------------------------------------------------------------- auth
  async function login(t) {
    token = t;
    const r = await api("/api/whoami");
    role = r.role; store.set("genesis_token", t);
    document.body.classList.toggle("role-viewer", role !== "admin");
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    settings = await api("/api/settings");
    initStatic(); refresh(true);
  }
  function logout() { store.del("genesis_token"); token = null; $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await login($("#token").value.trim()); } catch (err) { $("#login-error").textContent = "Invalid token"; }
  });
  $("#logout").addEventListener("click", logout);

  // theme
  const applyTheme = (t) => { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); };
  applyTheme(store.lget("genesis_theme"));
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark"; applyTheme(next); store.lset("genesis_theme", next); renderTab();
  });

  // tabs
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) switchTab(g.dataset.goto); });
  function switchTab(t) {
    tab = t; $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    $$(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + t));
    store.lset("genesis_tab", t); refresh(true);
  }

  // ------------------------------------------------------------- tooltip
  const tip = $("#tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.remove("hidden");
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => tip.classList.add("hidden");

  // ------------------------------------------------------------- charts
  const NS = "http://www.w3.org/2000/svg";
  function niceTicks(min, max, n = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function lineChart(el, { x, series, yfmt = usdShort }) {
    el.innerHTML = "";
    if (!x.length) { el.innerHTML = '<div class="empty">No data yet — advance the simulation or wait for the first daily snapshot.</div>'; return; }
    const W = el.clientWidth || 600, H = 240, m = { l: 52, r: W < 480 ? 76 : 86, t: 10, b: 24 };
    const all = series.flatMap((s) => s.values);
    const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = (i) => m.l + (x.length === 1 ? (W - m.l - m.r) / 2 : (i / (x.length - 1)) * (W - m.l - m.r));
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(", "))} over time">`;
    ticks.forEach((t) => { svg += `<line class="${t === 0 ? "baseline" : "gridline"}" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(yfmt(t))}</text>`; });
    const every = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor((W - m.l - m.r) / 64))));
    x.forEach((d, i) => { if (i % every === 0 && (x.length - 1 - i >= every / 2 || i === x.length - 1)) svg += `<text class="tick" x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(d.slice(5))}</text>`; });
    const labelYs = [];
    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      let ly = Y(s.values[s.values.length - 1]) + 4;
      labelYs.forEach((o) => { if (Math.abs(o - ly) < 13) ly = o + (ly >= o ? 13 : -13); });
      labelYs.push(ly);
      svg += `<text class="dlabel" x="${W - m.r + 6}" y="${ly}">${esc(s.name.split(" ")[0])} ${esc(yfmt(s.values[s.values.length - 1]))}</text>`;
    });
    svg += `<line class="crosshair" id="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
    series.forEach((s, k) => { svg += `<circle id="xh-dot-${k}" r="4" fill="${s.color}" stroke="${css("--surface")}" stroke-width="2" visibility="hidden"/>`; });
    svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hit"/></svg>`;
    el.innerHTML = `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` + svg;
    const root = el.querySelector("svg"), hit = root.querySelector("#hit"), xh = root.querySelector("#xh");
    hit.addEventListener("mousemove", (e) => {
      const r = root.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(x.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (x.length - 1))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
      series.forEach((s, k) => { const c = root.querySelector("#xh-dot-" + k); c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(s.values[i])); c.setAttribute("visibility", "visible"); });
      showTip(`<div><b>${esc(x[i])}</b></div>` + series.map((s) => `<div class="row"><span><i class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:5px"></i>${esc(s.name)}</span><b>${esc(usd(s.values[i]))}</b></div>`).join(""), e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); xh.setAttribute("visibility", "hidden"); series.forEach((_, k) => root.querySelector("#xh-dot-" + k).setAttribute("visibility", "hidden")); });
  }

  function groupedBars(el, { x, series }) {
    el.innerHTML = "";
    if (!x.length) { el.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const W = el.clientWidth || 600, H = 240, m = { l: 52, r: 8, t: 10, b: 24 };
    const ticks = niceTicks(0, Math.max(0.01, ...series.flatMap((s) => s.values)));
    const y1 = ticks[ticks.length - 1];
    const Y = (v) => m.t + (1 - v / y1) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / x.length, gap = 2, bw = Math.max(2, Math.min(18, (band - 4) / series.length - gap));
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="daily revenue and expenses">`;
    ticks.forEach((t) => { svg += `<line class="${t === 0 ? "baseline" : "gridline"}" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(usdShort(t))}</text>`; });
    const every = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor((W - m.l - m.r) / 56))));
    x.forEach((d, i) => {
      const cx = m.l + band * i + band / 2, start = cx - (series.length * (bw + gap) - gap) / 2;
      series.forEach((s, k) => {
        const v = s.values[i], h = Math.max(0, Y(0) - Y(v)), bx = start + k * (bw + gap);
        if (h > 0) svg += `<path d="M${bx},${Y(0)} V${Y(v) + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)} H${bx + bw - Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} V${Y(0)} Z" fill="${s.color}"/>`;
      });
      svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${H - m.t - m.b}" fill="transparent"/>`;
      if (i % every === 0) svg += `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.slice(5))}</text>`;
    });
    svg += "</svg>";
    el.innerHTML = `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` + svg;
    $$(".hit", el).forEach((r) => {
      r.addEventListener("mousemove", (e) => { const i = +r.dataset.i; showTip(`<div><b>${esc(x[i])}</b></div>` + series.map((s) => `<div class="row"><span>${esc(s.name)}</span><b>${esc(usd(s.values[i]))}</b></div>`).join(""), e.clientX, e.clientY); });
      r.addEventListener("mouseleave", hideTip);
    });
  }

  function hbars(el, rows, color, fmt = usd) {
    el.innerHTML = "";
    if (!rows.length) { el.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const W = el.clientWidth || 500, rowH = 26, m = { l: 120, r: 70 }, H = rows.length * rowH + 4;
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bar chart">`;
    rows.forEach((r, i) => {
      const y = i * rowH + 4, w = Math.max(0, (Math.max(0, r.value) / max) * (W - m.l - m.r));
      svg += `<text class="tick" x="${m.l - 8}" y="${y + 13}" text-anchor="end">${esc(r.label)}</text>`;
      if (w > 0) svg += `<path d="M${m.l},${y} H${m.l + w - Math.min(4, w)} q${Math.min(4, w)},0 ${Math.min(4, w)},4 V${y + 14} q0,4 -${Math.min(4, w)},4 H${m.l} Z" fill="${color}"/>`;
      svg += `<text class="dlabel" x="${m.l + w + 6}" y="${y + 13}">${esc(fmt(r.value))}</text>`;
      svg += `<rect class="hit" data-i="${i}" x="0" y="${y - 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
    });
    el.innerHTML = svg + "</svg>";
    $$(".hit", el).forEach((h) => {
      h.addEventListener("mousemove", (e) => { const r = rows[+h.dataset.i]; showTip(`<div class="row"><span>${esc(r.label)}</span><b>${esc(fmt(r.value))}</b></div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ""}`, e.clientX, e.clientY); });
      h.addEventListener("mouseleave", hideTip);
    });
  }

  // ------------------------------------------------------------- renderers
  function kpi(label, value, sub = "", cls = "") {
    return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function renderOverview() {
    const o = cache.overview; if (!o) return;
    $("#empty-state").classList.toggle("hidden", o.total_agents > 0);
    $("#kpis").innerHTML = [
      kpi("Active agents", o.active_agents, `${o.total_agents} created · ${o.terminated_agents} terminated · gen ${o.max_generation}`),
      kpi("Net assets", usd(o.net_assets), `incl. unrealized ${usd(o.net_assets_incl_unrealized)}`),
      kpi("Realized net profit", usd(o.realized_net_profit), `unrealized ${usd(o.unrealized_pnl)}`, signCls(o.realized_net_profit)),
      kpi("External revenue", usd(o.total_revenue), `trading P&L ${usd(o.trading_pnl_realized)}`),
      kpi("Operating expenses", usd(o.total_expenses), `owed to operator ${usd(o.operator_payable)}`),
      kpi("Capital invested", usd(o.initial_investment + o.additional_contributions), `initial ${usd(o.initial_investment)} · added ${usd(o.additional_contributions)}`),
      kpi("Treasury / agent capital", usd(o.treasury_balance), `agents hold ${usd(o.agent_capital)}`),
      kpi("Distributed to you", usd(o.total_distributions), `distributable now ${usd(o.distributable_now)}`),
    ].join("");
    $("#next-dist").textContent = o.next_distribution_local ? "next: " + o.next_distribution_local : "";
    const ts = cache.timeseries || [];
    lineChart($("#chart-assets"), {
      x: ts.map((r) => r.day),
      series: [
        { name: "Net assets", values: ts.map((r) => r.net_assets), color: css("--series-1") },
        { name: "Realized profit (cumulative)", values: ts.map((r) => r.realized_net_profit), color: css("--series-2") },
      ],
    });
    const ds = cache.distributions || [];
    $("#dist-table").innerHTML = ds.length ? '<div class="table-wrap">' + table(
      ["Week ending", "Status", "Profit", "Distributable", "To you", "Retained"],
      ds.slice(0, 8).map((d) => [dt(d.period_end).slice(0, 10), statusLabel(d.status), num(d.period_profit, true), num(d.distributable), num(d.owner_amount), num(d.retained_amount)]),
      [false, false, true, true, true, true]) + "</div>" : '<div class="empty">No accounting week has closed yet.</div>';
    const lb = (cache.agents || []).filter((a) => a.status !== "deceased").slice(0, 5);
    $("#top-agents").innerHTML = lb.length ? '<div class="table-wrap">' + leaderboardTable(lb, false) + "</div>" : '<div class="empty">No living agents.</div>';
    bindAgentRows($("#top-agents"));
  }

  const num = (v, signed = false) => ({ html: `<span class="${signed ? signCls(v) : ""}">${esc(usd(v))}</span>`, num: true });
  const statusLabel = (s) => esc(String(s).replace(/_/g, " "));
  function table(heads, rows, numeric = []) {
    return `<table><thead><tr>${heads.map((h, i) => `<th class="${numeric[i] ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numeric[i] ? "num" : ""}">${typeof c === "object" && c ? c.html : c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  const LB_COLS = [
    ["id", "Agent"], ["generation", "Gen"], ["parent_id", "Parent"], ["age_days", "Age (d)"], ["strategy", "Strategy"],
    ["starting_capital", "Start"], ["net_capital", "Net capital"], ["revenue", "Revenue"], ["expenses", "Expenses"],
    ["net_profit", "Net profit"], ["roc", "ROC"], ["reproduction_count", "Births"], ["next_threshold", "Next threshold"], ["status", "Status"],
  ];
  const NUMERIC = new Set(["generation", "age_days", "starting_capital", "net_capital", "revenue", "expenses", "net_profit", "roc", "reproduction_count", "next_threshold"]);
  function leaderboardTable(rows, sortable) {
    const cell = (a, k) => {
      const v = a[k];
      if (k === "status") return `<span class="status ${esc(v)}">${esc(v)}</span>`;
      if (k === "strategy") return `${esc(v)} <span class="muted small">${esc(a.market || "")}</span>`;
      if (k === "roc") return `<span class="${signCls(v)}">${pct(v)}</span>`;
      if (["starting_capital", "net_capital", "revenue", "expenses", "net_profit", "next_threshold"].includes(k)) return `<span class="${k === "net_profit" ? signCls(v) : ""}">${esc(usd(v))}</span>`;
      return esc(v ?? "—");
    };
    return `<table><thead><tr>${LB_COLS.map(([k, l]) => `<th class="${NUMERIC.has(k) ? "num" : ""} ${sortable ? "sortable" : ""}" data-k="${k}">${esc(l)}${sortable && lbSort.key === k ? (lbSort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>${rows.map((a) => `<tr class="clickable ${a.status === "deceased" ? "dead" : ""}" data-agent="${esc(a.id)}">${LB_COLS.map(([k]) => `<td class="${NUMERIC.has(k) ? "num" : ""}">${cell(a, k)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function bindAgentRows(root) {
    $$("tr[data-agent]", root).forEach((tr) => tr.addEventListener("click", () => { selectedAgent = tr.dataset.agent; switchTab("agents"); }));
  }

  function renderAgents() {
    let rows = (cache.agents || []).slice();
    if (!$("#show-dead").checked) rows = rows.filter((a) => a.status !== "deceased");
    rows.sort((a, b) => { const x = a[lbSort.key], y = b[lbSort.key]; return (x > y ? 1 : x < y ? -1 : 0) * lbSort.dir; });
    $("#leaderboard").innerHTML = rows.length ? leaderboardTable(rows, true) : '<div class="empty">No agents yet.</div>';
    $$("#leaderboard th.sortable").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; lbSort = { key: k, dir: lbSort.key === k ? -lbSort.dir : -1 }; renderAgents(); }));
    bindAgentRows($("#leaderboard"));
    renderAgentDetail();
  }

  async function renderAgentDetail() {
    const el = $("#agent-detail");
    if (!selectedAgent) { el.classList.add("hidden"); return; }
    let a;
    try { a = await api("/api/agents/" + encodeURIComponent(selectedAgent)); } catch { return; }
    const f = a.financials;
    const stat = (l, v) => `<div><div class="label">${esc(l)}</div><div class="value">${v}</div></div>`;
    const actions = a.status === "deceased" ? "" : `<div class="btn-row admin-only">
      ${a.status === "active" ? `<button class="btn" data-agent-act="suspend">Suspend</button>` : `<button class="btn" data-agent-act="resume">Resume</button>`}
      <button class="btn danger" data-agent-act="terminate">Terminate</button></div>`;
    el.innerHTML = `<div class="card-head"><h3>${esc(a.id)} · <span class="status ${esc(a.status)}">${esc(a.status)}</span></h3><button class="btn ghost small" id="close-detail">Close</button></div>
      <p class="muted">${esc(a.objective || "")}</p>
      ${a.status_reason ? `<p class="small">Reason: ${esc(a.status_reason)}</p>` : ""}
      <div class="detail-grid">
        ${stat("Generation", a.generation)}${stat("Parent", esc(a.parent_id || "—"))}${stat("Children", esc(a.children.join(", ") || "—"))}
        ${stat("Strategy", esc(a.strategy))}${stat("Market", esc(a.market))}${stat("Risk tolerance", esc(a.risk_tolerance))}
        ${stat("Available", usd(f.available))}${stat("Net capital", usd(f.net_capital))}${stat("Revenue", usd(f.revenue))}
        ${stat("Expenses", usd(f.expenses))}${stat("Net profit", `<span class="${signCls(f.net_profit)}">${usd(f.net_profit)}</span>`)}${stat("Unrealized", usd(f.unrealized))}
        ${stat("Next reproduction", usd(a.next_threshold))}${stat("Model calls / cost", `${a.model_calls} · ${usd(a.model_cost, 4)}`)}${stat("Brain", esc(a.decision_config?.brain || ""))}
      </div>
      ${actions}
      ${a.reproduction_blockers?.length ? `<p class="small muted">Reproduction: ${a.reproduction_blockers.map(esc).join("; ")}</p>` : ""}
      <h4>Parameters</h4><div>${Object.entries(a.params || {}).map(([k, v]) => `<span class="chip">${esc(k)}: ${esc(Math.round(v * 1000) / 1000)}</span>`).join("") || '<span class="muted">none</span>'}</div>
      <h4>Strategy state</h4><pre class="small muted">${esc(JSON.stringify(a.strategy_state || {}, null, 1)).slice(0, 600)}</pre>
      <h4>Opportunities (evaluation pipeline)</h4>
      ${table(["Opportunity", "Status", "Assessment"], a.opportunities.map((o) => [esc(o.title), statusLabel(o.status), esc(`${o.assessment.feasibility}; exp. revenue/day $${o.assessment.expected_revenue_per_day_usd} (${o.assessment.expected_revenue_basis})`)]))}
      <h4>Experiment history</h4>
      ${a.experiments.length ? table(["Strategy", "Market", "Days", "Revenue", "Costs", "Profit"], a.experiments.slice().reverse().map((e) => [esc(e.strategy), esc(e.market), e.days, num(e.revenue / 1e6), num(e.costs / 1e6), num(e.profit / 1e6, true)]), [false, false, true, true, true, true]) : '<p class="muted small">No completed experiments.</p>'}
      <h4>Lessons</h4>${a.memory.length ? a.memory.map((m) => `<div class="small">• ${esc(m.content)}</div>`).join("") : '<p class="muted small">None recorded.</p>'}
      <h4>Recent activity</h4><div class="feed">${a.events.map(evRow).join("")}</div>`;
    el.classList.remove("hidden");
    $("#close-detail").onclick = () => { selectedAgent = null; el.classList.add("hidden"); };
    $$("[data-agent-act]", el).forEach((b) => b.addEventListener("click", () => {
      const action = b.dataset.agentAct;
      if (action === "terminate" && !confirm(`Terminate ${a.id}? Its remaining capital returns to the treasury. This cannot be undone.`)) return;
      act(() => api(`/api/agents/${a.id}/${action}`, { method: "POST", body: { reason: "administrator action via dashboard" } }), `${a.id}: ${action}`).then(renderAgentDetail);
    }));
  }

  const evRow = (e) => `<div class="ev"><span class="t">${esc(dt(e.ts))}</span><span class="small muted">${esc(e.agent_id || "core")} · ${esc(e.type)}</span><span class="sev-${esc(e.severity)}">${esc(e.summary)}</span></div>`;

  function renderTree() {
    const nodes = (cache.tree && cache.tree.nodes) || [];
    $("#tree-legend").innerHTML = `<span><span class="status active">living</span></span><span><span class="status suspended">suspended</span></span><span><span class="status deceased">terminated</span></span>`;
    const el = $("#tree");
    if (!nodes.length) { el.innerHTML = '<div class="empty">No agents yet.</div>'; return; }
    const kids = {}; nodes.forEach((n) => { (kids[n.parent || "_root"] = kids[n.parent || "_root"] || []).push(n); });
    const NW = 140, NH = 40, GX = 14, GY = 56; let leaf = 0; const pos = {};
    // Tidy tree: leaves get consecutive slots, parents centre over their children.
    const layout = (n, depth) => {
      const ch = kids[n.id] || [];
      if (!ch.length) { pos[n.id] = { x: leaf++ * (NW + GX), y: depth * (NH + GY) }; return; }
      ch.forEach((c) => layout(c, depth + 1));
      pos[n.id] = { x: (pos[ch[0].id].x + pos[ch[ch.length - 1].id].x) / 2, y: depth * (NH + GY) };
    };
    (kids._root || []).forEach((r) => layout(r, 0));
    const W = Math.max(...Object.values(pos).map((p) => p.x)) + NW + 20, H = Math.max(...Object.values(pos).map((p) => p.y)) + NH + 20;
    let svg = `<svg width="${W}" height="${H}" viewBox="-10 -10 ${W} ${H}" role="img" aria-label="agent family tree">`;
    nodes.forEach((n) => { if (n.parent && pos[n.parent]) { const p = pos[n.parent], c = pos[n.id]; svg += `<path class="edge" d="M${p.x + NW / 2},${p.y + NH} C${p.x + NW / 2},${p.y + NH + GY / 2} ${c.x + NW / 2},${c.y - GY / 2} ${c.x + NW / 2},${c.y}"/>`; } });
    nodes.forEach((n) => { const p = pos[n.id]; svg += `<g class="node ${esc(n.status)}" data-agent="${esc(n.id)}" transform="translate(${p.x},${p.y})"><rect width="${NW}" height="${NH}"/><text x="8" y="16" font-weight="600">${esc(n.id)}${n.status === "deceased" ? " †" : ""}</text><text x="8" y="31" class="small">G${n.generation} · ${esc(n.strategy)}</text></g>`; });
    el.innerHTML = svg + "</svg>";
    $$(".node", el).forEach((g) => {
      g.addEventListener("click", () => { selectedAgent = g.dataset.agent; switchTab("agents"); });
      g.addEventListener("mousemove", (e) => { const a = (cache.agents || []).find((x) => x.id === g.dataset.agent); if (a) showTip(`<b>${esc(a.id)}</b> · ${esc(a.status)}<div class="row"><span>Net capital</span><b>${esc(usd(a.net_capital))}</b></div><div class="row"><span>Net profit</span><b>${esc(usd(a.net_profit))}</b></div><div class="row"><span>Births</span><b>${a.reproduction_count}</b></div>`, e.clientX, e.clientY); });
      g.addEventListener("mouseleave", hideTip);
    });
  }

  function renderFinance() {
    const ts = (cache.timeseries || []).slice(-30);
    groupedBars($("#chart-daily"), {
      x: ts.map((r) => r.day),
      series: [{ name: "Revenue", values: ts.map((r) => Math.max(0, r.day_revenue)), color: css("--series-1") },
               { name: "Expenses", values: ts.map((r) => Math.max(0, r.day_expenses)), color: css("--series-2") }],
    });
    const costs = cache.costs ? Object.entries(cache.costs.by_category).filter(([k]) => k !== "trading_loss").map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v })).sort((a, b) => b.value - a.value) : [];
    hbars($("#chart-costs"), costs, css("--series-1"), (v) => usd(v, v < 1 ? 4 : 2));
    const alloc = (cache.agents || []).filter((a) => a.status !== "deceased").map((a) => ({ label: a.id, value: a.net_capital, note: `${a.strategy} · ${a.market}` })).sort((a, b) => b.value - a.value).slice(0, 20);
    hbars($("#chart-alloc"), alloc, css("--series-1"));
    const tr = cache.transfers || [];
    $("#transfers").innerHTML = tr.length ? table(["When", "Kind", "Amount", "To", "Status", "Tx"], tr.slice(0, 12).map((t) => [esc(dt(t.created_at)), esc(t.kind), num(t.amount), esc(t.to.slice(0, 12) + "…"), esc(t.status + (t.simulated ? " (simulated)" : "")), esc((t.tx_hash || "").slice(0, 14))]), [false, false, true]) : '<div class="empty">No external transfers yet.</div>';
    const txs = cache.txs || [];
    $("#txs").innerHTML = txs.length ? table(["#", "When", "Kind", "Agent", "Amount", "Description", "Source"], txs.map((t) => [t.id, esc(dt(t.ts)), esc(t.kind), esc(t.agent_id || "—"), num(t.amount), esc(t.description), esc(t.evidence || (t.simulated ? "sim" : ""))]), [true, false, false, false, true]) : '<div class="empty">No transactions.</div>';
  }

  function renderActivity() { $("#events").innerHTML = (cache.events || []).map(evRow).join("") || '<div class="empty">No activity yet.</div>'; }

  function renderApprovals() {
    const aps = cache.approvals || [];
    $("#approvals").innerHTML = aps.length ? aps.map((a) => `<div class="approval"><div class="card-head"><b>${esc(a.title)}</b><span class="muted small">${esc(a.kind)} · ${esc(dt(a.created_at))}</span></div>
      <pre class="small muted">${esc(JSON.stringify(a.payload, null, 1)).slice(0, 800)}</pre>
      <div class="btn-row admin-only"><button class="btn primary" data-ap="${a.id}" data-ok="1">Approve</button><button class="btn" data-ap="${a.id}" data-ok="0">Reject</button></div></div>`).join("") : '<div class="empty">Nothing awaiting your decision.</div>';
    $$("[data-ap]").forEach((b) => b.addEventListener("click", () => act(() => api("/api/approvals/" + b.dataset.ap, { method: "POST", body: { approve: b.dataset.ok === "1" } }), "Decision recorded")));
  }

  const POLICY_FIELDS = [
    ["max_active_agents", "Max active agents"], ["max_births_per_day", "Max births per day"],
    ["max_aggregate_capital_usd", "Max aggregate capital ($)"], ["max_daily_expenditure_usd", "Max daily expenditure ($)"],
    ["max_weekly_expenditure_usd", "Max weekly expenditure ($)"], ["max_transaction_usd", "Max transaction value ($)"],
    ["auto_payout_limit_usd", "Auto-payout limit ($)"], ["owner_profit_share_bps", "Owner profit share (bps)"],
    ["first_reproduction_multiple", "First reproduction multiple"], ["subsequent_reproduction_multiple", "Subsequent multiple"],
    ["offspring_capital_usd", "Offspring capital ($)"], ["min_parent_reserve_after_reproduction_usd", "Parent reserve after birth ($)"],
    ["insolvency_floor_usd", "Insolvency floor ($)"], ["max_violations_per_day_before_suspend", "Violations before auto-suspend"],
    ["claude_max_calls_per_agent_per_day", "Model calls / agent / day"], ["planning_interval_hours", "Planning interval (h)"],
  ];
  function renderControls() {
    const s = settings; if (!s) return;
    const p = s.policy;
    if (!$("#policy-form").dataset.ready) {
      $("#policy-form").innerHTML = POLICY_FIELDS.map(([k, l]) => `<label>${esc(l)}<input type="number" step="any" data-pk="${k}" value="${esc(p[k])}"></label>`).join("") +
        Object.entries(p.agent_daily_budgets_usd).map(([k, v]) => `<label>Daily budget: ${esc(k.replace(/_/g, " "))} ($)<input type="number" step="any" data-bk="${k}" value="${esc(v)}"></label>`).join("");
      $("#policy-form").dataset.ready = "1";
    }
    const w = s.state.admin_wallet;
    $("#w-current").innerHTML = w ? `Current: <b>${esc(w.network)}</b> ${esc(w.address)}` : '<span class="muted">No wallet configured — distributions are held until one is set.</span>';
    const r = cache.readiness;
    if (r) $("#readiness").innerHTML = r.checks.map((c) => `<div class="check ${c.ok ? "ok" : "fail"}"><span class="ic">${c.ok ? "✓" : "✕"}</span><span>${esc(c.key.replace(/_/g, " "))} <span class="muted small">— ${esc(c.detail)}</span></span></div>`).join("");
    $("#sim-controls").classList.toggle("hidden", !(cache.overview && cache.overview.clock_simulated));
    $("#integrations").innerHTML = (cache.integrations || []).map((i) => `<span class="chip">${esc(i.name)} · ${esc(i.scopes.join(","))}</span>`).join("") || '<span class="muted small">No credentials stored.</span>';
  }

  function renderAudit() {
    const a = cache.audit || [];
    $("#audit").innerHTML = table(["#", "When", "Actor", "Action", "Target", "Details", "Hash"], a.map((r) => [r.id, esc(dt(r.ts)), esc(r.actor), esc(r.action), esc(r.target || ""), esc(JSON.stringify(r.details)).slice(0, 120), `<code class="small">${esc(r.hash)}</code>`]), [true]);
    const v = cache.auditVerify;
    if (v) $("#audit-verify").innerHTML = v.ok ? `<span class="pos">✓ chain intact (${v.checked} records)</span>` : `<span class="neg">✕ chain broken at #${v.broken_at}</span>`;
  }

  function renderTab() {
    ({ overview: renderOverview, agents: renderAgents, tree: renderTree, finance: renderFinance, activity: renderActivity,
       approvals: renderApprovals, controls: renderControls, audit: renderAudit })[tab]();
  }

  function renderChrome() {
    const o = cache.overview; if (!o) return;
    const b = $("#mode-badge"); b.textContent = o.mode === "live" ? "LIVE" : "SIMULATION"; b.classList.toggle("live", o.mode === "live");
    $("#clock").textContent = (o.clock_simulated ? "sim clock " : "") + dt(o.ts) + " UTC";
    $("#approval-count").textContent = o.pending_approvals || "";
    const ban = $("#banner");
    if (o.emergency_stop) { ban.className = "banner crit"; ban.textContent = "■ Emergency stop engaged — all agent activity and payouts are halted."; }
    else if (o.paused) { ban.className = "banner warn"; ban.textContent = "▲ Ecosystem paused — agents are not running."; }
    else if (o.pending_approvals) { ban.className = "banner warn"; ban.innerHTML = `▲ ${o.pending_approvals} item(s) await your decision — payouts above the auto-payout limit are held until approved. <button class="btn small" data-goto="approvals">Review</button>`; }
    else if (!o.admin_wallet && o.total_agents) { ban.className = "banner warn"; ban.textContent = "▲ No administrator wallet configured; weekly distributions will be held. Set one under Controls."; }
    else ban.className = "banner hidden";
  }

  // ------------------------------------------------------------- data loading
  let loading = false;
  async function refresh(force = false) {
    if (!token || (loading && !force)) return;
    loading = true;
    try {
      const need = { overview: "/api/overview" };
      if (tab === "overview") Object.assign(need, { timeseries: "/api/timeseries?days=120", distributions: "/api/distributions", agents: "/api/agents" });
      if (tab === "agents" || tab === "tree") Object.assign(need, { agents: "/api/agents", tree: "/api/tree" });
      if (tab === "finance") Object.assign(need, { timeseries: "/api/timeseries?days=30", agents: "/api/agents", costs: "/api/costs?days=" + $("#cost-window").value, transfers: "/api/transfers", txs: "/api/transactions?limit=60" + ($("#tx-kind").value ? "&kind=" + $("#tx-kind").value : "") });
      if (tab === "activity") need.events = "/api/events?limit=200" + ($("#ev-sev").value ? "&severity=" + $("#ev-sev").value : "");
      if (tab === "approvals") need.approvals = "/api/approvals";
      if (tab === "controls") { need.readiness = "/api/live/readiness"; if (role === "admin") need.integrations = "/api/integrations"; }
      if (tab === "audit") Object.assign(need, { audit: "/api/audit?limit=200", auditVerify: "/api/audit/verify" });
      const entries = await Promise.all(Object.entries(need).map(async ([k, u]) => [k, await api(u)]));
      entries.forEach(([k, v]) => { cache[k] = v; });
      renderChrome(); renderTab();
    } catch (e) { if (e.message !== "unauthorised") console.warn(e); }
    finally { loading = false; }
  }

  function initStatic() {
    const strat = settings.strategies;
    $("#g-strategy").innerHTML = settings.policy.enabled_strategies.filter((k) => strat[k] && k !== "conservation").map((k) => `<option value="${esc(k)}">${esc(strat[k].name)}</option>`).join("");
    const fillMarkets = () => { const k = $("#g-strategy").value; $("#g-market").innerHTML = '<option value="">random (unbiased)</option>' + (strat[k]?.markets || []).map((m) => `<option>${esc(m)}</option>`).join(""); };
    $("#g-strategy").onchange = fillMarkets; fillMarkets();
    $("#w-network").innerHTML = settings.networks.map((n) => `<option ${n === settings.state.network ? "selected" : ""}>${esc(n)}</option>`).join("");
    $("#tx-kind").innerHTML = '<option value="">all kinds</option>' + ["revenue", "expense", "trade_buy", "trade_sell", "reproduction_funding", "profit_distribution", "operator_reimbursement", "capital_contribution", "capital_allocation", "estate_sweep", "internal_transfer"].map((k) => `<option>${k}</option>`).join("");
  }

  // ------------------------------------------------------------- admin actions
  $("#g-create").addEventListener("click", () => act(() => api("/api/genesis", { method: "POST", body: { strategy_key: $("#g-strategy").value, market: $("#g-market").value || null, fund_usd: +$("#g-fund").value } }), "Agent 001 created"));
  $$("[data-control]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.control;
    if (c === "emergency-stop" && !confirm("Engage emergency stop? All agents halt and live mode is deactivated.")) return;
    act(() => api("/api/control/" + c, { method: "POST", body: { reason: "dashboard" } }), c.replace("-", " ") + " ✓");
  }));
  $$("[data-advance]").forEach((b) => b.addEventListener("click", async () => {
    $$("[data-advance]").forEach((x) => (x.disabled = true));
    await act(() => api("/api/sim/advance", { method: "POST", body: { hours: +b.dataset.advance } }), "Simulation advanced");
    $$("[data-advance]").forEach((x) => (x.disabled = false));
  }));
  $("#reconcile").addEventListener("click", async () => { const r = await act(() => api("/api/treasury/reconcile", { method: "POST" }), "Reconciliation complete"); if (r) $("#reconcile-out").textContent = JSON.stringify(r, null, 1); });
  $("#run-dist").addEventListener("click", () => { if (confirm("Close the accounting period now and run the distribution?")) act(() => api("/api/distributions/run", { method: "POST" }), "Distribution computed"); });
  $("#w-save").addEventListener("click", async () => { await act(() => api("/api/settings/admin-wallet", { method: "PUT", body: { address: $("#w-address").value.trim(), network: $("#w-network").value } }), "Wallet saved"); settings = await api("/api/settings"); renderControls(); });
  $("#live-activate").addEventListener("click", () => act(() => api("/api/live/activate", { method: "POST", body: { phrase: $("#live-phrase").value } }), "Live mode activated"));
  $("#confirm-limits").addEventListener("click", () => act(() => api("/api/settings/confirm-limits", { method: "POST" }), "Limits confirmed"));
  $("#save-policy").addEventListener("click", async () => {
    const changes = {}; const p = settings.policy;
    $$("[data-pk]").forEach((i) => { const v = +i.value; if (v !== p[i.dataset.pk]) changes[i.dataset.pk] = v; });
    const budgets = {}; $$("[data-bk]").forEach((i) => { const v = +i.value; if (v !== p.agent_daily_budgets_usd[i.dataset.bk]) budgets[i.dataset.bk] = v; });
    if (Object.keys(budgets).length) changes.agent_daily_budgets_usd = budgets;
    if (!Object.keys(changes).length) return toast("No changes");
    await act(() => api("/api/settings/policy", { method: "PUT", body: { changes } }), "Policy updated");
    settings = await api("/api/settings"); $("#policy-form").dataset.ready = ""; renderControls();
  });
  $("#i-save").addEventListener("click", () => act(() => api("/api/integrations", { method: "PUT", body: { name: $("#i-name").value.trim(), value: $("#i-value").value, scopes: $("#i-scopes").value.split(",").map((x) => x.trim()).filter(Boolean) } }), "Credential stored").then(() => { $("#i-value").value = ""; }));
  ["#show-dead"].forEach((s) => $(s).addEventListener("change", renderAgents));
  ["#cost-window", "#tx-kind", "#ev-sev"].forEach((s) => $(s).addEventListener("change", () => refresh(true)));
  addEventListener("resize", () => { clearTimeout(refresh._r); refresh._r = setTimeout(renderTab, 150); });

  // ------------------------------------------------------------- boot
  tab = store.lget("genesis_tab") || "overview";
  if (token) login(token).then(() => switchTab(tab)).catch(() => logout()); else $("#login").classList.remove("hidden");
  setInterval(() => { if (!document.hidden && tab !== "controls") refresh(); }, 5000);
})();
