# Política de privacidade — Swipe Clean

O Swipe Clean funciona inteiramente no seu computador. Não há conta, anúncios, telemetria nem servidor próprio.

## O que o app lê

- A lista de programas instalados (registro do Windows) e de apps da Microsoft Store.
- As bibliotecas da Steam e da Epic Games instaladas no PC (nome, tamanho, pasta e data do último jogo).
- O tamanho de pastas como Downloads, Vídeos, Documentos, Área de Trabalho, caches e AppData.
- Com permissão de administrador, a pasta `C:\Windows\Prefetch`, só para saber quando cada programa foi aberto pela última vez.

Nada disso é enviado para lugar nenhum.

## O que sai do seu computador

Apenas quando a opção **Buscar capas de jogos na internet** está ligada (ela vem ligada e pode ser desligada em Configurações):

- O **nome de um jogo**, ou o **número dele na Steam/Epic**, é usado para baixar a imagem de capa da loja da Steam (`store.steampowered.com`, `steamstatic.com`) ou da Epic Games (`graphql.epicgames.com`).
- Essas lojas recebem a requisição como qualquer visita a um site (incluindo o seu endereço IP), sob as políticas de privacidade delas.

As capas baixadas ficam guardadas no seu PC para não precisarem ser buscadas de novo.

## Doações

O botão de doação só mostra um QR Code e um código Pix gerados no próprio app. O pagamento é feito no aplicativo do seu banco; o Swipe Clean não recebe, vê nem guarda nenhum dado de pagamento.

## O que fica salvo no seu PC

Em `%APPDATA%\Swipe Clean\`:

| Arquivo | Conteúdo |
|---|---|
| `config.json` | Suas configurações |
| `decisoes.json` | O que você escolheu manter, para não mostrar de novo |
| `covers\` | Capas de jogos já baixadas |
| `log.txt` | Diagnóstico da última execução (recriado a cada abertura) |

Para apagar tudo, desinstale o app e remova essa pasta.
