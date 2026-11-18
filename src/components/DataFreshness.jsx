import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { t, locale } from "../lib/i18n";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString(locale(), {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric",
  });

const fmtTime = (d) =>
  new Date(d)
    .toLocaleTimeString(locale(), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })
    .replace(":", locale() === "fr-FR" ? "h" : ":");

export default function DataFreshness() {
  const [data, setData] = useState(null);

  useEffect(() => {
    supabase.rpc("get_data_freshness").then(({ data, error }) => {
      if (!error && data) setData(data);
    });
  }, []);

  if (!data || (!data.last_check && !data.last_update)) return null;

  const parts = [];
  if (data.last_check) parts.push(t("Vérifié le {d}", { d: fmtDate(data.last_check) }));
  if (data.last_update) {
    parts.push(t("Dernière mise à jour le {d} à {h}", { d: fmtDate(data.last_update), h: fmtTime(data.last_update) }));
  }

  return <div className="data-freshness">{parts.join(" · ")}</div>;
}
