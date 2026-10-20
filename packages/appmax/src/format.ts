// A Appmax devolve datas em três formatos diferentes, sempre no horário de
// Brasília (UTC-3, sem horário de verão desde 2019):
//   - "aaaa-mm-dd hh:mm:ss"  (detalhe da assinatura)
//   - "dd/mm/aaaa"           (listagem e histórico de cobranças)
//   - ISO-8601               (webhooks)

const BRT_OFFSET = "-03:00";

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;
const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseAppmaxDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();

  const dt = DATETIME.exec(trimmed);
  if (dt) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = dt;
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}${BRT_OFFSET}`);
  }

  const br = BR_DATE.exec(trimmed);
  if (br) {
    const [, d, m, y] = br;
    return new Date(`${y}-${m}-${d}T00:00:00${BRT_OFFSET}`);
  }

  const iso = new Date(trimmed);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Formata uma data como aaaa-mm-dd no horário de Brasília (formato dos filtros da API). */
export function toAppmaxDay(date: Date): string {
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

/**
 * Valores de assinatura vêm em reais; guardamos tudo em centavos. O valor das
 * cobranças vem como texto ("35.33").
 */
export function reaisToCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const reais = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(reais) ? Math.round(reais * 100) : null;
}
