# Nexus PDV

Frente de caixa (PDV) para pequenos negócios, no Cloudflare Pages com banco D1 `nexuspdv`.

## Estrutura
| Arquivo | O que faz |
|---|---|
| `index.html`, `styles.css`, `app.js`, `db.js` | Site e app do caixa (funciona offline; os dados do caixa ficam no aparelho, em IndexedDB `nexuspdv`) |
| `functions/api/[[path]].js` | API na Cloudflare: cadastro/login, caixa ligado, mensagens, Área Master e manifesto do app |
| `schema.sql` | Tabelas do banco D1 (já criadas no `nexuspdv`) |
| `wrangler.toml` | Liga o projeto ao banco D1 `nexuspdv` (binding `DB`) automaticamente |
| `sw.js`, `icons/` | App instalável (PWA) |
| `_headers` | Cabeçalhos de segurança e cache |

## App instalável
Depois do login, o app passa a se chamar **"PDV + nome da loja"** (ex.: *PDV Loja Eric*), no celular e no computador.
No Android/Chrome aparece o botão **Instalar app**. No iPhone: Compartilhar → Adicionar à Tela de Início.

## Tema
Branco com laranja (padrão), branco com amarelo ou escuro: escolha em Configurações ADM → Aparência.

## Área Master
Botão redondo pequeno no rodapé, à direita.
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

## Periféricos
- **Leitor de código de barras USB:** barra no topo do caixa, bipe sonoro, cadastro rápido de código desconhecido. Atalhos: F2 foca o leitor, F4 finaliza a venda, Esc fecha janelas.
- **Impressora térmica 58/80 mm:** recibo não fiscal, configurável em Configurações ADM → Configuração de Hardware. Para imprimir sem diálogo, abra o Chrome com `--kiosk-printing`.

## Segurança
- Senhas com PBKDF2-SHA256 (100 mil iterações) e tokens de sessão guardados só em hash.
- Limite de tentativas de login (loja e master).
- Quando a Área Master redefine a senha ou desativa uma loja, as sessões dela caem na hora.

## Próximos passos
- Sincronizar produtos e vendas com o D1 (hoje ficam no aparelho).
- Pix com Mercado Pago (token guardado como segredo no servidor).
