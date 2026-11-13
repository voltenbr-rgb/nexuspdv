# Nexus PDV

Frente de caixa (PDV) para pequenos negócios, no Cloudflare Pages com banco D1 `nexuspdv`.

## Estrutura
| Arquivo | O que faz |
|---|---|
| `index.html`, `styles.css`, `app.js`, `db.js` | Site e app do caixa (funciona offline e sincroniza com a nuvem) |
| `functions/api/[[path]].js` | API na Cloudflare: cadastro/login, caixa ligado, mensagens, Área Master e manifesto do app |
| `schema.sql` | Tabelas do banco D1 (já criadas no `nexuspdv`) |
| `wrangler.toml` | Liga o projeto ao banco D1 `nexuspdv` (binding `DB`) automaticamente |
| `sw.js`, `icons/` | App instalável (PWA) |
| `_headers` | Cabeçalhos de segurança e cache |

## App instalável
Depois do login, o app passa a se chamar **"PDV + nome da loja"** (ex.: *PDV Loja Eric*), no celular e no computador.
No Android/Chrome aparece o botão **Instalar app**. No iPhone: Compartilhar → Adicionar à Tela de Início.

## Temas
- **Amarelo** (padrão): branco com amarelo
- **Verde** e **Laranja**
- **Modo azul**: branco com azul (barra lateral azul, cards brancos)

Só o ADM escolhe a aparência da loja (Configurações ADM → Aparência), e ela vale em todos os aparelhos. O botão 🔵 **Modo azul**, no topo do caixa, alterna entre o azul e o tema da loja naquele aparelho.

## Caixa
- Duas colunas, cada uma com rolagem própria: **Categorias** (montadas a partir dos produtos) | **Todos os produtos** em cards, em ordem alfabética
- Cards com preço em destaque, favoritos (♥), estoque por cor e botão Adicionar
- Carrinho com miniaturas, quantidade, remover, desconto (R$ ou %, protegido pela senha de autorização) e forma de pagamento
- Aviso do teste de 7 dias: mostra quantos dias restam e volta a cada 24 h depois de fechado. No último dia não dá para fechar, e o botão vira **Conhecer os planos**. O pedido de plano aparece na Área Master (filtro "Pedidos de plano").

## Área Master
Pontinho colorido no rodapé da **página inicial**, à direita do texto "Simples para começar. Pronto para crescer.". Ele não aparece dentro da loja dos clientes.
- Primeiro acesso: código de configuração (de uso único) + criação da senha master (mín. 8 caracteres).
- Quantas lojas estão cadastradas e quantos caixas estão ligados agora (ícone verde).
- Status por cor: **verde** ativo (pago) · **amarelo** em teste ou pagamento pendente (até 7 dias do vencimento) · **vermelho** desativado ou vencido há mais de 7 dias.
- Ativar pacotes: Básico, Completo ou Premium por 15 dias, 30 dias, 3 meses, 6 meses ou 1 ano (soma ao tempo que ainda resta).
- Redefinir senha do cliente: gera uma senha provisória, e o cliente cria uma nova no próximo login. Ninguém consegue ver as senhas, porque ficam só em hash.
- Desativar/reativar loja.
- Mensagens para todas as lojas (informação, aviso ou urgente).
- A Área Master **não** acessa estoque nem vendas das lojas.

Opcional: para usar uma senha master definida no painel da Cloudflare em vez da criada no primeiro acesso, crie o segredo `MASTER_PASSWORD` em *Settings → Variables and Secrets*.

## Planos (ilustrativos)
Básico R$ 39,90 · Completo R$ 99,90 · Premium R$ 189,90 por mês.

## Produtos
- Cadastro e edição no mesmo formulário: código de barras, nome, **categoria** (escolha uma existente ou **➕ Nova categoria**), **preço de venda** (obrigatório), **preço de custo** (opcional), estoque e margem de lucro calculada na hora.
- A tela de estoque mostra custo, preço e margem.
- Excluir e editar seguem as permissões do ADM. Exclusões e cadastros valem em todos os aparelhos, mesmo depois de recarregar a página.
- As janelas só fecham pelo **X**. Um clique fora não apaga o que já foi digitado: a janela balança e avisa onde fechar.

## Configurações ADM e permissões
- A tela **Configurações ADM** fica trancada. Só abre com a **senha do ADM**, e tranca de novo quando você sai dela.
- No primeiro acesso, o dono confirma a senha da conta e cria a senha do ADM.
- **Senha do atendente/supervisor** (opcional), criada pelo ADM.
- Para cada ação, o ADM escolhe: ✅ livre, 🟡 senha do atendente, ou 🔴 só senha do ADM.
  Ações: excluir produto, alterar preço/estoque, cadastrar produto, dar desconto, tirar item/limpar venda, reimprimir recibo.
- A senha é digitada numa janela própria (oculta), e não numa caixa de texto aberta.
- Senhas guardadas com PBKDF2. Valem em todos os aparelhos da loja (sincronizadas).

## Periféricos
- **Leitor de código de barras USB:** barra no topo do caixa, bipe sonoro, cadastro rápido de código desconhecido. Atalhos: **F2** (tecla do teclado) põe o cursor no campo do leitor para bipar, F4 finaliza a venda, Esc fecha janelas.
- **Impressora térmica 58/80 mm:** recibo não fiscal, configurável em Configurações ADM → Configuração de Hardware. Para imprimir sem diálogo, abra o Chrome com `--kiosk-printing`.

## Segurança
- Senhas com PBKDF2-SHA256 (100 mil iterações) e tokens de sessão guardados só em hash.
- Limite de tentativas de login (loja e master).
- Quando a Área Master redefine a senha ou desativa uma loja, as sessões dela caem na hora.

## Sincronização incremental
O caixa funciona offline e envia **só o que mudou**, sem regravar a base inteira.

**No aparelho (IndexedDB `nexuspdv` v2):** a loja, os produtos e as vendas ficam em tabelas separadas, e cada alteração grava apenas o registro afetado. A fila `outbox` guarda o que ainda falta enviar.

**Envio (`POST /api/sync/push`):** a fila sobe em lotes. Alterações repetidas do mesmo produto viram uma só. Cada lote grava numa única transação no D1 (`db.batch`).
- Produto criado ou editado: vence a alteração mais recente (`modified_at`). O estoque tem marca de tempo própria.
- Produto excluído: fica marcado como excluído, para os outros aparelhos também removerem.
- Venda nova: o servidor dá baixa no estoque uma única vez (`stock_applied`), mesmo que o envio se repita. Duas vendas ao mesmo tempo em aparelhos diferentes descontam as duas.
- Configurações (impressora, favoritos, senha de autorização).

**Recebimento (`GET /api/sync/pull`):** baixa só as linhas novas desde o último cursor (`updated_at` + `id`). Num aparelho novo, vêm os produtos e as vendas dos últimos 30 dias.

**Quando sincroniza:** 1,5 s depois de cada alteração, a cada 30 s e quando a internet volta. O status aparece na barra lateral ("Sincronizado às…" / "N alterações para enviar").

**Índices no D1 (conferidos com `EXPLAIN QUERY PLAN`, todos com SEARCH USING INDEX e sem ordenação extra):**
| Índice | Consulta |
|---|---|
| `idx_products_sync (store_id, updated_at, id)` | baixar produtos alterados |
| `idx_sales_sync (store_id, updated_at, id)` | baixar vendas novas |
| `idx_settings_sync (store_id, updated_at, key)` | baixar configurações |
| `idx_products_code (store_id, code)` | busca por código de barras |
| `idx_sales_created (store_id, created_at)` | relatórios por período |
| `idx_stores_created (created_at)` | lista da Área Master |

## Próximos passos
- Pix com Mercado Pago (token guardado como segredo no servidor).
- Numeração de vendas única entre vários caixas da mesma loja.
