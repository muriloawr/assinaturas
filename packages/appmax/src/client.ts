import type {
  AppmaxCredentials,
  AppmaxEnvironment,
  CycleDiscountInput,
  DiscountInput,
  ListSubscriptionsParams,
  OrderDetail,
  PauseSubscriptionInput,
  SubscriptionDetail,
  SubscriptionList,
} from "./types.ts";

const HOSTS: Record<AppmaxEnvironment, { auth: string; api: string }> = {
  sandbox: {
    auth: "https://auth.sandboxappmax.com.br",
    api: "https://api.sandboxappmax.com.br",
  },
  production: {
    auth: "https://auth.appmax.com.br",
    api: "https://api.appmax.com.br",
  },
};

/** Renova o token um pouco antes de expirar para não usar um token vencido no meio de uma chamada. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class AppmaxApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string, body: unknown) {
    super(`Appmax ${method} ${path} → ${status}: ${extractErrorMessage(body)}`);
    this.name = "AppmaxApiError";
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}

/** A API devolve erros como `{ errors: { message } }` ou `{ error: { message } }`, e `message` pode ser um objeto de validação. */
export function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return String(body ?? "sem corpo");
  const container =
    (body as { errors?: unknown }).errors ?? (body as { error?: unknown }).error ?? body;
  const message =
    container && typeof container === "object"
      ? (container as { message?: unknown }).message
      : container;
  if (typeof message === "string") return message;
  return JSON.stringify(message ?? body);
}

export interface AppmaxClientOptions {
  environment: AppmaxEnvironment;
  credentials: AppmaxCredentials;
  /**
   * Limite da Appmax: 5 req/s sustentadas por client_id (e 100 mil/mês).
   * Ficamos um pouco abaixo por padrão.
   */
  requestsPerSecond?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export class AppmaxClient {
  private readonly hosts: { auth: string; api: string };
  private readonly credentials: AppmaxCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;

  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private nextSlotAt = 0;

  constructor(options: AppmaxClientOptions) {
    this.hosts = HOSTS[options.environment];
    this.credentials = options.credentials;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.minIntervalMs = 1000 / (options.requestsPerSecond ?? 4);
    this.maxRetries = options.maxRetries ?? 3;
  }

  // ---------------------------------------------------------------- assinaturas

  listSubscriptions(params: ListSubscriptionsParams): Promise<SubscriptionList> {
    return this.request("GET", "/v1/subscriptions", { query: { ...params } });
  }

  getSubscription(id: number): Promise<SubscriptionDetail> {
    return this.request("GET", `/v1/subscriptions/${id}`);
  }

  pauseSubscription(id: number, input: PauseSubscriptionInput = {}): Promise<SubscriptionDetail> {
    return this.request("PATCH", `/v1/subscriptions/${id}/pause`, { body: input });
  }

  activateSubscription(id: number): Promise<SubscriptionDetail> {
    return this.request("PATCH", `/v1/subscriptions/${id}/activate`);
  }

  cancelSubscription(id: number, reason?: string): Promise<SubscriptionDetail> {
    return this.request("PATCH", `/v1/subscriptions/${id}/cancel`, {
      body: reason ? { reason } : {},
    });
  }

  skipCycle(id: number, cycleIndex: number): Promise<unknown> {
    return this.request("PATCH", `/v1/subscriptions/${id}/cycles/${cycleIndex}/skip`);
  }

  unskipCycle(id: number, cycleIndex: number): Promise<unknown> {
    return this.request("PATCH", `/v1/subscriptions/${id}/cycles/${cycleIndex}/unskip`);
  }

  /** Desconto permanente da assinatura. `discount: 0` remove. Vale a partir da próxima cobrança. */
  setDiscount(id: number, input: DiscountInput): Promise<SubscriptionDetail> {
    return this.request("PATCH", `/v1/subscriptions/${id}/discount`, { body: input });
  }

  /** Desconto que vale só em um ciclo (sobrepõe o da assinatura, não soma). */
  setCycleDiscount(id: number, input: CycleDiscountInput): Promise<unknown> {
    return this.request("PATCH", `/v1/subscriptions/${id}/cycles/discount`, { body: input });
  }

  removeCycleDiscount(id: number, cycleIndex?: number): Promise<unknown> {
    return this.request("DELETE", `/v1/subscriptions/${id}/cycles/discount`, {
      query: { cycle_index: cycleIndex },
    });
  }

  // ---------------------------------------------------------------- pedidos

  getOrder(orderId: number): Promise<OrderDetail> {
    return this.request("GET", `/v1/orders/${orderId}`);
  }

  // ---------------------------------------------------------------- infraestrutura

  /** Faz a chamada e devolve o conteúdo de `data` do envelope. */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.hosts.api);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    // Só repetimos 5xx/erros de rede em leituras: repetir um POST/PATCH pode,
    // por exemplo, antecipar uma cobrança duas vezes.
    const idempotent = method === "GET";
    let refreshedToken = false;

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      const token = await this.getToken();

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        if (idempotent && attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw error;
      }

      if (response.status === 401 && !refreshedToken) {
        this.token = null;
        refreshedToken = true;
        continue;
      }

      if (response.status === 429 && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(response) ?? backoffMs(attempt));
        continue;
      }

      if (response.status >= 500 && idempotent && attempt < this.maxRetries) {
        await this.sleep(backoffMs(attempt));
        continue;
      }

      const body = await readBody(response);
      if (!response.ok) throw new AppmaxApiError(response.status, method, path, body);
      return (body as { data: T }).data;
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    // Chamadas concorrentes compartilham a mesma requisição de token: a rota de
    // autenticação tem limite próprio (5 req/min).
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async fetchToken(): Promise<string> {
    const response = await this.fetchImpl(new URL("/oauth2/token", this.hosts.auth), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });
    const body = await readBody(response);
    if (!response.ok) throw new AppmaxApiError(response.status, "POST", "/oauth2/token", body);

    const { access_token, expires_in } = body as { access_token: string; expires_in: number };
    this.token = {
      value: access_token,
      expiresAt: this.now() + expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return access_token;
  }

  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    if (slot > now) await this.sleep(slot - now);
  }
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
