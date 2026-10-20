import { describe, expect, it } from "vitest";
import { parseAppmaxDate, reaisToCents, toAppmaxDay } from "./format.ts";

describe("parseAppmaxDate", () => {
  it("entende aaaa-mm-dd hh:mm:ss como horário de Brasília", () => {
    expect(parseAppmaxDate("2026-08-15 00:00:00")?.toISOString()).toBe("2026-08-15T03:00:00.000Z");
  });

  it("entende dd/mm/aaaa como meia-noite de Brasília", () => {
    expect(parseAppmaxDate("15/07/2026")?.toISOString()).toBe("2026-07-15T03:00:00.000Z");
  });

  it("aceita ISO-8601 dos webhooks", () => {
    expect(parseAppmaxDate("2026-08-15T10:00:00Z")?.toISOString()).toBe("2026-08-15T10:00:00.000Z");
  });

  it("devolve null para vazio ou inválido", () => {
    expect(parseAppmaxDate(null)).toBeNull();
    expect(parseAppmaxDate("")).toBeNull();
    expect(parseAppmaxDate("ontem")).toBeNull();
  });
});

describe("toAppmaxDay", () => {
  it("usa o dia de Brasília", () => {
    expect(toAppmaxDay(new Date("2026-08-15T02:00:00Z"))).toBe("2026-08-14");
    expect(toAppmaxDay(new Date("2026-08-15T03:00:00Z"))).toBe("2026-08-15");
  });
});

describe("reaisToCents", () => {
  it("arredonda para centavos", () => {
    expect(reaisToCents(199.9)).toBe(19990);
    expect(reaisToCents(0.1 + 0.2)).toBe(30);
    expect(reaisToCents(null)).toBeNull();
  });
});
