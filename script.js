/* Ohm’s Law Pro (vanilla JS)
   Updated: Power is ALWAYS displayed as decimal watts (e.g. 0.5 W), no mW/kW prefixes.
   Current is displayed smartly as mA when |I| < 1 A (mA) otherwise A.
*/

const $ = (sel) => document.querySelector(sel);

const inputs = {
  V: $("#inV"),
  I: $("#inI"),
  R: $("#inR"),
  P: $("#inP"),
};

const out = {
  V: $("#outV"), rawV: $("#rawV"),
  I: $("#outI"), rawI: $("#rawI"), unitI: $("#unitI"),
  R: $("#outR"), rawR: $("#rawR"),
  P: $("#outP"), rawP: $("#rawP"),
  Wh: $("#outWh"),
  Ima: $("#outIma"),
  notes: $("#notes"),
};

// Optional unit spans if you added them in HTML (safe if not present)
out.unitV = $("#unitV");
out.unitR = $("#unitR");
out.unitP = $("#unitP");

const statusEl = $("#status");
const branchSelect = $("#branchSelect");
const autoSolve = $("#autoSolve");

const btnSolve = $("#btnSolve");
const btnClear = $("#btnClear");
const btnCopy = $("#btnCopy");
const btnTheme = $("#btnTheme");

const historyList = $("#historyList");
const btnClearHistory = $("#btnClearHistory");

const capmAh = $("#capmAh");
const drawmA = $("#drawmA");
const batV = $("#batV");
const btnBattery = $("#btnBattery");
const btnBatteryClear = $("#btnBatteryClear");

const batHours = $("#batHours");
const batAh = $("#batAh");
const batWh = $("#batWh");

// ---------------------
// Theme + tabs
// ---------------------

function loadTheme() {
  const t = localStorage.getItem("ohms_theme") || "dark";
  document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ohms_theme", next);
}
btnTheme?.addEventListener("click", toggleTheme);
loadTheme();

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.remove("show"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("#tab-" + tab)?.classList.add("show");
  });
});

// ---------------------
// Parsing + formatting
// ---------------------

const SI = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "µ": 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.style.color = type === "error"
    ? "var(--bad)"
    : type === "warn"
      ? "var(--warn)"
      : "var(--muted)";
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Parse engineering numbers:
 * - suffixes p n µ/u m k M G
 * - resistor notation: 4R7, 2K2, 1M0
 * - ignores unit letters: V A W Ω ohm
 */
function parseEng(s) {
  if (s == null) throw new Error("Empty");
  let t = String(s).trim();
  if (!t) throw new Error("Empty");

  t = t.replaceAll(",", "");
  t = t.replace(/ohms?/gi, "");
  t = t.replaceAll("Ω", "");
  t = t.replace(/[VvAaWw]/g, "");

  // resistor notation
  const marks = ["R", "r", "K", "k", "M", "m"];
  for (const mark of marks) {
    const idx = t.indexOf(mark);
    if (idx !== -1 && t.indexOf(mark, idx + 1) === -1) {
      const left = t.slice(0, idx) || "0";
      const right = t.slice(idx + 1) || "0";
      const leftOk = /^[-+]?\d+(\.\d+)?$/.test(left);
      const rightOk = /^\d+$/.test(right);
      if (leftOk && rightOk) {
        const base = Number(`${left}.${right}`);
        if (!Number.isFinite(base)) break;
        if (mark === "K" || mark === "k") return base * 1e3;
        if (mark === "M") return base * 1e6;
        if (mark === "m") return base * 1e-3;
        return base; // R/r
      }
    }
  }

  // suffix at end
  if (t.length >= 2) {
    const last = t[t.length - 1];
    if (last in SI) {
      const num = t.slice(0, -1).trim();
      if (!num) throw new Error("Invalid number");
      const base = Number(num);
      if (!Number.isFinite(base)) throw new Error("Invalid number");
      return base * SI[last];
    }
  }

  const v = Number(t);
  if (!Number.isFinite(v)) throw new Error("Invalid number");
  return v;
}

function nearlyEqual(a, b, rel = 1e-9, abs = 1e-12) {
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Engineering formatter (powers of 10^3) using SI prefixes.
 * Returns { valueText, prefix } without unit.
 */
function formatEngValue(x, sig = 4) {
  if (!isFiniteNumber(x)) return { valueText: "—", prefix: "" };
  if (x === 0) return { valueText: "0", prefix: "" };

  const sign = x < 0 ? "-" : "";
  x = Math.abs(x);

  let exp = Math.floor(Math.log10(x) / 3) * 3;
  exp = Math.max(-12, Math.min(9, exp));
  const scaled = x / Math.pow(10, exp);

  const prefixMap = {
    "-12": "p",
    "-9": "n",
    "-6": "µ",
    "-3": "m",
    "0": "",
    "3": "k",
    "6": "M",
    "9": "G",
  };
  const prefix = prefixMap[String(exp)] ?? "";

  let s = scaled.toPrecision(sig);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return { valueText: sign + s, prefix };
}

function formatEng(x, unit = "", sig = 4) {
  const f = formatEngValue(x, sig);
  const value = f.valueText + f.prefix;
  return unit ? `${value} ${unit}` : value;
}

/**
 * Current display rule:
 * - If |I| < 1 A -> display in mA as a decimal number (no prefixes)
 * - Otherwise display engineering in A
 */
function formatCurrentSmart(I) {
  if (!isFiniteNumber(I)) return { text: "—", unit: "A", raw: "—" };
  const absI = Math.abs(I);

  if (absI > 0 && absI < 1) {
    const mA = I * 1000;

    // Nice decimals for mA
    let s;
    const a = Math.abs(mA);
    if (a < 10) s = mA.toFixed(3);
    else if (a < 100) s = mA.toFixed(2);
    else if (a < 1000) s = mA.toFixed(1);
    else s = mA.toFixed(0);

    s = s.replace(/(\.\d*?[1-9])0+$/,"$1").replace(/\.0+$/,"");
    if (s.startsWith(".")) s = "0" + s;
    if (s.startsWith("-.")) s = s.replace("-.", "-0.");

    return {
      text: s,
      unit: "mA",
      raw: `${I.toPrecision(8)} A`,
    };
  }

  const f = formatEngValue(I, 4);
  return {
    text: f.valueText + f.prefix,
    unit: "A",
    raw: `${I.toPrecision(8)} A`,
  };
}

/**
 * Power display rule:
 * - ALWAYS show in W as a plain decimal (no prefixes like mW/kW)
 * Example: 0.5 W, 0.625 W, 12.3 W, 250 W
 */
function formatWattsDecimal(P) {
  if (!isFiniteNumber(P)) return "—";

  const a = Math.abs(P);
  let s;
  if (a < 0.001) s = P.toFixed(6);
  else if (a < 0.01) s = P.toFixed(4);
  else if (a < 0.1) s = P.toFixed(3);
  else if (a < 1) s = P.toFixed(3);
  else if (a < 10) s = P.toFixed(2);
  else if (a < 100) s = P.toFixed(1);
  else s = P.toFixed(0);

  s = s.replace(/(\.\d*?[1-9])0+$/,"$1").replace(/\.0+$/,"");
  if (s.startsWith(".")) s = "0" + s;
  if (s.startsWith("-.")) s = s.replace("-.", "-0.");
  return s;
}

// ---------------------
// Solver
// ---------------------

function solveOhmsLaw({ V, I, R, P }) {
  const known = {};
  if (V != null) known.V = V;
  if (I != null) known.I = I;
  if (R != null) known.R = R;
  if (P != null) known.P = P;

  if (Object.keys(known).length < 2) {
    throw new Error("Enter at least two values (any two of V, I, R, P).");
  }
  if (R != null && R <= 0) throw new Error("Resistance R must be > 0.");
  if (P != null && P < 0) throw new Error("Power P must be ≥ 0.");

  const sols = [];

  function addSolution(sol) {
    for (const [k, v] of Object.entries(known)) {
      if (!nearlyEqual(sol[k], v)) return;
    }
    for (const s of sols) {
      if (["V", "I", "R", "P"].every(k => nearlyEqual(s[k], sol[k]))) return;
    }
    sols.push(sol);
  }

  function from_V_I(V, I) {
    const R = V / I;
    const P = V * I;
    if (R <= 0) return;
    addSolution({ V, I, R, P });
  }
  function from_V_R(V, R) {
    const I = V / R;
    const P = V * I;
    addSolution({ V, I, R, P });
  }
  function from_I_R(I, R) {
    const V = I * R;
    const P = V * I;
    addSolution({ V, I, R, P });
  }
  function from_V_P(V, P) {
    if (V === 0) {
      if (P === 0) throw new Error("V=0 and P=0 gives infinite solutions. Provide another value.");
      throw new Error("V=0 with P>0 is impossible.");
    }
    const I = P / V;
    if (I === 0) {
      if (P === 0) throw new Error("V set but P=0 implies I=0; need R to solve uniquely.");
      throw new Error("Invalid input combination.");
    }
    const R = V / I;
    if (R <= 0) return;
    addSolution({ V, I, R, P });
  }
  function from_I_P(I, P) {
    if (I === 0) {
      if (P === 0) throw new Error("I=0 and P=0 gives infinite solutions. Provide another value.");
      throw new Error("I=0 with P>0 is impossible.");
    }
    const R = P / (I * I);
    if (R <= 0) return;
    const V = I * R;
    addSolution({ V, I, R, P });
  }
  function from_R_P(R, P) {
    if (P < 0 || R <= 0) return;
    const Vmag = Math.sqrt(P * R);
    addSolution({ V: Vmag, I: Vmag / R, R, P });
    addSolution({ V: -Vmag, I: -Vmag / R, R, P });
  }

  if (V != null && I != null) {
    if (I === 0) {
      if (V !== 0) throw new Error("V≠0 with I=0 implies infinite resistance. Provide R or P.");
      throw new Error("V=0 and I=0 gives infinite solutions. Provide another value.");
    }
    from_V_I(V, I);
  }
  if (V != null && R != null) from_V_R(V, R);
  if (I != null && R != null) from_I_R(I, R);
  if (V != null && P != null) from_V_P(V, P);
  if (I != null && P != null) from_I_P(I, P);
  if (R != null && P != null) from_R_P(R, P);

  if (!sols.length) throw new Error("No valid solution found. Check for contradictory inputs.");
  return sols;
}

// ---------------------
// UI glue
// ---------------------

let solutions = [];
let selectedIndex = 0;

function readInputs() {
  const parsed = { V: null, I: null, R: null, P: null };
  for (const k of ["V", "I", "R", "P"]) {
    const raw = inputs[k]?.value?.trim() ?? "";
    if (!raw) continue;
    parsed[k] = parseEng(raw);
  }
  return parsed;
}

function resetResults() {
  out.V.textContent = "—";
  out.I.textContent = "—";
  out.R.textContent = "—";
  out.P.textContent = "—";

  if (out.unitV) out.unitV.textContent = "V";
  out.unitI.textContent = "A";
  if (out.unitR) out.unitR.textContent = "Ω";
  if (out.unitP) out.unitP.textContent = "W";

  out.rawV.textContent = "—";
  out.rawI.textContent = "—";
  out.rawR.textContent = "—";
  out.rawP.textContent = "—";
  out.Wh.textContent = "—";
  out.Ima.textContent = "—";
  out.notes.textContent = "Enter any two values to compute the rest.";
  branchSelect.innerHTML = `<option value="">—</option>`;
  branchSelect.disabled = true;
}

function updateBranchSelector() {
  branchSelect.innerHTML = "";
  if (!solutions.length) {
    branchSelect.innerHTML = `<option value="">—</option>`;
    branchSelect.disabled = true;
    return;
  }
  solutions.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent =
      `#${idx + 1}: V ${formatEng(s.V, "V")} | I ${formatEng(s.I, "A")} | R ${formatEng(s.R, "Ω")} | P ${formatEng(s.P, "W")}`;
    branchSelect.appendChild(opt);
  });
  branchSelect.disabled = solutions.length <= 1;
  branchSelect.value = String(selectedIndex);
}

function renderSolution() {
  if (!solutions.length) {
    resetResults();
    return;
  }
  const s = solutions[selectedIndex];

  // Voltage, Resistance use engineering format (value + prefix in number)
  // Example: 3.3m V (this is acceptable unless you also want decimal-only)
  // If you added unitV/unitR spans you can switch to prefix-in-unit later.
  const fV = formatEngValue(s.V, 4);
  out.V.textContent = fV.valueText + fV.prefix;
  if (out.unitV) out.unitV.textContent = "V";

  const fR = formatEngValue(s.R, 4);
  out.R.textContent = fR.valueText + fR.prefix;
  if (out.unitR) out.unitR.textContent = "Ω";

  // Current: smart mA/A
  const Idisp = formatCurrentSmart(s.I);
  out.I.textContent = Idisp.text;
  out.unitI.textContent = Idisp.unit;

  // Power: ALWAYS decimal W (no prefixes)
  out.P.textContent = formatWattsDecimal(s.P);
  if (out.unitP) out.unitP.textContent = "W";

  // Raw values
  out.rawV.textContent = `${s.V.toPrecision(10)} V`;
  out.rawI.textContent = Idisp.raw;
  out.rawR.textContent = `${s.R.toPrecision(10)} Ω`;
  out.rawP.textContent = `${s.P.toPrecision(10)} W`;

  // Derived
  const Wh = s.P; // W * 1 hour => Wh
  out.Wh.textContent = `${formatWattsDecimal(Wh)} Wh`; // match decimal style
  const ImaText = isFiniteNumber(s.I)
    ? `${(s.I * 1000).toFixed(3).replace(/\.?0+$/,"")} mA`
    : "—";
  out.Ima.textContent = ImaText;

  // Notes
  out.notes.textContent = (solutions.length > 1)
    ? `Multiple valid branches detected (${solutions.length}). Choose one from Branch. Negative V/I indicates direction (reference-dependent).`
    : `Single unique solution from the provided inputs. Negative V/I indicates direction (reference-dependent).`;
}

function solve({ silent = false } = {}) {
  try {
    const vals = readInputs();
    solutions = solveOhmsLaw(vals);
    selectedIndex = 0;
    updateBranchSelector();
    renderSolution();
    if (!silent) {
      addHistory(vals, solutions[selectedIndex]);
      setStatus(`Solved: ${solutions.length} solution(s).`);
    } else {
      setStatus(`Solved: ${solutions.length} solution(s).`);
    }
  } catch (e) {
    if (silent) return;
    setStatus(String(e.message || e), "error");
  }
}

function clearAll() {
  inputs.V.value = "";
  inputs.I.value = "";
  inputs.R.value = "";
  inputs.P.value = "";
  solutions = [];
  selectedIndex = 0;
  resetResults();
  setStatus("Cleared. Enter any two values and solve.");
}

btnSolve?.addEventListener("click", () => solve({ silent: false }));
btnClear?.addEventListener("click", clearAll);

branchSelect?.addEventListener("change", () => {
  const idx = Number(branchSelect.value);
  if (!Number.isFinite(idx)) return;
  selectedIndex = idx;
  renderSolution();
  setStatus(`Branch #${selectedIndex + 1} selected.`);
});

for (const k of ["V", "I", "R", "P"]) {
  inputs[k]?.addEventListener("input", () => {
    if (autoSolve?.checked) solve({ silent: true });
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") solve({ silent: false });
  if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
    e.preventDefault();
    clearAll();
  }
});

btnCopy?.addEventListener("click", async () => {
  if (!solutions.length) {
    setStatus("Nothing to copy.", "warn");
    return;
  }
  const s = solutions[selectedIndex];
  const Idisp = formatCurrentSmart(s.I);
  const txt =
`Ohm’s Law Result (Branch #${selectedIndex + 1})
V = ${formatEng(s.V, "V")}
I = ${Idisp.text} ${Idisp.unit}  (${s.I.toPrecision(10)} A)
R = ${formatEng(s.R, "Ω")}
P = ${formatWattsDecimal(s.P)} W
Energy (1h) = ${formatWattsDecimal(s.P)} Wh
`;
  try {
    await navigator.clipboard.writeText(txt);
    setStatus("Copied result to clipboard.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setStatus("Copied result to clipboard (fallback).");
  }
});

// ---------------------
// History (localStorage)
// ---------------------

const HISTORY_KEY = "ohms_history_v1";

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

function saveHistory(arr) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, 50)));
}

function fmtInputSummary(vals) {
  const show = (x, unit) => (x == null ? "—" : formatEng(x, unit));
  return `In: V=${show(vals.V,"V")}, I=${show(vals.I,"A")}, R=${show(vals.R,"Ω")}, P=${show(vals.P,"W")}`;
}

function fmtOutputSummary(sol) {
  const Idisp = formatCurrentSmart(sol.I);
  return `Out: V=${formatEng(sol.V,"V")}, I=${Idisp.text} ${Idisp.unit}, R=${formatEng(sol.R,"Ω")}, P=${formatWattsDecimal(sol.P)} W`;
}

function addHistory(vals, sol) {
  const arr = loadHistory();
  arr.unshift({
    ts: Date.now(),
    input: vals,
    out: sol,
  });
  saveHistory(arr);
  renderHistory();
}

function renderHistory() {
  const arr = loadHistory();
  historyList.innerHTML = "";
  if (!arr.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="h-body muted">No history yet.</div>`;
    historyList.appendChild(li);
    return;
  }

  arr.slice(0, 20).forEach((item) => {
    const dt = new Date(item.ts);
    const time = dt.toLocaleString();
    const li = document.createElement("li");

    li.innerHTML = `
      <div class="h-top">
        <span>${time}</span>
        <button class="btn small" type="button" data-act="reuse">Reuse</button>
      </div>
      <div class="h-body">${escapeHtml(fmtInputSummary(item.input))}\n${escapeHtml(fmtOutputSummary(item.out))}</div>
    `;

    li.querySelector('[data-act="reuse"]').addEventListener("click", () => {
      const v = item.input;
      inputs.V.value = v.V == null ? "" : String(v.V);
      inputs.I.value = v.I == null ? "" : String(v.I);
      inputs.R.value = v.R == null ? "" : String(v.R);
      inputs.P.value = v.P == null ? "" : String(v.P);
      solve({ silent: false });
      setStatus("Reused history item.");
    });

    historyList.appendChild(li);
  });
}

btnClearHistory?.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  setStatus("History cleared.");
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

renderHistory();
resetResults();
setStatus("Ready.");

// ---------------------
// Battery (mAh) tool
// ---------------------

function batteryClear() {
  capmAh.value = "";
  drawmA.value = "";
  batV.value = "";
  batHours.textContent = "—";
  batAh.textContent = "—";
  batWh.textContent = "—";
  setStatus("Battery tool cleared.");
}

function batteryEstimate() {
  try {
    const cap = capmAh.value.trim();
    const draw = drawmA.value.trim();
    const v = batV.value.trim();

    if (!cap || !draw) throw new Error("Enter capacity (mAh) and draw (mA).");

    const cap_mAh = parseEng(cap);   // allow suffixes too
    const draw_mA = parseEng(draw);

    if (!(cap_mAh > 0)) throw new Error("Capacity must be > 0 mAh.");
    if (!(draw_mA > 0)) throw new Error("Draw must be > 0 mA.");

    const cap_Ah = cap_mAh / 1000.0;
    const draw_A = draw_mA / 1000.0;

    const hours = cap_Ah / draw_A; // ideal
    batHours.textContent = `${hours.toFixed(2).replace(/\.?0+$/,"")} h`;
    batAh.textContent = `${cap_Ah.toFixed(3).replace(/\.?0+$/,"")} Ah`;

    if (v) {
      const Vbat = parseEng(v);
      if (!(Vbat > 0)) throw new Error("Battery voltage must be > 0 V.");
      const Wh = cap_Ah * Vbat;
      batWh.textContent = `${Wh.toFixed(2).replace(/\.?0+$/,"")} Wh`;
    } else {
      batWh.textContent = "—";
    }

    setStatus("Battery estimate complete.");
  } catch (e) {
    setStatus(String(e.message || e), "error");
  }
}

btnBattery?.addEventListener("click", batteryEstimate);
btnBatteryClear?.addEventListener("click", batteryClear);
