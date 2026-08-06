import fs from "node:fs/promises";

// ID таблицы (можно переопределить через env SHEET_ID)
const SHEET_ID = process.env.SHEET_ID || "1CwXbYgCu9GWdg9BgBAZLrieNbqYq9fc72HQScuPIqr4";
const OUT_FILE = process.env.OUT_FILE || "prices.json";

// gid каждой вкладки — стабильный ID листа, не меняется даже при переименовании вкладки
const GIDS = {
  term: "0",              // Срок размещения
  geo: "124478114",       // Цены Геоконтекст
  media: "1911226646",    // Цены Медийка
  boost: "2117524391",    // Цены Усиливающие позиции (Отзывы Про + Премиум-логотип)
  navi: "492785146",      // Цены Навигатор
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* ignore */ }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// нормализует число: убирает пробелы, меняет запятую на точку, оставляет пустую строку как есть
function normNum(v) {
  const s = (v || "").trim();
  if (!s) return "";
  return s.replace(/\s/g, "").replace(",", ".");
}

async function fetchCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const r = await fetch(url, { headers: { accept: "text/csv" } });
  if (!r.ok) throw new Error(`CSV fetch error (gid=${gid}) ${r.status}: ${await r.text()}`);
  return parseCSV(await r.text());
}

// строки данных начинаются с 3-й строки (первые 2 — шапка), город в колонке A
function dataRows(rows) {
  return rows.slice(2).filter((r) => (r[0] || "").trim());
}

function buildTerm(rows) {
  const out = {};
  for (const r of dataRows(rows)) {
    const city = r[0].trim();
    out[city] = normNum(r[1]);
  }
  return out;
}

function buildGeo(rows) {
  const out = {};
  for (const r of dataRows(rows)) {
    const city = r[0].trim();
    out[city] = {
      start: normNum(r[1]),
      startPlus: normNum(r[2]),
      all: normNum(r[3]),
      reviews: normNum(r[4]), // может быть перезаписано данными из boost
    };
  }
  return out;
}

function buildMedia(rows) {
  const out = {};
  for (const r of dataRows(rows)) {
    const city = r[0].trim();
    out[city] = {
      smartBanner: normNum(r[1]),
      geoObjBanner: normNum(r[2]),
      dashMobile: normNum(r[3]),
      dashStart: normNum(r[4]),
      logo1: normNum(r[5]),
      logo2: normNum(r[6]),
      premiumLogo: normNum(r[7]), // может быть перезаписано данными из boost
    };
  }
  return out;
}

function buildNavi(rows) {
  const out = {};
  for (const r of dataRows(rows)) {
    const city = r[0].trim();
    out[city] = {
      stopBanner: normNum(r[1]),
      billboard: normNum(r[2]),
      routeBillboard: normNum(r[3]),
      logo: normNum(r[4]),
    };
  }
  return out;
}

function buildBoost(rows) {
  const out = {};
  for (const r of dataRows(rows)) {
    const city = r[0].trim();
    out[city] = {
      reviews: normNum(r[1]),
      premiumLogo: normNum(r[2]),
    };
  }
  return out;
}

(async () => {
  const [termRows, geoRows, mediaRows, boostRows, naviRows] = await Promise.all([
    fetchCSV(GIDS.term),
    fetchCSV(GIDS.geo),
    fetchCSV(GIDS.media),
    fetchCSV(GIDS.boost),
    fetchCSV(GIDS.navi),
  ]);

  const term = buildTerm(termRows);
  const geo = buildGeo(geoRows);
  const media = buildMedia(mediaRows);
  const boost = buildBoost(boostRows);
  const navi = buildNavi(naviRows);

  // "Геоконтекст" — источник истины для Отзывы Про (не перезаписываем из boost).
  // "Усиливающие позиции" остаётся источником истины для Премиум-логотип
  // (в "Медийке" это же значение может отставать).
  for (const city of Object.keys(media)) {
    if (boost[city]?.premiumLogo) media[city].premiumLogo = boost[city].premiumLogo;
  }

  if (!geo["Москва"]) throw new Error("Bad export: no 'Москва' found in geo (check sharing/publish)");
  if (!media["Москва"]) throw new Error("Bad export: no 'Москва' found in media");
  if (!navi["Москва"]) throw new Error("Bad export: no 'Москва' found in navi");

  const out = {
    geo,
    media,
    navi,
    term,
    __meta: {
      updatedAt: new Date().toISOString(),
      cities: Object.keys(geo).length,
    },
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(out), "utf8");
  console.log("OK wrote", OUT_FILE, "cities=", Object.keys(geo).length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
