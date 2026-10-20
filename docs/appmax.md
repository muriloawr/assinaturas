# Notas sobre a API da Appmax

Resumo do que importa para este projeto, tirado de https://docs.appmax.com.br (lido em outubro de 2026). O índice completo para leitura por máquina fica em https://docs.appmax.com.br/llms.txt; cada página tem versão `.md`.

## Ambientes

| | Autenticação | API |
|---|---|---|
| Sandbox | `https://auth.sandboxappmax.com.br` | `https://api.sandboxappmax.com.br` |
| Produção | `https://auth.appmax.com.br` | `https://api.appmax.com.br` |

Token: `POST /oauth2/token` com `grant_type=client_credentials` (form-urlencoded). Dura 1 hora e não há refresh token: quando vence, pedimos outro. As credenciais do **merchant** (não as do app) são as que operam assinaturas.

## Limites

- 5 req/s sustentadas, rajada de 50, **100 mil requisições/mês** por `client_id`. A autenticação também conta.
- 60 req/min por rota transacional; 5 req/min nas rotas de login e credenciais.
- Excedeu: `429` com `Retry-After`.

## Assinaturas (recorrência, em beta)

- `POST /v1/subscriptions` transforma um **pedido aprovado** (cartão ou Pix) em assinatura.
- `GET /v1/subscriptions` exige `email` **ou** intervalo `next_charge_from`/`next_charge_to`. São 10 por página. Datas da listagem vêm em `dd/mm/aaaa`.
- `GET /v1/subscriptions/{id}` traz produtos, ciclos e histórico de cobranças. O histórico pode não incluir o ciclo 0.
- Cada ciclo gera um **pedido novo** (`order_id` muda; `subscription_id` não).
- Alterar produtos só com a assinatura ativa, não pausada e sem cobrança em andamento (senão `409`/`422`).
- Valor mínimo de cobrança: R$ 5,00.

Endpoints de alteração: pausar, reativar, cancelar, alterar dia de cobrança, antecipar cobrança, alterar periodicidade, pular e despular ciclo, endereço, tag, desconto (permanente ou de um ciclo), forma de pagamento (token gerado no navegador pelo Appmax JS), e produtos (permanentes ou de um ciclo).

## O bug do cupom

Da página [Criar assinatura](https://docs.appmax.com.br/api-reference/subscriptions/criar-assinatura):

> `products` — Produtos que compõem a assinatura. [...]
> `discount` — Omitido, a assinatura nasce sem desconto — o cupom do pedido de origem não é herdado.

E de [Adicionar produtos](https://docs.appmax.com.br/api-reference/subscriptions/adicionar-produtos):

> Assinaturas criadas sem `products` (que herdam o valor do pedido) respondem `404` aqui.

Ou seja: o cupom não é herdado **como desconto**, mas quando a assinatura nasce sem `products` ela herda **o valor do pedido**, que já tem o cupom aplicado. Resultado: o valor com desconto se repete em todo ciclo, e a assinatura não aceita os endpoints de produto.

**Forma correta:** criar com `products` (preço cheio do catálogo) e aplicar o cupom só no primeiro ciclo com `PATCH /v1/subscriptions/{id}/cycles/discount` (desconto que vale apenas em um ciclo e substitui o da assinatura).

**Assinaturas já afetadas:** o desconto da assinatura só reduz o valor, e os endpoints de produto respondem `404`, então não há como subir o valor delas pela API. Caminho a testar no sandbox: criar uma nova assinatura com `products` a partir do último pedido pago (um mesmo pedido pode originar mais de uma assinatura) e cancelar a antiga.

> Pedidos de checkout **Shopify** exigem `products` com `shopify_product_id` + `shopify_variant_id` e o preço vem da variante. Se o cliente vende pela Shopify, a causa do bug é outra e precisa ser investigada.

## Webhooks

- Envelope: `event`, `event_type`, `site_id`, `app_id`, `data`, `partner_merchant`.
- Eventos de assinatura: `subscription_created`, `subscription_cancelation`, `subscription_paused`, `subscription_resumed`, `subscription_charge_success`, `subscription_charge_failed`, `subscription_product_added`/`removed`/`quantity_changed`, `subscription_frequency_changed`, `subscription_cycle_skipped`/`unskipped`, `subscription_billing_day_changed`, `subscription_next_billing_day_changed`, `subscription_address_updated`, `subscription_payment_method_updated`. O `subscription_delayed` é legado e não é mais emitido.
- **Sem HMAC e sem ID de evento.** Deduplicar por `event + subscription_id + order_id`.
- Timeout de 5 s; até 4 tentativas (na hora, +30 min, +2 h, +4 h) e depois o webhook é descartado sem aviso.
- Webhooks do **painel** (credenciais geradas pelo lojista) têm formato diferente dos da Appstore; a página `guides/webhooks-painel` não estava publicada quando lemos. Por isso o recebimento só confia no `subscription_id` e busca o resto na API.
