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
const active = document.getElementById("active-filters");

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
      <blockquote class="official" lang="${e.lang}">${esc(e.message)}</blockquote><p class="source">${esc(source)}${T.check ? ` · <a href="${esc(T.check)}">${esc(T.check_link)}</a>` : ""}</p></li>`;
  }
  return `<li class="rule-item"><a class="rule-link" href="${esc(e.href[lang])}"><span class="idm">${esc(e.id)}</span> <span class="title">${esc(e.title[lang])}</span></a>${e.brief[lang] ? `<p class="brief">${esc(e.brief[lang])}</p>` : ""}</li>`;
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

const counted = (n) => fill(n === 1 || (lang === "fr" && n === 0) ? T.count_one : T.count_many, { n }); // French: « 0 règle »

function render() {
  const s = state();
  if (input.value !== s.q && document.activeElement !== input) input.value = s.q;
  const pool = matching(s);
  const shown = pool.filter((x) => !s.topic || x.e.topic === s.topic).sort((a, b) => b.score - a.score || Number(b.e.page) - Number(a.e.page) || a.e.id.localeCompare(b.e.id));
  // the subject cards count what the query and the country leave
  document.querySelectorAll("[data-topic]").forEach((a) => {
    const n = pool.filter((x) => x.e.topic === a.dataset.topic).length;
    a.querySelector(".n").textContent = counted(n);
    a.classList.toggle("zero", n === 0);
    a.classList.toggle("on", a.dataset.topic === s.topic);
    a.setAttribute("aria-current", a.dataset.topic === s.topic ? "true" : "false");
  });
  document.querySelectorAll("[data-country]").forEach((a) => {
    a.classList.toggle("on", a.dataset.country === s.country);
    a.setAttribute("aria-current", a.dataset.country === s.country ? "true" : "false");
  });
  // the filters in use, as tags above the results, each one removable, then "clear all"
  const tags = [];
  if (s.topic) tags.push(["topic", T.topics[s.topic]]);
  if (s.country) tags.push(["country", T.countries[s.country]]);
  active.hidden = !tags.length && !s.q;
  active.innerHTML = tags.map(([key, name]) => `<button type="button" class="tag" data-remove="${key}" aria-label="${esc(fill(T.remove, { name }))}">${esc(name)} <span aria-hidden="true">×</span></button>`).join("")
    + (tags.length || s.q ? `<button type="button" class="link" data-clear>${esc(T.clear_all)}</button>` : "");
  const filtered = s.q || s.topic || s.country;
  browse.hidden = Boolean(filtered);
  results.hidden = !filtered;
  if (!filtered) {
    count.textContent = T.all_title;
    return;
  }
  results.innerHTML = shown.map(({ e }) => item(e)).join("");
  let title = shown.length ? counted(shown.length) : T.none;
  if (shown.length && s.q) title = fill(T.for_query, { count: title, q: s.q });
  if (shown.length && s.topic) title = fill(T.count_topic, { count: title, topic: T.topics[s.topic] });
  count.textContent = title;
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
    if (a.dataset.topic) document.getElementById("rules-all").scrollIntoView({ behavior: "smooth", block: "start" });
  }),
);
active.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const s = state();
  if (b.dataset.clear !== undefined) {
    input.value = "";
    address({ q: "", topic: "", country: "" }, true);
  } else {
    s[b.dataset.remove] = "";
    address(s, true);
  }
  render();
});
window.addEventListener("popstate", render);

await load();
render();
window.lintvoiceRulesReady = true;
