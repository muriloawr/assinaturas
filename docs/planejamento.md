# SaaS de Assinaturas — Planejamento e Continuidade

**Checkpoint:** 15/10/2026  
**Status:** descoberta e validação, ainda sem desenvolvimento do MVP.  
**Objetivo do fundador:** construir no tempo livre, sem tirar pessoas da agência, mantendo a agência em operação e desenvolvendo um SaaS recorrente escalável.

> **Proposta de posicionamento:** **Gestão 360º das suas assinaturas.** Conecte canais de venda, gateways de pagamento, ERPs e CRMs. Venda por checkout próprio, automatize cobranças e entregas e ofereça uma área para o assinante gerenciar sua assinatura.

## 1. Decisões alinhadas até agora

1. **Não criar um gateway próprio no MVP.** Usar provedores existentes como processadores de pagamentos. A hipótese de se tornar Shopify Payments Partner fica para o futuro, dependendo de demanda, volume e aprovação formal da Shopify.
2. **Criar nosso próprio checkout de assinaturas white-label** desde a primeira versão, com front-end controlado pelo SaaS. A captura/tokenização de cartão deve ocorrer por componentes/SDKs seguros do processador, conforme suas APIs e obrigações PCI. Não é simplesmente colocar uma página bonita antes de um link do Asaas.
3. **Lojista usa seu gateway**, quando suportado pelo conector. Nosso SaaS orquestra plano, checkout, contrato, ciclos, portal do assinante, integrações e analytics; o gateway processa, guarda dados financeiros autorizados e liquida as cobranças.
4. **Um portal white-label próprio do assinante**, que funciona sem Shopify, VTEX ou outra loja. Em plataformas compatíveis, desenvolver interfaces nativas conectadas ao mesmo backend — por exemplo, a Customer Account UI Extension da Shopify.
5. **Não disputar espaço com CRMs.** Emitir eventos normalizados por webhooks/API e criar conectores para Bevean, Zoppy, Martz, RD Station e outros, sem implementar um CRM completo.
6. **Ter dois módulos sobre o mesmo motor:** serviços e produtos físicos, inclusive combinação dos dois no mesmo plano.
7. **Não criar ERP, agenda de barbearia, sistema de comissões ou gestão clínica.** Integrar com ferramentas usadas pelos clientes. Cada novo cliente deve idealmente ativar a plataforma sem desenvolvimento personalizado.
8. **Começar pequeno e pagar a validação com clientes reais** antes de ampliar integrações; sem deslocar equipe da agência.

## 2. A pergunta atual: serviços são uma escada ou uma distração?

**Resposta discutida:** o módulo de serviços pode ser uma **escada de entrada** porque reutiliza checkout, cobrança recorrente, portal do assinante, métricas, contratos e eventos de CRM, mas inicialmente dispensa catálogo complexo, SKU, estoque, frete, expedição e pedidos em ERP.

### Pontos a favor

- Reduz o escopo de engenharia para conseguir os primeiros clientes pagantes.
- Permite testar aquisição e onboarding sem depender de e-commerce.
- Aproveita grande parte da infraestrutura que será usada mais tarde para produtos físicos.
- Oferece entrada para clientes que vendem por WhatsApp, Instagram, site ou link.

### Riscos

- **Concorrência nos serviços é alta.** Plataformas como Trinks, Gendo, AppBarber e BarberCloud já oferecem recursos de clubes de assinatura e/ou recorrência para barbearias.
- O lojista pode preferir um sistema vertical que já une agendamento, caixa, funcionários e mensalidades. Não tentar substituí-lo.
- Gateways como Asaas e Vindi já oferecem cobrança recorrente: o valor do SaaS não pode ser apenas “cobrar uma mensalidade”.
- Pedidos de controle de agenda, comissões, prontuário e regras próprias de cada vertical podem criar uma agência de integrações disfarçada de SaaS.

**Conclusão:** lançar um módulo horizontal simples de assinatura de serviços como **porta de entrada**, mas não posicionar toda a empresa como software de barbearias. Barbearias são candidatas a testes, não necessariamente o segmento principal. Priorizar negócios que desejam **manter seu sistema atual** e adicionar recorrência com checkout/portal/automação.

### Exemplos de experiências

- **Barbearia:** assinatura de quatro cortes por mês, com direito de uso registrado e acesso ao portal; agenda continua no sistema atual.
- **Estética:** assinatura de sessões com possibilidade de agregar produtos, sem criar prontuário ou agendamento próprios.
- **Serviços B2B:** mensalidades de suporte, manutenção ou consultoria — cobrança, portal e status do contrato.
- **Produtos físicos:** após a renovação paga, criar pedido com SKUs no Bling ou Olist/Tiny.
- **Assinatura híbrida:** serviços mensais + produtos enviados em determinados ciclos.

## 3. Arquitetura-alvo

```text
Canais de aquisição
  ├─ Link de assinatura/WhatsApp/Instagram/site
  ├─ E-commerce Shopify (integração autorizada)
  └─ Futuras lojas VTEX/Tray/Bagy/etc.
                  |
          Checkout white-label
                  |
          Core de assinaturas
          ├─ planos e preços
          ├─ assinantes e identidades
          ├─ contratos e ciclos
          ├─ portal do assinante
          ├─ direitos de uso (serviços)
          ├─ produtos/SKUs (físicos)
          ├─ eventos / webhooks / analytics
          └─ mapeamento de conectores
             /              |             \
      Gateways           ERPs/lojas        CRM
  (Asaas/Pagar.me/   (Bling/Olist/     (Bevean/Zoppy/
   Appmax/etc.)      Shopify/etc.)      Martz/RD/etc.)
```

**Princípio central:** o SaaS é o dono da experiência e do modelo lógico da assinatura, mas o gateway é a fonte de verdade das operações financeiras. Sincronizar estados sem cobrar em duplicidade. Tokens de cartão e contratos financeiros não são automaticamente portáveis entre gateways.

### Dois front-ends para assinantes

1. **Portal hospedado white-label:** subdomínio da marca, acesso por código/link temporário e autenticação reforçada para operações sensíveis. Deve funcionar com qualquer origem de venda.
2. **Extensão nativa por plataforma:** Shopify Customer Account UI Extensions nas contas compatíveis; outras plataformas apenas quando API, autenticação e demanda justificarem. Mesma API e regras de negócio, interfaces específicas.

### Eventos de domínio (exemplos)

- `subscription.created`
- `subscription.renewal_upcoming`
- `subscription.payment_succeeded`
- `subscription.payment_failed`
- `subscription.paused`
- `subscription.plan_changed`
- `subscription.cancellation_requested`
- `subscription.cancelled`
- `subscription.reactivated`
- `entitlement.granted` / `entitlement.used`
- `fulfillment.order_created`

Prever idempotência, retries, filas, logs, autenticação de webhooks, auditoria e LGPD desde o começo.

## 4. Mercado e concorrência — hipóteses a conferir

### Plataformas de assinaturas e checkout

- **Rits:** checkout/recorrência, portal, integrações anunciadas com ERP e e-commerce. Site: https://ritspay.com/
- **AssineStore:** clubes e links, com integrações anunciadas com Bling e Olist/Tiny. Site: https://www.assinestore.com.br/
- **Betalabs:** plataforma com recursos de assinaturas, checkout e gestão operacional. Verificar diferenças entre ERP nativo e ERP externo.
- **CartPanda:** checkout/e-commerce com recorrência, vários gateways anunciados; confirmar quais realmente funcionam para assinaturas.
- **PagBrasil/PagStream:** assinaturas e área do assinante dentro da Shopify, com login único. Fonte: https://www.pagbrasil.com/pt-br/blog/pagamento-recorrente/nova-area-do-assinante-pagstream-para-shopify-login-unico-para-uma-experiencia-sem-friccao/
- **Vindi, Asaas, Mercado Pago, Pagar.me, Cielo, PagBank, iugu:** processadores e/ou plataformas financeiras com ofertas de recorrência em diferentes formatos.

**Cuidado com pesquisas anteriores:** uma contagem exploratória de cerca de 12 fornecedores não é um censo exaustivo do setor. Qualquer matriz definitiva deve distinguir (a) gateway com API recorrente, (b) checkout/link de assinaturas, (c) portal do assinante, (d) geração de pedidos no ERP, (e) múltiplos gateways realmente compatíveis com recorrência — não somente pagamentos avulsos.

### Concorrentes de serviço/barbearia

- Trinks
- Gendo
- AppBarber
- BarberCloud

**Diferenciação hipotética:** cobrar e administrar assinaturas **sem obrigar o negócio a migrar o sistema de agendamento, ERP ou CRM**. Validar se há disposição a pagar por essa independência.

### Produtos físicos de reposição

- Pet (ração, higiene e outros consumíveis)
- Suplementos/nutrição
- Cosméticos/cuidados pessoais
- Café e alimentação
- Caixas e clubes curados

Prioridade comercial provável: cosméticos/suplementos para usar conexões existentes, depois pet.

## 5. Diferenciação que queremos testar

Não ser só “um gerador de links recorrentes” e não ser “mais um gateway”.

**Proposta:** checkout próprio + portal white-label + gestão do ciclo + integração operacional + eventos de CRM + escolha do processador que o lojista já utiliza.

Possíveis argumentos de venda:

- Permite vender assinaturas fora do checkout da loja, por canais apropriados e compatíveis com as regras da plataforma.
- Após pagamento confirmado, gera pedidos operacionais com SKUs no ERP, quando aplicável.
- Não obriga a abandonar ERP, gateway, CRM ou agenda atuais.
- Permite ao cliente final pausar, trocar plano, adiar ciclo e cancelar de modo transparente, de acordo com os recursos disponíveis.
- Permite combinações de produtos e serviços, com controles distintos por tipo de entrega.

**Hipótese ainda não validada:** empresas pagariam pelo conjunto de integração e experiência em vez de usar gratuitamente as ferramentas do próprio gateway.

## 6. MVP enxuto para desenvolver no tempo livre

### Núcleo indispensável

- Organização/lojista e credenciais de um gateway.
- Um tipo de plano de assinatura e ciclo mensal.
- Checkout visualmente próprio, com processamento/tokenização seguros do PSP.
- Webhooks de pagamento e estados da assinatura, com idempotência.
- Lista de assinantes, contratos e cobranças no painel B2B.
- Portal B2C para visualizar e cancelar; pausa/troca conforme operações suportadas.
- Eventos padronizados e webhook genérico de saída.
- Logs, falhas, retentativas e conciliação mínima.

### O que não entra na primeira versão

- Cinco gateways ao mesmo tempo.
- ERP completo ou módulos verticais de barbearia.
- Agenda, prontuário, controle de comissão.
- Gestão fiscal complexa.
- Aplicativo nativo para todos os e-commerces.
- Shopify Payments Partner ou gateway próprio.
- CRM interno.

### Segunda etapa

- 2º gateway para provar arquitetura multigateway.
- Criação automática de pedido no Bling, seguida por Olist/Tiny.
- Produtos físicos e combinações com serviços.
- Módulo de retenção e analytics mais sofisticado.
- Integrações nativas de CRMs e Shopify Customer Accounts, conforme viabilidade comercial/política.

## 7. Riscos e validações que não podemos pular

1. **Checkout Shopify:** aplicativos públicos não podem presumir o direito de desviar checkout para uma página externa e registrar transações depois via Admin API. Validar qualquer arquitetura de canal de vendas com as regras vigentes da Shopify.
2. **Payments Partner:** processo de aprovação separado, sem garantia decorrente de volume de pagamentos. Deixar para o futuro.
3. **Autorização de recorrência:** comprar uma vez no cartão não autoriza automaticamente cobranças futuras. Verificar tokenização, consentimento e o fluxo do primeiro pagamento para cada gateway.
4. **PCI/LGPD:** preferir campos hospedados/tokenização oferecida pelo PSP e avaliar escopo de conformidade da implementação.
5. **Duplicidade:** nunca criar dois pedidos para a mesma renovação, especialmente quando o gateway já sincroniza pedidos para a Shopify e o ERP.
6. **Cobrança vs. assinatura vs. pedido:** modelos de estado e fontes de verdade separados.
7. **Suporte:** evitar integrações sob medida como padrão e oferecer onboarding realmente repetível.
8. **Serviços:** não acrescentar operações verticais profundas só para fechar o primeiro contrato.

## 8. Avaliação estratégica anterior

Avaliação subjetiva feita na conversa (não é probabilidade estatística):

- **73/100:** foco apenas em assinatura de produtos físicos, sem validação.
- **79/100:** serviços + produtos físicos, com lançamento gradual; maior facilidade de MVP e base comercial.
- O foco apenas em barbearias foi considerado **menos atraente**, pois já existem plataformas verticais robustas.

**Interpretação:** oportunidade suficiente para um piloto enxuto, ainda sem evidência para investir pesado ou sacrificar a operação da agência.

## 9. Próxima conversa — por onde retomar

1. **Definir o ICP inicial**: prestadores B2B, barbearias com software já implantado, clínicas/estética ou e-commerce de cosméticos e suplementos?
2. **Escolher o primeiro gateway** pela combinação de checkout próprio com tokenização segura, criação/alteração/cancelamento de assinatura e webhooks (comparar Asaas, Pagar.me e alternativas).
3. **Desenhar o modelo de dados:** organizações, planos, assinantes, assinaturas, ciclos, pagamentos, benefícios, fulfillment e conectores.
4. **Definir o portal do assinante MVP:** leitura, pausa, cancelamento, atualização do método de pagamento e regras claras.
5. **Preços e disposição a pagar:** entrevistar de 5 a 10 possíveis clientes e testar planos mensais, sem só repetir funcionalidades gratuitas de gateways.
6. **Planejar experimento de 30 dias no tempo livre** com entregáveis pequenos, sem depender de customização.

### Pergunta-chave para a retomada

> Se serviços são a porta de entrada, qual tipo de empresa possui base recorrente grande o suficiente para pagar por uma plataforma separada — e consegue se beneficiar do checkout e portal sem precisar de agenda, comissões ou ERP próprios?

---

**Resumo em uma frase:** construir um SaaS horizontal de assinatura com checkout e portal white-label, usando gateways existentes e integrações progressivas; lançar inicialmente serviços simples para validar com pouco esforço, mas preservar produtos físicos e ERP como expansão estratégica.
