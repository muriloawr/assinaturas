# Assinaturas

Painel e back-end para gerenciar as assinaturas de lojas que vendem pela **Appmax**.

Primeiro objetivo: resolver dois problemas de um cliente real.

1. **Cupom do primeiro pedido valendo em todas as cobranças.** O sistema encontra as assinaturas afetadas e calcula quanto deixa de ser cobrado por ciclo (veja [docs/appmax.md](docs/appmax.md#o-bug-do-cupom)).
2. **Assinantes que querem alterar a assinatura** (pausar, pular ciclo, trocar produto, dia ou cartão, cancelar). A API da Appmax permite tudo isso; as ações entram no painel e depois num portal do assinante.

Esta base também é o começo do conector Appmax do SaaS de assinaturas descrito no planejamento.

## Como funciona

```text
Appmax ──webhook──▶ apps/api ──fila (pg-boss)──▶ sincronização ──GET /v1/subscriptions/{id}──▶ Appmax
                       │                               │
                       │                               ▼
                       │                         Postgres (espelho)
                       │                               ▲
apps/web (painel) ─────┴──── API interna ──────────────┘
```

- **A Appmax é a fonte de verdade.** O banco local é um espelho para o painel não gastar a quota da API (100 mil requisições/mês por loja).
- **O webhook é só um gatilho.** A Appmax não assina os webhooks (sem HMAC), então nunca gravamos o conteúdo deles como estado: ao receber um evento, buscamos a assinatura na API e gravamos a resposta.
- **Reconciliação diária às 5h** (e sob demanda no painel) percorre a listagem da Appmax e sincroniza o que estiver diferente. Ela recupera webhooks perdidos: a Appmax desiste depois de 4 tentativas, sem avisar.

As decisões e o porquê de cada uma estão em [docs/decisoes.md](docs/decisoes.md).

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/appmax` | Cliente tipado da API da Appmax: token com cache, limite de 4 req/s, nova tentativa em 429/5xx. |
| `packages/db` | Schema do banco (Drizzle + Postgres) e migrações. |
| `apps/api` | Fastify: recebe webhooks, roda os jobs (pg-boss) e serve a API interna do painel. |
| `apps/web` | Painel em Next.js: visão geral, lista e detalhe das assinaturas, relatório do cupom com exportação CSV. |

## Rodando localmente

Requisitos: Node 22+, pnpm 10 e Docker (ou um Postgres 16 local).

```bash
pnpm install
cp .env.example .env          # preencha ENCRYPTION_KEY, ADMIN_API_TOKEN e PANEL_PASSWORD
pnpm db:up                    # Postgres no Docker
pnpm db:migrate
```

Cadastre a loja com as credenciais geradas em **painel da Appmax → API → Credenciais** (comece pelo sandbox):

```bash
APPMAX_CLIENT_ID=... APPMAX_CLIENT_SECRET=... pnpm store:add "Nome da loja" sandbox
```

O comando valida as credenciais na Appmax e mostra a URL de webhook para cadastrar em **painel da Appmax → API → Webhooks**, com os eventos de assinatura marcados.

```bash
pnpm dev                      # API em :3333 e painel em :3000
```

Abra http://localhost:3000 (usuário `admin`, senha do `PANEL_PASSWORD`) e clique em **Sincronizar tudo com a Appmax** para a carga inicial.

Para a Appmax entregar webhooks na sua máquina, exponha a API com um túnel (ngrok, cloudflared) e use a URL pública em `API_PUBLIC_URL`.

## Testes

```bash
pnpm typecheck
pnpm test                                          # testes unitários
DATABASE_URL=postgres://... pnpm --filter @assinaturas/api test   # inclui o teste de integração com o banco
```

O teste de integração simula a API da Appmax e cobre a reconciliação, a sincronização, o relatório do cupom e o recebimento de webhooks (deduplicação e token inválido).

## Próximos passos

1. **Confirmar o diagnóstico com dados reais**: cadastrar a loja do cliente, sincronizar e conferir o relatório do cupom com 2 ou 3 casos conhecidos.
2. **Descobrir quem cria as assinaturas hoje** (checkout da Appmax, Shopify ou integração própria) e corrigir na origem: criar sempre com `products` e aplicar o cupom só no 1º ciclo com `PATCH /v1/subscriptions/{id}/cycles/discount`.
3. **Plano para as assinaturas já afetadas** (decisão comercial do cliente): testar no sandbox recriar a assinatura com produtos a partir do último pedido pago e cancelar a antiga, com aviso prévio ao assinante.
4. **Ações no painel** com registro em `audit_logs`: pausar, reativar, pular ciclo, alterar desconto, cancelar. O cliente em `packages/appmax` já tem esses métodos.
5. **Portal do assinante** com link mágico por e-mail/WhatsApp.
6. **Login de verdade no painel** no lugar do Basic Auth provisório.
