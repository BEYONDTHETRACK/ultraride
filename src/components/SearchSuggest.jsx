import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DISCIPLINE_COLOR, normalize } from "../lib/raceDisplay";
import { t, locale } from "../lib/i18n";

// Champ de recherche de l'accueil avec liste de suggestions :
// ultras (vers la fiche), organisateurs (vers leur page), pays (vers la liste
// filtrée). Clavier : ↑ ↓ pour choisir, Entrée pour ouvrir, Échap pour fermer.
// Entrée sans suggestion choisie : recherche complète sur /ultras?q=…

const MAX_RACES = 6;
const MAX_ORGS = 3;
const MAX_COUNTRIES = 3;

function score(name, q) {
  const n = normalize(name);
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\-–'’]+/).some((w) => w.startsWith(q))) return 1;
  return n.includes(q) ? 2 : -1;
}

function when(r) {
  if (r.start_date) {
    return new Date(r.start_date + "T12:00:00").toLocaleDateString(locale(), { month: "short", year: "numeric" });
  }
  return r.month ? t(r.month) : "";
}

function Highlight({ text, q }) {
  const n = normalize(text);
  const i = q ? n.indexOf(q) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export default function SearchSuggest({ races, query, setQuery, onSubmit, placeholder, label }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const listId = useId();
  const q = normalize(query.trim());

  const items = useMemo(() => {
    if (!races || q.length < 2) return [];
    const out = [];

    races
      .map((r) => ({ r, s: score(r.name || "", q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || (b.r.view_count || 0) - (a.r.view_count || 0))
      .slice(0, MAX_RACES)
      .forEach(({ r }) => out.push({
        kind: "race", key: "r" + r.id, label: r.name, to: `/courses/${r.id}`,
        color: DISCIPLINE_COLOR[r.discipline] || "#1B2B20",
        meta: [t(r.discipline), r.km ? `${r.km} km` : null, t(r.country), when(r)].filter(Boolean).join(" · "),
      }));

    const orgs = new Map();
    for (const r of races) {
      const name = r.organizer?.name || r.organizer_name;
      if (!name) continue;
      const k = r.organizer?.id || name;
      const o = orgs.get(k) || { name, id: r.organizer?.id, n: 0 };
      o.n += 1;
      orgs.set(k, o);
    }
    [...orgs.values()]
      .map((o) => ({ o, s: score(o.name, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || b.o.n - a.o.n)
      .slice(0, MAX_ORGS)
      .forEach(({ o }) => out.push({
        kind: "org", key: "o" + (o.id || o.name), label: o.name,
        to: o.id ? `/organizers/${o.id}` : `/ultras?q=${encodeURIComponent(o.name)}`,
        meta: o.n > 1 ? t("{n} ultras", { n: o.n }) : t("{n} ultra", { n: o.n }),
      }));

    const countries = new Map();
    for (const r of races) if (r.country) countries.set(r.country, (countries.get(r.country) || 0) + 1);
    [...countries.entries()]
      .map(([c, n]) => ({ c, n, s: Math.min(...[score(c, q), score(t(c), q)].map((v) => (v < 0 ? 9 : v))) }))
      .filter((x) => x.s < 9)
      .sort((a, b) => a.s - b.s || b.n - a.n)
      .slice(0, MAX_COUNTRIES)
      .forEach(({ c, n }) => out.push({
        kind: "country", key: "c" + c, label: t(c), to: `/ultras?q=${encodeURIComponent(t(c))}`,
        meta: n > 1 ? t("{n} ultras", { n }) : t("{n} ultra", { n }),
      }));

    return out;
  }, [races, q]);

  useEffect(() => { setActive(-1); }, [q]);

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const go = (item) => { setOpen(false); navigate(item.to); };

  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active]); }
  };

  const show = open && items.length > 0;
  const titles = { race: t("Ultras"), org: t("Organisateurs"), country: t("Pays") };

  return (
    <div className="v2-suggest" ref={boxRef}>
      <form className="v2-search" onSubmit={(e) => { setOpen(false); onSubmit(e); }} role="search">
        <label className="v2-search-field">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="sr-only">{label}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={show}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && items[active] ? `${listId}-${active}` : undefined}
          />
        </label>
        <button type="submit" className="v2-btn v2-btn-rust">{t("Rechercher")}</button>
      </form>

      {show && (
        <ul className="v2-suggest-list" id={listId} role="listbox">
          {items.map((it, i) => (
            <li key={it.key} role="presentation">
              {(i === 0 || items[i - 1].kind !== it.kind) && <div className="v2-suggest-group">{titles[it.kind]}</div>}
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`v2-suggest-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it)}
              >
                {it.kind === "race" ? <span className="v2-suggest-dot" style={{ background: it.color }} /> : <span className={`v2-suggest-ico v2-suggest-ico--${it.kind}`} aria-hidden="true" />}
                <span className="v2-suggest-text">
                  <span className="v2-suggest-label"><Highlight text={it.label} q={q} /></span>
                  <span className="v2-suggest-meta">{it.meta}</span>
                </span>
              </button>
            </li>
          ))}
          <li role="presentation">
            <button type="button" className="v2-suggest-all" onClick={(e) => { setOpen(false); onSubmit(e); }}>
              {t("Voir tous les résultats pour « {q} »", { q: query.trim() })} →
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
