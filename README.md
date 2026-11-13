# nexus_pdv — protótipo front-end

## Arquivos
- `index.html`: landing page, modais e estrutura do PDV.
- `styles.css`: identidade visual, três temas e layout responsivo.
- `app.js`: autenticação demonstrativa, fluxo do caixa, estoque, teste de 7 dias e configurações.
- `db.js`: persistência por `empresa_id` usando IndexedDB.

## Executar localmente
Como os módulos ES usam `type="module"`, abra por um servidor HTTP local (não via `file://`).

Exemplo com Python:
```bash
python -m http.server 8000
```
Acesse `http://localhost:8000`.

## O que funciona neste protótipo
- Landing page responsiva com alternância Dark / Azul / Esmeralda.
- Cadastro de loja de demonstração e login local por e-mail/senha.
- `empresa_id` isolando os dados de cada loja no IndexedDB.
- Período demonstrativo de 7 dias.
- Aviso de teste que, ao ser fechado, fica oculto por 24 horas via timestamp no `localStorage`.
- PDV demonstrativo com busca por nome/código, carrinho, quantidade e finalização de venda.
- Produtos e estoque com cadastro, edição e exclusão.
- Configuração de senha mestre para proteger ações sensíveis.
- Easter egg discreto com contador ilustrativo.

## Limitações importantes antes de produção
Este é um protótipo executável no navegador, não um SaaS multi-tenant seguro. O `empresa_id` no cliente não constitui isolamento de segurança. IndexedDB e `localStorage` podem ser apagados ou manipulados pelo usuário. O hash local da senha não substitui autenticação segura. Para produção, implemente API/backend, banco de dados com isolamento por tenant (ex.: políticas RLS), autenticação com hash forte no servidor (Argon2id/bcrypt), autorização por função, auditoria, sincronização offline com fila/outbox, resolução de conflitos, backups e validação de assinatura no servidor. A regra dos 7 dias e o contador de clientes também precisam ser calculados no backend para não serem adulteráveis.

## Periféricos de balcão (atualização)
Todos os trechos novos estão marcados com `[NEXUS HW]` no HTML, CSS e JS.

### Leitor de código de barras USB (bipador)
- Barra fixa no topo da Frente de caixa, com foco automático e status (🟢 pronto / 🟡 pausado / 🔴 não encontrado).
- Código encontrado: adiciona 1 unidade, toca um bipe (Web Audio API) e limpa o campo.
- Código desconhecido: aviso discreto com botão **Cadastrar agora**. O produto é salvo com o código e já entra na venda.
- O foco volta sozinho ao leitor depois de cliques no PDV. **F2** devolve o foco de qualquer tela.
- Mesmo sem foco em nenhum campo, uma bipagem rápida é capturada e processada.
- Aceita leitores configurados com sufixo Enter ou Tab.

### Impressora térmica (comprovante não fiscal)
- **Configurações ADM → Configuração de Hardware (PDV)**: papel 58/80 mm, cabeçalho (nome, CNPJ/CPF, telefone/endereço), rodapé, pré-visualização ao vivo e **Imprimir cupom de teste**.
- **Finalizar venda (F4)**: escolha da forma de pagamento, valor recebido e troco, mais a opção "Imprimir comprovante após finalizar" (já marcada). Enter confirma.
- **Reimprimir último recibo** no rodapé do carrinho.
- Na impressão, sai só o recibo: fonte monoespaçada, preto no branco, margem zero. A altura da página é ajustada ao tamanho do cupom.
- Para imprimir sem a janela de diálogo, abra o Chrome do caixa com `--kiosk-printing` e deixe a térmica como impressora padrão.

### Atalhos
F2 = focar leitor · F4 = finalizar venda · Enter = confirmar · Esc = fechar janela

### Banco local
O IndexedDB agora se chama `nexuspdv`. Os dados do nome antigo (`nexus_pdv_db`) são copiados automaticamente no primeiro acesso.
Cada loja tem os novos campos `hardware`, `saleSeq` e, em cada venda, `number`, `payment`, `received` e `change`.
