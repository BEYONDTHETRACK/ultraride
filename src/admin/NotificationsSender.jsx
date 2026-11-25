import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// Onglet « Notifications » : envoi manuel d'une notification aux utilisateurs
// de l'app (Firebase, par sujet), et historique des 30 derniers envois.
// L'envoi passe par l'Edge Function send-push (réservée aux admins).

const TITLE_MAX = 80;
const BODY_MAX = 240; // au-delà, Firebase tronque sur la plupart des téléphones

const EMOJIS = ["🚴", "🚵", "🏔️", "🌄", "🗺️", "📍", "☀️", "🌧️", "❄️", "💨", "⚠️", "⛔", "🎉", "🆕", "✅", "🔥", "📲", "🇬🇧", "🇫🇷", "🏁", "⏰", "📅", "💪", "👉"];

const TARGETS = [
  { value: "all", label: "Tout le monde", hint: "Tous les téléphones qui ont activé au moins un type de notification." },
  { value: "nouveaux-ultras", label: "Abonnés « Nouveaux ultras »", hint: "Seulement ceux qui suivent les nouveaux ultras." },
  { value: "mises-a-jour", label: "Abonnés « Mises à jour »", hint: "Seulement ceux qui suivent les mises à jour des fiches." },
];
const TOPIC_LABEL = { all: "Tout le monde", "nouveaux-ultras": "Nouveaux ultras", "mises-a-jour": "Mises à jour" };
const KIND_LABEL = { custom: "Manuel", new_race: "Auto · nouveaux", race_update: "Auto · mises à jour" };

const fmtDate = (d) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function NotificationsSender() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [authors, setAuthors] = useState({});
  const lastField = useRef("body");
  const titleRef = useRef(null);
  const bodyRef = useRef(null);

  const load = async () => {
    const { data, error: e } = await supabase
      .from("push_notifications")
      .select("id, kind, title, body, url, topic, sent_at, error, sent_by")
      .order("sent_at", { ascending: false })
      .limit(30);
    if (e) { setError(e.message); return; }
    setHistory(data || []);
    const ids = [...new Set((data || []).map((r) => r.sent_by).filter(Boolean))];
    if (ids.length) {
      const { data: p } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setAuthors(Object.fromEntries((p || []).map((x) => [x.id, x.display_name])));
    }
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    const recent = (history || []).filter((r) => new Date(r.sent_at).getTime() >= since);
    return {
      total: recent.length,
      manual: recent.filter((r) => r.kind === "custom").length,
      auto: recent.filter((r) => r.kind !== "custom").length,
      failed: recent.filter((r) => r.error).length,
    };
  }, [history]);

  const insertEmoji = (e) => {
    const isTitle = lastField.current === "title";
    const el = isTitle ? titleRef.current : bodyRef.current;
    const value = isTitle ? title : body;
    const max = isTitle ? TITLE_MAX : BODY_MAX;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + e + value.slice(end)).slice(0, max);
    (isTitle ? setTitle : setBody)(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = Math.min(start + e.length, next.length);
      el.setSelectionRange(pos, pos);
    });
  };

  const canSend = title.trim() && body.trim() && !sending;

  const send = async () => {
    if (!canSend) return;
    if (topic === "all" && !confirming) { setConfirming(true); return; }
    setSending(true);
    setError(null);
    setResult(null);
    const { data, error: e } = await supabase.functions.invoke("send-push", {
      body: { custom: { topic, title: title.trim(), body: body.trim(), url: url.trim() || "/" } },
    });
    setSending(false);
    setConfirming(false);
    const sent = data?.sent?.[0];
    if (e || !sent || sent.error) {
      let msg = sent?.error || data?.error || e?.message || "Envoi impossible";
      try { const j = await e?.context?.json?.(); if (j?.sent?.[0]?.error || j?.error) msg = j.sent?.[0]?.error || j.error; } catch { /* corps déjà lu */ }
      setError(msg);
    } else {
      setResult({ topic, url: sent.url });
      setTitle(""); setBody(""); setUrl("");
    }
    load();
  };

  const target = TARGETS.find((x) => x.value === topic);

  return (
    <div className="ntf">
      <h1 className="h1">Notifications</h1>
      <p className="muted" style={{ marginTop: -8 }}>Envoie une notification aux utilisateurs de l'app UltraRide (iPhone et Android).</p>

      <div className="ntf-kpis">
        <div className="ntf-kpi"><b>{history ? stats.total : "…"}</b><span>envois sur 30 jours</span></div>
        <div className="ntf-kpi"><b>{history ? stats.manual : "…"}</b><span>manuels</span></div>
        <div className="ntf-kpi"><b>{history ? stats.auto : "…"}</b><span>automatiques</span></div>
        <div className={`ntf-kpi${stats.failed ? " is-bad" : ""}`}><b>{history ? stats.failed : "…"}</b><span>en échec</span></div>
      </div>

      <section className="card ntf-form">
        <div className="field">
          <label htmlFor="ntf-title">Titre</label>
          <input id="ntf-title" ref={titleRef} value={title} maxLength={TITLE_MAX}
            onFocus={() => (lastField.current = "title")}
            onChange={(e) => { setTitle(e.target.value); setConfirming(false); }}
            placeholder="UltraRide passe à l'anglais 🇬🇧" />
          <div className="ntf-count">{title.length} / {TITLE_MAX}</div>
        </div>

        <div className="field">
          <label htmlFor="ntf-body">Message</label>
          <textarea id="ntf-body" ref={bodyRef} rows={3} value={body} maxLength={BODY_MAX}
            onFocus={() => (lastField.current = "body")}
            onChange={(e) => { setBody(e.target.value); setConfirming(false); }}
            placeholder="Nouvelle version : l'app et les fiches existent aussi en anglais." />
          <div className={`ntf-count${body.length > BODY_MAX - 20 ? " is-near" : ""}`}>{body.length} / {BODY_MAX}</div>
        </div>

        <div className="ntf-emojis" aria-label="Insérer un emoji">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => insertEmoji(e)}>{e}</button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="ntf-url">Lien (facultatif)</label>
          <input id="ntf-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/ultras ou https://ultraride.eu/courses/…" />
          <div className="field-hint">Page ouverte au toucher de la notification. Vide = accueil de l'app. Un lien hors d'ultraride.eu est ramené à l'accueil.</div>
        </div>

        <fieldset className="ntf-target">
          <legend>Envoyer à</legend>
          {TARGETS.map((x) => (
            <label key={x.value} className={topic === x.value ? "is-on" : ""}>
              <input type="radio" name="ntf-topic" value={x.value} checked={topic === x.value}
                onChange={() => { setTopic(x.value); setConfirming(false); }} />
              {x.label}
            </label>
          ))}
          <div className="field-hint">{target?.hint}</div>
        </fieldset>

        {(title || body) && (
          <div className="ntf-preview" aria-label="Aperçu">
            <div className="ntf-preview-app"><span>UR</span> UltraRide · maintenant</div>
            <b>{title || "Titre"}</b>
            <p>{body || "Message"}</p>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
        {result && (
          <div className="success-box">
            Notification envoyée à Firebase pour « {TOPIC_LABEL[result.topic]} »{result.url && result.url !== "/" ? ` (lien ${result.url})` : ""}.
            Firebase ne renvoie pas le nombre de téléphones atteints pour un envoi par sujet.
          </div>
        )}

        <div className="ntf-actions">
          <button type="button" className={`btn ${confirming ? "ntf-confirm" : "btn-primary"}`} disabled={!canSend} onClick={send}>
            {sending ? "Envoi…" : confirming ? "Confirmer l'envoi à tout le monde" : "Envoyer"}
          </button>
          {confirming && <button type="button" className="btn" onClick={() => setConfirming(false)}>Annuler</button>}
        </div>
      </section>

      <section className="card ntf-history">
        <h2>Derniers envois</h2>
        {history === null ? <p className="muted">Chargement…</p> : history.length === 0 ? <p className="muted">Aucun envoi pour l'instant.</p> : (
          <ul>
            {history.map((r) => (
              <li key={r.id} className={r.error ? "is-bad" : ""}>
                <div className="ntf-h-top">
                  <span className="mono">{fmtDate(r.sent_at)}</span>
                  <span className={`ntf-tag ntf-tag--${r.kind}`}>{KIND_LABEL[r.kind] || r.kind}</span>
                  {r.topic && <span className="ntf-tag">{TOPIC_LABEL[r.topic] || r.topic}</span>}
                  {r.sent_by && authors[r.sent_by] && <span className="muted">par {authors[r.sent_by]}</span>}
                </div>
                <b>{r.title}</b>
                <p>{r.body}</p>
                {r.url && <span className="muted mono ntf-h-url">{r.url.replace(/^https:\/\/ultraride\.eu/, "") || "/"}</span>}
                {r.error && <div className="ntf-h-err">Échec : {r.error.slice(0, 200)}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
