import { describe, expect, it, vi } from "vitest";
import { AppmaxApiError, AppmaxClient } from "./client.ts";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenResponse(token = "tok-1", expiresIn = 3600) {
  return json(200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });
}

function makeClient(fetchMock: ReturnType<typeof vi.fn>, now = () => 0) {
  return new AppmaxClient({
    environment: "sandbox",
    credentials: { clientId: "id", clientSecret: "secret" },
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    now,
  });
}

describe("AppmaxClient", () => {
  it("autentica com client_credentials e devolve o conteúdo de data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(200, { data: { subscription_id: 10, status: "ACTIVE" } }));

    const client = makeClient(fetchMock);
    const sub = await client.getSubscription(10);

    expect(sub).toEqual({ subscription_id: 10, status: "ACTIVE" });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(String(tokenUrl)).toBe("https://auth.sandboxappmax.com.br/oauth2/token");
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");
    const [apiUrl, apiInit] = fetchMock.mock.calls[1]!;
    expect(String(apiUrl)).toBe("https://api.sandboxappmax.com.br/v1/subscriptions/10");
    expect(apiInit.headers.Authorization).toBe("Bearer tok-1");
  });

  it("reaproveita o token até perto de expirar", async () => {
    let now = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(json(200, { data: {} }))
      .mockResolvedValueOnce(json(200, { data: {} }))
      .mockResolvedValueOnce(tokenResponse("tok-2"))
      .mockResolvedValueOnce(json(200, { data: {} }));

    const client = makeClient(fetchMock, () => now);
    await client.getSubscription(1);
    now = 30 * 60 * 1000;
    await client.getSubscription(1);
    now = 59.5 * 60 * 1000; // dentro da margem de 1 minuto
    await client.getSubscription(1);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2"));
    expect(tokenCalls).toHaveLength(2);
    expect(fetchMock.mock.calls[4]![1].headers.Authorization).toBe("Bearer tok-2");
  });

  it("gera um novo token quando a API responde 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("velho"))
      .mockResolvedValueOnce(json(401, { message: "Unauthenticated" }))
      .mockResolvedValueOnce(tokenResponse("novo"))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    const client = makeClient(fetchMock);
    await expect(client.getSubscription(1)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[3]![1].headers.Authorization).toBe("Bearer novo");
  });

  it("espera o Retry-After em 429 e tenta de novo", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(429, { message: "Too many requests" }, { "Retry-After": "45" }))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    const client = new AppmaxClient({
      environment: "production",
      credentials: { clientId: "id", clientSecret: "secret" },
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      now: () => 0,
    });

    await expect(client.cancelSubscription(1)).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(45_000);
  });

  it("não repete escritas que falham com 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(500, { errors: { message: "Erro ao pausar a assinatura." } }));

    const client = makeClient(fetchMock);
    const error = await client.pauseSubscription(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppmaxApiError);
    expect((error as AppmaxApiError).status).toBe(500);
    expect((error as AppmaxApiError).message).toContain("Erro ao pausar a assinatura.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("repete leituras que falham com 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    const client = makeClient(fetchMock);
    await expect(client.getOrder(1)).resolves.toEqual({ ok: true });
  });

  it("monta os filtros da listagem e ignora os vazios", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(200, { data: { subscriptions: [], pagination: {} } }));

    const client = makeClient(fetchMock);
    await client.listSubscriptions({ status: "ACTIVE", next_charge_to: "2100-12-31", page: 2 });

    const url = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(url.searchParams.get("status")).toBe("ACTIVE");
    expect(url.searchParams.get("next_charge_to")).toBe("2100-12-31");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("email")).toBe(false);
  });

  it("formata erros de validação vindos como objeto", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        json(422, { errors: { message: { email: ["The email field is required."] } } }),
      );

    const client = makeClient(fetchMock);
    await expect(client.listSubscriptions({})).rejects.toThrow("The email field is required.");
  });
});
