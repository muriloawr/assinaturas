const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const day = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" });
const dayTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function money(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : brl.format(cents / 100);
}

export function date(iso: string | null | undefined): string {
  return iso ? day.format(new Date(iso)) : "—";
}

export function dateTime(iso: string | null | undefined): string {
  return iso ? dayTime.format(new Date(iso)) : "—";
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  OVERDUE: "Em atraso",
  CANCELLED: "Cancelada",
  SUSPENDED: "Suspensa",
  FINISHED: "Finalizada",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const INTERVALS: Record<string, [string, string]> = {
  week: ["semana", "semanas"],
  month: ["mês", "meses"],
  year: ["ano", "anos"],
};

export function intervalLabel(interval: string | null, count: number | null): string {
  if (!interval) return "—";
  const [one, many] = INTERVALS[interval] ?? [interval, interval];
  return !count || count === 1 ? `A cada ${one}` : `A cada ${count} ${many}`;
}
