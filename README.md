# Swipe Clean

Libere espaço no PC do jeito Tinder: **jogos, aplicativos e pastas pesadas** viram cartas.
Deslize para a **esquerda** para marcar para remover e para a **direita** para manter.
Nada é apagado até você revisar a lista e confirmar.

![ícone](build/icon.png)

## O que ele encontra

| Categoria | De onde vem | O que acontece se remover |
|---|---|---|
| 🎮 **Jogos da Steam** | Bibliotecas da Steam (todas as unidades) | Abre a desinstalação na própria Steam |
| 🎮 **Jogos da Epic** | Manifestos da Epic Games | Abre a Epic para você desinstalar |
| 🎮 **Outros jogos** | Programas instalados de editoras de jogos ou em pastas de jogos | Desinstalador oficial |
| 🧩 **Aplicativos** | Registro do Windows e Microsoft Store | Desinstalador oficial / `Remove-AppxPackage` |
| 📁 **Temporários e caches** | `%TEMP%`, npm, pip, Gradle, NuGet, Chrome, Edge, Discord, Spotify, VS Code, Cursor, shaders… | Apaga o conteúdo (é recriado) |
| 📁 **Downloads e pastas pessoais** | Itens grandes em Downloads, Área de Trabalho, Vídeos, Documentos | Vai para a **Lixeira** |
| 📁 **Dados de aplicativos** | Pastas grandes em AppData | Vai para a **Lixeira** |

**Capas dos jogos:** primeiro do cache da Steam no seu PC; se não houver, da loja da Steam ou da Epic (dá para desligar em ⚙ Configurações).

**Último uso:** jogos da Steam mostram quando foram jogados pela última vez. Para os demais, o Windows exige permissão de administrador (botão *Reiniciar como administrador* no app).

## Proteções

- Deslizar só marca: tudo passa por uma revisão com caixas de seleção e uma confirmação.
- Atualizações do Windows, componentes de sistema e runtimes de jogos da Steam nem aparecem.
- Drivers, runtimes (Visual C++, .NET, DirectX, WebView2) aparecem com aviso amarelo.
- Arquivos pessoais vão para a Lixeira, não são apagados de vez.
- Programas e jogos são removidos pelo desinstalador oficial deles; o app só confirma que sumiram.
- O que você mantém não aparece de novo nas próximas análises.

Veja também a [política de privacidade](PRIVACIDADE.md).

## Rodar em modo de desenvolvimento

1. Instale o [Node.js LTS](https://nodejs.org).
2. Dê dois cliques em `iniciar.bat` (ou `npm install` e `npm start`).
3. `diagnostico.bat` abre o app e já inicia a análise, registrando tudo no log.

Fora do Windows (ou abrindo `renderer/index.html` num navegador) o app entra em **modo demonstração**, com dados fictícios.

## Gerar o instalador

Dê dois cliques em **`build.bat`**. Em alguns minutos a pasta `dist\` terá:

- `SwipeClean-Setup-1.2.0.exe`: instalador com atalhos no menu Iniciar e na Área de Trabalho.
- `SwipeClean-Portatil-1.2.0.exe`: versão que roda sem instalar.

> O executável não é assinado digitalmente, então o Windows SmartScreen mostra "O Windows protegeu o computador" na primeira vez. Clique em **Mais informações → Executar assim mesmo**. Para publicar sem esse aviso, é preciso um certificado de assinatura de código.

## Doação por Pix

O app mostra um convite discreto para apoiar com Pix **depois de uma limpeza bem-sucedida** e em ⚙ Configurações.
O QR Code e o "Pix Copia e Cola" são gerados no próprio app, sem internet, seguindo o padrão BR Code do Banco Central.

Para ativar, preencha `doacao.json` e gere o instalador de novo:

```json
{
  "pixKey": "sua-chave-aleatoria",
  "nome": "Seu Nome",
  "cidade": "Sua Cidade",
  "mensagem": "Swipe Clean",
  "valores": [5, 10, 20]
}
```

- Com `pixKey` vazio, a doação não aparece.
- Prefira uma **chave aleatória**: a chave fica visível para quem usa o app (CPF, telefone ou e-mail ficariam expostos).
- `nome` e `cidade` aparecem no app do banco de quem doa (sem acentos, até 25 e 15 caracteres).
- `valores` são os botões de valor sugerido; sempre existe também a opção "Outro valor".

## Atalhos

`←` remover · `→` manter · `Ctrl+Z` desfazer · `1` `2` `3` trocam de categoria · `Esc` fecha janelas

## Diagnóstico

O log da última execução fica em `%APPDATA%\Swipe Clean\log.txt` (⚙ Configurações → *Abrir pasta*).

## Estrutura

```
main.js        processo principal: janela, capas, configurações, remoções
scanner.js     análise pesada numa thread separada (a janela não trava)
games.js       detecção de jogos da Steam, Epic e outros
pix.js         QR Code e Pix Copia e Cola da doação (vendor/qrcode: gerador de QR, MIT)
preload.js     ponte segura entre a tela e o processo principal
scripts/*.ps1  leitura do registro e dos apps da Store
renderer/      interface (resumo, cartas, revisão, progresso, configurações)
build/         ícone do app e recursos do instalador
```

## Licença

MIT. Veja [LICENSE.txt](LICENSE.txt).
