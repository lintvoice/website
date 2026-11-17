// The rules index: search, filter by subject and country, in the browser. Without JavaScript, the page lists every
// explained rule by subject; this script adds the search over every rule of the official files (static/rules/
// index.json, built with the site), the filters, and keeps the state in the address (?q=…), so a search can be shared
// and the back button works. Nothing is sent anywhere.

const T = JSON.parse(document.getElementById("rules-texts").textContent);
const P = T.params;
const lang = T.lang;
const input = document.getElementById("q");
const results = document.getElementById("rules-results");
const browse = document.getElementById("rules-browse");
const count = document.getElementById("rules-count");
const clear = document.querySelector(".rules-filters .clear");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
// Codes are forgiving: case, spaces, dashes, underscores and dots do not matter ("br fr 10" is "BRFR10").
const code = (s) => s.toUpperCase().replace(/[\s_\-.]/g, "");
// Words: lower case, accents ignored, anything else a separator.
const words = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let entries = [];

function state() {
  const u = new URLSearchParams(location.search);
  return { q: u.get(P.q) || "", topic: u.get(P.topic) || "", country: u.get(P.country) || "" };
}

function address(s, push) {
  const u = new URLSearchParams();
  if (s.q) u.set(P.q, s.q);
  if (s.topic) u.set(P.topic, s.topic);
  if (s.country) u.set(P.country, s.country);
  const url = `${location.pathname}${u.toString() ? `?${u}` : ""}`;
  history[push ? "pushState" : "replaceState"](null, "", url);
}

async function load() {
  const data = await fetch("/static/rules/index.json").then((r) => r.json());
  entries = [
    ...data.explained.map((e) => ({
      ...e,
      page: true,
      codes: [e.id, ...e.ids].map(code),
      t: words(e.title[lang]),
      b: words(e.brief[lang]),
      w: words(`${e.words[lang]} ${e.id}`),
      bts: e.bt.map(code),
    })),
    ...data.others.map((e) => ({ ...e, page: false, codes: [e.id, ...e.ids].map(code), t: "", b: "", w: words(`${e.message} ${e.id}`), bts: [] })),
  ];
}

// How well an entry answers the query: an exact code first, then a code that starts with it, then words.
function score(e, q) {
  const c = code(q);
  if (c && e.codes.includes(c)) return 1000;
  if (/^[A-Z]{2}/.test(c) && c.length >= 3 && e.codes.some((x) => x.startsWith(c))) return 500 - Math.min(...e.codes.map((x) => x.length)) / 100;
  // a rule code ("BR-S-08", "br co") is matched as a code only, never split into words; a word like "brut" stays a word
  if (/^BR[A-Z]*\d/.test(c) || /^\s*br[\s_-]/i.test(q)) return 0;
  // a business term ("BT-30", "bt 30") is one token, matched against the rule's business terms
  const bts = (q.match(/\bbt[\s_-]*\d+\b/gi) || []).map(code);
  const tokens = words(q.replace(/\bbt[\s_-]*\d+\b/gi, " ")).split(" ").filter(Boolean);
  if (!tokens.length && !bts.length) return 0;
  let total = 0;
  for (const bt of bts) {
    if (!e.bts.includes(bt)) return 0;
    total += e.bts[0] === bt ? 3 : 2; // most for the rule the term is mainly about
  }
  for (const tok of tokens) {
    const s = (e.t.split(" ").includes(tok) ? 3 : e.t.includes(tok) ? 2 : 0) + (e.b.includes(tok) ? 1 : 0) + (e.w.includes(tok) ? 1 : 0);
    if (!s) return 0; // every word must be found
    total += s;
  }
  return total + (tokens.every((tok) => e.t.includes(tok)) ? 2 : 0) + (e.page ? 0.5 : 0);
}

function item(e) {
  if (!e.page) {
    const source = `${fill(T.official, { source: e.source })}${e.lang === "en" && T.in_english ? ` ${T.in_english}` : ""}`;
    return `<li class="rule-item not-yet"><p class="rule-link"><span class="idm">${esc(e.id)}</span> <span class="title">${esc(T.not_yet)}</span></p>
      <blockquote class="official" lang="${e.lang}">${esc(e.message)}</blockquote><p class="marks"><span class="mark">${esc(source)}</span>${T.check ? ` <a href="${esc(T.check)}">${esc(T.check_link)}</a>` : ""}</p></li>`;
  }
  return `<li class="rule-item"><a class="rule-link" href="${esc(e.href[lang])}"><span class="idm">${esc(e.id)}</span> <span class="title">${esc(e.title[lang])}</span></a>
    ${e.brief[lang] ? `<p class="brief">${esc(e.brief[lang])}</p>` : ""}
    <p class="marks"><span class="mark">${esc(T.topics[e.topic])}</span>${e.example ? `<span class="mark">${esc(T.mark_example)}</span>` : ""}<span class="mark">${esc(T.country_short[e.origin])}</span></p></li>`;
}

// A country shows its own rules and the European standard's, which every country's format builds on; "eu" shows the
// European standard's only.
const inCountry = (e, country) => !country || e.origin === "eu" || e.origin === country;

// The entries that match the query and the country, before the subject filter: what the subject counts are counted on.
function matching(s) {
  return entries
    .filter((e) => inCountry(e, s.country) && (s.q ? true : e.page))
    .map((e) => ({ e, score: s.q ? score(e, s.q) : 1 }))
    .filter((x) => x.score > 0);
}

function render() {
  const s = state();
  if (input.value !== s.q && document.activeElement !== input) input.value = s.q;
  const pool = matching(s);
  const shown = pool.filter((x) => !s.topic || x.e.topic === s.topic).sort((a, b) => b.score - a.score || Number(b.e.page) - Number(a.e.page) || a.e.id.localeCompare(b.e.id));
  // subject and country counts follow the query
  document.querySelectorAll("[data-topic]").forEach((a) => {
    const n = pool.filter((x) => x.e.topic === a.dataset.topic).length;
    a.querySelector(".n").textContent = n;
    a.classList.toggle("zero", n === 0);
    a.classList.toggle("on", a.dataset.topic === s.topic);
    a.setAttribute("aria-current", a.dataset.topic === s.topic ? "true" : "false");
  });
  document.querySelectorAll("[data-country]").forEach((a) => {
    const n = entries.filter((e) => inCountry(e, a.dataset.country) && (s.q ? score(e, s.q) > 0 : e.page) && (!s.topic || e.topic === s.topic)).length;
    a.querySelector(".n").textContent = n;
    a.classList.toggle("zero", n === 0);
    a.classList.toggle("on", a.dataset.country === s.country);
    a.setAttribute("aria-current", a.dataset.country === s.country ? "true" : "false");
  });
  const filtered = s.q || s.topic || s.country;
  clear.hidden = !filtered;
  browse.hidden = Boolean(filtered);
  results.hidden = !filtered;
  if (!filtered) {
    count.textContent = "";
    return;
  }
  results.innerHTML = shown.map(({ e }) => item(e)).join("");
  count.textContent = shown.length ? fill(shown.length === 1 ? T.count_one : T.count_many, { n: shown.length }) : T.none;
}

function exact(q) {
  const c = code(q);
  return c && entries.find((e) => e.page && e.codes.includes(c));
}

let timer;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    address({ ...state(), q: input.value.trim() }, false);
    render();
  }, 120);
});
// Enter on an exact code opens its page
document.getElementById("rules-search").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const hit = exact(input.value);
  if (hit) location.href = hit.href[lang];
});
document.querySelectorAll("[data-topic], [data-country]").forEach((a) =>
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const s = state();
    if (a.dataset.topic) s.topic = s.topic === a.dataset.topic ? "" : a.dataset.topic;
    if (a.dataset.country) s.country = s.country === a.dataset.country ? "" : a.dataset.country;
    address(s, true);
    render();
  }),
);
clear.addEventListener("click", () => {
  input.value = "";
  address({ q: "", topic: "", country: "" }, true);
  render();
});
window.addEventListener("popstate", render);

// on a phone, the filters start folded: the search and the results come first
if (matchMedia("(max-width: 820px)").matches) document.getElementById("rules-filters").open = false;

await load();
render();
window.lintvoiceRulesReady = true;
