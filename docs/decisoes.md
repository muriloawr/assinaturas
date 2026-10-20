# Decisões

Registro curto das decisões de arquitetura e do motivo de cada uma. Quando uma mudar, edite a entrada e diga o que mudou e por quê.

## 1. Começar como camada sobre a Appmax, não como motor de cobrança próprio

O planejamento original previa um SaaS que controla o calendário de cobranças e usa gateways só para processar. Invertemos o caminho: primeiro resolver a dor de um cliente que já vende pela Appmax.

A Appmax já tem motor de recorrência com API para pausar, pular ciclo, trocar produto, dia, periodicidade e cartão, e aplicar desconto por ciclo. Então **a Appmax continua sendo a fonte de verdade** e nós somos o painel, o portal e as automações em cima dela. Este código vira o conector Appmax do SaaS mais tarde.

Risco: a documentação marca a recorrência como **beta**.

## 2. Stack: TypeScript de ponta a ponta, um monorepo

Uma pessoa vai manter tudo, então: uma linguagem, um repositório, tipos compartilhados entre back e front.

- **Next.js** no painel (e, depois, no portal do assinante).
- **Fastify** separado do Next, porque webhooks precisam responder em menos de 5 s e os jobs precisam de um processo que fica no ar. O modelo serverless do Next não serve para isso. Fastify em vez de NestJS para ter menos código de estrutura.
- **Postgres + Drizzle**: SQL explícito e tipado, migrações geradas.
- **pg-boss** como fila, dentro do próprio Postgres. Não há Redis para operar.
- **tsx** roda o TypeScript direto em desenvolvimento e produção. Sem etapa de build no back por enquanto.

## 3. Espelho local em vez de consultar a Appmax a cada tela

A API tem limite de 5 req/s e **100 mil requisições/mês** por credencial, e a listagem exige filtro (e-mail ou intervalo de próxima cobrança) e devolve 10 itens por página. Um painel que consultasse a Appmax a cada tela estouraria a quota e seria lento. Por isso o painel lê do Postgres.

## 4. Webhook é gatilho, a API é a verdade

Os webhooks da Appmax:
- não têm assinatura (HMAC) nem ID de evento;
- têm formato diferente entre Appstore e painel;
- são descartados depois de 4 tentativas, sem aviso.

Então ao receber um evento só gravamos o payload bruto (`webhook_events`) e enfileiramos uma sincronização, que busca `GET /v1/subscriptions/{id}`. Um evento forjado no máximo gasta uma requisição. A URL do webhook leva um token derivado do id da loja (HMAC com `ENCRYPTION_KEY`) para recusar chamadas de terceiros.

A fila de sincronização usa a política `stately` do pg-boss: no máximo um job esperando e um rodando por assinatura. Uma rajada de webhooks vira uma sincronização, e um evento que chega durante a sincronização ainda gera mais uma.

Deduplicação (`dedupe_key`) só para eventos que acontecem uma vez por pedido (`subscription_created`, `subscription_charge_success`, `subscription_cancelation`). Os outros se repetem legitimamente com o mesmo `order_id`. Exemplos: pausar, retomar e pausar de novo; retentativas de cobrança recusada reutilizam o pedido.

## 5. Dinheiro em centavos

A Appmax devolve assinaturas em reais (`199.9`) e pedidos em centavos (`19990`). Convertemos tudo para centavos inteiros na entrada (`reaisToCents`).

## 6. Datas no horário de Brasília

A API usa três formatos (`aaaa-mm-dd hh:mm:ss`, `dd/mm/aaaa` e ISO-8601), sempre no horário de Brasília. `parseAppmaxDate` converte todos para `timestamptz`.

## 7. Credenciais pelo painel da Appmax, não por app da Appstore

Com um cliente só, o caminho mais curto é ele gerar `client_id`/`client_secret` em **painel → API**. O `client_secret` fica criptografado (AES-256-GCM) na tabela `stores`. Quando virar SaaS, criamos um app público na Appstore com o fluxo de instalação. A tabela `stores` já é multi-loja.

## 8. Relatório do cupom aponta, não corrige

Aumentar o valor de quem já assina é decisão comercial e precisa de aviso prévio (CDC), senão vira chargeback. O relatório mostra os casos e a diferença por ciclo; a correção será uma ação explícita, registrada em `audit_logs`.
