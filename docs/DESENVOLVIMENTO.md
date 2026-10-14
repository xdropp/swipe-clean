# Guia de desenvolvimento

## Rodar o app

Requisitos: Windows 10/11 e [Node.js LTS](https://nodejs.org).

```bash
npm install
npm start
```

Ou dê dois cliques em `iniciar.bat`. O `diagnostico.bat` abre o app e já inicia a análise, registrando tudo em `%APPDATA%\Swipe Clean\log.txt`.

Fora do Windows (ou abrindo `renderer/index.html` num navegador) o app entra em **modo demonstração**, com jogos e dados fictícios. É útil para mexer na interface.

## Estrutura

```
main.js         processo principal: janela, capas, configurações, remoções, doação
scanner.js      análise e limpeza pesadas numa thread separada (a janela não trava)
games.js        detecção de jogos da Steam, Epic e outros
pix.js          QR Code e Pix Copia e Cola (padrão BR Code do Banco Central)
preload.js      ponte segura entre a tela e o processo principal
scripts/*.ps1   leitura do registro do Windows e dos apps da Store
renderer/       interface (resumo, cartas, revisão, progresso, configurações)
vendor/qrcode/  gerador de QR Code (MIT, Kazuhiko Arase)
build/          ícone e recursos do instalador
docs/           imagens do README e esta documentação
```

Princípios que o código segue:

- **A tela nunca recebe comandos de desinstalação.** Ela só envia IDs; o processo principal aceita apenas IDs vindos da última análise.
- **Trabalho pesado fica fora do processo principal.** No Windows, o processo principal do Electron desenha a janela, e travá-lo congela o app.
- **Nada é apagado sem revisão.** Arquivos pessoais vão para a Lixeira; programas usam o desinstalador oficial.

## Gerar o instalador no seu PC

```bash
npm run dist
```

Ou dê dois cliques em `build.bat`. O instalador e a versão portátil saem em `dist\`.

## Publicar uma versão

As versões são compiladas e publicadas automaticamente pelo GitHub Actions (`.github/workflows/release.yml`):

1. Atualize `"version"` no `package.json` (ex.: `1.3.0`).
2. Adicione uma seção `## [1.3.0] - AAAA-MM-DD` no `CHANGELOG.md`. Ela vira o texto da página da versão.
3. Faça commit e envie para a branch `main`.

Se ainda não existir um Release com essa versão, o GitHub compila no Windows, cria a tag `v1.3.0` e publica os dois `.exe` em **Releases** em alguns minutos. Envios que não mudam a versão não publicam nada, então dá para enviar correções de documentação à vontade.

Para tentar de novo uma publicação que falhou, use **Actions → Publicar versão → Run workflow**.

## Doação por Pix

O botão de doação lê o arquivo `doacao.json`, que **não fica no repositório** (está no `.gitignore`). Cada pessoa que distribui o app usa a própria chave.

- **No build automático:** configure os segredos `PIX_KEY`, `PIX_NOME` e `PIX_CIDADE` em **Settings → Secrets and variables → Actions**. Sem `PIX_KEY`, a versão sai sem o botão.
- **No build local:** copie `doacao.exemplo.json` para `doacao.json` e preencha.

Prefira uma **chave aleatória**: ela fica visível para quem usa o app. `nome` e `cidade` aparecem para quem doa (sem acentos, até 25 e 15 caracteres).
