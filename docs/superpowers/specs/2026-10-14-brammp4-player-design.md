# brammp4: reprodutor estilo streaming para HDs externos

Data: 2026-10-14
Status: rascunho para revisão

## 1. Objetivo e critérios de sucesso

Um app desktop (Windows) que transforma os filmes e séries guardados em dois HDs externos
num catálogo estilo streaming, funciona sem internet e lembra exatamente onde cada vídeo parou.

Critérios de sucesso da v1:

1. Abrir o app e ver um catálogo com capas, com a fileira "Continuar assistindo" no topo.
2. Na tela de uma série, cada episódio mostra a etiqueta `S01E03` e uma barra de progresso
   (parte assistida colorida, restante em cinza).
3. Antes do play, escolher legenda, áudio e versão (quando houver mais de uma).
4. O vídeo abre em tela cheia e toca qualquer formato comum (MKV, MP4, AVI, x265, AC3/DTS, legendas embutidas e `.srt`).
5. Ao fechar o player, fechar o app ou desligar o notebook de forma abrupta, a perda máxima de progresso é de 5 segundos.
6. Conectar e desconectar qualquer um dos dois HDs a qualquer momento sem perder progresso nem duplicar títulos.
7. O progresso tem backup na conta Google do usuário e pode ser restaurado num notebook novo.
8. Assistir não depende de internet. A internet só é usada para baixar metadados e fazer o backup.
9. Instalação num notebook novo a partir do GitHub com um único instalador que já contém tudo
   (mpv, uosc, ffprobe, ffmpeg); nenhum pré-requisito instalado à mão. Um agente (Claude Code)
   consegue instalar seguindo o README sem tomar decisões.
10. O usuário aponta, uma única vez, a pasta do catálogo dentro do disco removível; o app lembra esse
    endereço e, a cada vez que o disco é reconectado, verifica se a pasta está acessível e atualiza o catálogo.
11. Legendas guardadas nas pastas (ao lado do vídeo ou em subpastas) aparecem como opção no painel de play.

Fora do escopo da v1, com base preparada para depois: sincronização entre vários aparelhos,
perfis por pessoa, transcodificação, streaming para outros dispositivos.

## 2. Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Plataforma | Electron + TypeScript | O usuário domina JS/TS; o código inteiro fica numa linguagem só |
| Interface | React + Vite (electron-vite) | Ecossistema conhecido, recarregamento rápido |
| Reprodução | mpv como processo separado, controlado por JSON IPC (named pipe) | Toca qualquer formato; o app não precisa decodificar vídeo |
| Interface do player | Script uosc no mpv | Barra moderna, menus de legenda e áudio e miniaturas sem escrever um player |
| Leitura de faixas | ffprobe (saída JSON) | Lista faixas, idiomas, duração e resolução sem abrir o vídeo |
| Banco local | SQLite (better-sqlite3, modo WAL) | Arquivo único, sem servidor, gravação segura contra desligamento abrupto |
| Metadados | TMDB com cache em disco | Capas e sinopses grátis para uso pessoal; offline usa o cache |
| Backup | Google Drive `appDataFolder` (escopo `drive.appdata`) | Sem servidor próprio; arquivo invisível ao usuário e isolado de outros apps |
| Distribuição | electron-builder (instalador NSIS) publicado em GitHub Releases por GitHub Actions | Um `.exe` com tudo dentro; o notebook não precisa de Node, git nem ferramentas de build |

Alternativas descartadas: player HTML5 (não toca x265/DTS de forma confiável), Tauri (exige Rust),
libmpv embutido na janela (complexo e com plugin pouco testado; pode ser uma evolução futura,
já que o restante do app não depende de onde o vídeo é desenhado).

## 3. Componentes

Todos rodam no processo principal do Electron, exceto a Interface. A Interface conversa com o principal
apenas por uma API explícita exposta via `preload` + `contextBridge`.

| Componente | Responsabilidade | Depende de |
|---|---|---|
| `libraries` | Cadastra a pasta do catálogo escolhida pelo usuário; a cada 3 s verifica se cada biblioteca está acessível (conectada/desconectada) | sistema de arquivos |
| `scanner` | Percorre uma biblioteca, reconhece episódios, filmes e legendas, roda ffprobe nos vídeos novos ou alterados | `libraries`, `db`, `parser` |
| `parser` | Função pura: caminho do arquivo para `{tipo, nome, ano, temporada, episódio, versão}` | nada |
| `metadata` | Associa títulos ao TMDB, baixa capas para o cache, preenche nomes e sinopses de episódios | `db`, rede |
| `db` | Esquema SQLite, migrações e consultas | better-sqlite3 |
| `player` | Inicia o mpv com as faixas e a posição escolhidas, observa `time-pos`, `pause` e fim de arquivo | mpv |
| `progress` | Regras de salvar, "assistido", "próximo episódio" e "Continuar assistindo" | `db` |
| `backup` | Login Google, exportar, enviar, baixar e mesclar o progresso | `db`, rede |
| `ui` | Telas: Início, Título, Painel de play, Configurações, Não identificados | API do preload |

Regra de isolamento: `parser`, `progress` (regras) e a mescla do `backup` são funções puras e não
importam nada do Electron. Isso permite testá-las isoladamente.

## 4. Identidade: episódio separado de arquivo

Princípio: o progresso pertence ao episódio, nunca ao arquivo nem ao HD.

- Cada item reproduzível (episódio ou filme) tem uma chave estável:
  - série identificada no TMDB: `tmdb:tv:<id>:S01E03`
  - filme identificado no TMDB: `tmdb:movie:<id>`
  - ainda sem TMDB: `local:<nome-normalizado>:S01E03` ou `local:<nome-normalizado>-<ano>`
  - quando um item `local:` for associado ao TMDB, a chave é migrada no banco e o progresso vai junto.
- Um item pode ter zero, um ou vários arquivos, em qualquer HD.
- Cada biblioteca (a pasta do catálogo escolhida pelo usuário dentro de um disco) é identificada por um ID único
  gravado no arquivo `.brammp4.json` dentro dessa pasta
  (`{ "id": "<uuid>", "label": "HD Séries", "createdAt": "..." }`).
- O endereço completo escolhido (ex.: `E:\Videos\Series`) é guardado e é o primeiro lugar verificado,
  mas não é a identidade: se a letra mudar, o marcador é procurado no mesmo caminho em outras letras.
- O caminho de cada arquivo é guardado relativo à pasta da biblioteca.

Consequências: trocar a letra da unidade, mover uma série entre HDs ou ter cópias nos dois HDs não afeta o progresso.

## 5. Modelo de dados (SQLite)

```
libraries   (id TEXT PK, label, root_path TEXT, status 'online'|'offline', last_seen_at, last_scan_at)
titles      (id INTEGER PK, kind 'movie'|'series', tmdb_id, name, year, overview,
             poster_cache, backdrop_cache, matched_at)
items       (key TEXT PK, title_id FK, season, episode, name, overview, runtime_s)
files       (id INTEGER PK, item_key FK, library_id FK, rel_path, size, mtime,
             duration_s, width, height, video_codec, probed_at, missing INTEGER)
tracks      (file_id FK, stream_index, type 'audio'|'sub', lang, title, codec,
             is_default, external_path)
progress    (item_key PK, position_s, duration_s, watched INTEGER, updated_at, device_id)
prefs       (title_id PK, audio_lang, sub_lang)   -- última escolha por série
unmatched   (file_id PK, reason)
settings    (key PK, value)
```

`progress.item_key` não tem chave estrangeira obrigatória para `items`: o progresso restaurado de um backup
pode chegar antes de o HD correspondente ser varrido.

## 6. Reconhecimento de arquivos (parser)

Padrões aceitos, em ordem de prioridade:

1. `S01E03`, `s1e3`, `S01E03E04` (episódio duplo vira dois itens apontando para o mesmo arquivo)
2. `1x03`
3. Estrutura de pastas `Série/Temporada 1/03 - Nome.mkv` ou `Season 01/...`
4. Filme: `Nome (2019)` ou `Nome.2019.1080p...`

Versão (para o seletor): resolução e codec tirados do ffprobe; o nome do arquivo só serve como dica.
Arquivo que não se encaixa em nenhum padrão vai para "Não identificados", onde o usuário associa manualmente uma vez.
Extensões de vídeo consideradas: `.mkv .mp4 .avi .m4v .mov .wmv .ts .webm`.

### Legendas externas

Extensões: `.srt .ass .ssa .vtt .sub/.idx`. Uma legenda é associada a um vídeo quando, em ordem:

1. tem o mesmo nome-base do vídeo, com ou sem sufixo de idioma (`Nome.S01E03.srt`, `Nome.S01E03.pt-BR.srt`, `Nome.S01E03.por.forced.srt`);
2. está numa subpasta de legendas (`Subs/`, `Legendas/`, `Subtitles/`) ao lado do vídeo, com o mesmo nome-base
   ou dentro de uma pasta com o nome do vídeo (`Subs/Nome.S01E03/2_Portuguese.srt`);
3. tem o mesmo código de episódio (`S01E03`) na mesma pasta ou numa subpasta de legendas.

Idioma: tirado do sufixo ou do nome do arquivo (`pt-BR`, `por`, `pob`, `Portuguese`, `en`, `eng`, `English` etc.);
se não houver, aparece como "Desconhecido (nome do arquivo)". Marcadores `forced` e `sdh` viram etiquetas.
Legendas encontradas são gravadas em `tracks` com `external_path` e aparecem no painel de play junto com as embutidas,
indicadas como "(arquivo)". Legenda que não casa com nenhum vídeo fica registrada e pode ser associada manualmente.

## 7. Bibliotecas: escolher a pasta, conectar e desconectar

Cadastro (feito uma vez por pasta):

1. Primeira abertura do app, ou Configurações > Bibliotecas > "Adicionar pasta".
2. Abre o seletor de pastas nativo do Windows; o usuário escolhe a pasta do catálogo dentro do disco removível
   (ex.: `E:\Videos\Series`). Pode haver várias bibliotecas, por exemplo uma por HD ou uma para séries e outra para filmes.
3. O usuário dá um apelido ("HD Séries"). O app grava `.brammp4.json` dentro da pasta e guarda o endereço.
4. Varredura completa inicial com barra de progresso ("312 de 540 arquivos"); ao terminar, mostra um resumo:
   séries, temporadas, episódios, filmes, legendas encontradas e quantos ficaram em "Não identificados".

Verificação de conexão (a cada 3 s, e ao abrir o app):

1. Testa se o endereço guardado existe e contém o `.brammp4.json` com o mesmo ID. Se sim: biblioteca `online`.
2. Se não: procura o mesmo caminho sem a letra (`\Videos\Series`) nas outras letras `D:` a `Z:`. Achou com o mesmo ID:
   atualiza o endereço guardado e fica `online`. Isso cobre o caso de o Windows dar outra letra ao disco.
3. Se não encontrou: `offline`.

Na transição `offline` para `online`: varredura incremental (só lê com ffprobe vídeos novos ou com tamanho/data alterados;
legendas são sempre reavaliadas por serem baratas). Reconectar leva segundos.

Comportamento no catálogo:

- Biblioteca offline: itens continuam visíveis, com progresso, acinzentados com "conecte <apelido>".
- Mesmo item em duas bibliotecas: as duas cópias aparecem no seletor de versão. Padrão: maior resolução disponível.
- Arquivo que sumiu de uma biblioteca online: marcado `missing`; o item continua existindo enquanto houver progresso ou outra cópia.
- Pasta encontrada mas sem o marcador (ex.: o usuário apagou o arquivo oculto): o app pergunta se é a mesma biblioteca antes de recriar.

## 8. Reprodução e progresso

Início:

```
mpv --input-ipc-server=\\.\pipe\brammp4-<aleatório> --fullscreen --force-window=yes
    --start=<posição> --aid=<n> --sid=<n|no> [--sub-file=<externa>]
    --config-dir=<app>/mpv-config   (uosc e opções do app, separados do mpv do usuário)
    "<caminho do arquivo>"
```

A legenda externa escolhida é selecionada depois do `file-loaded`, procurando o arquivo na `track-list` do mpv (o id depende da ordem em que o mpv registra as legendas).

Durante a reprodução o app observa `time-pos`, `duration` e `pause` pelo IPC.

Quando salvar:

- a cada 5 s durante a reprodução;
- ao pausar;
- ao fechar o mpv (evento `end-file` ou saída do processo, usando a última posição conhecida);
- como reforço de melhor esforço: ao suspender o notebook (`powerMonitor` `suspend`), no fim de sessão do Windows (`session-end` da janela, quando a tipagem do Electron tiver o evento) e ao fechar o app (`before-quit`, que grava e encerra o mpv). O evento `shutdown` do `powerMonitor` só existe em Linux e macOS.

Com o SQLite em modo WAL, uma gravação já confirmada sobrevive a um desligamento abrupto. Perda máxima: 5 s.

Regras:

- Assistido: posição maior ou igual a 90% da duração, ou faltando menos de 2 min. Marca `watched = 1`. A regra dos 2 min só vale depois da metade do vídeo (um clipe de 100 s não nasce assistido).
- Retomar: se a posição salva for menor que 30 s, começa do zero; senão, começa 5 s antes do ponto salvo.
- Próximo episódio: o menor `(temporada, episódio)` maior que o atual com arquivo disponível.
- "Continuar assistindo": um card por título, com o item atualizado mais recentemente. Se ele estiver assistido,
  o card mostra o próximo episódio; se não houver próximo, o título sai da fileira.
- Escolha de faixas: o padrão vem de `prefs` da série (último idioma de áudio e legenda escolhidos); se não houver,
  usa a faixa marcada como padrão no arquivo. Toda escolha nova é salva em `prefs`.
- Barra de progresso: `position_s / duration_s`, parte assistida colorida e restante em cinza;
  itens assistidos mostram a barra cheia e um selo "assistido".

## 9. Metadados (TMDB)

- Chave da API informada pelo usuário em Configurações e guardada com `safeStorage`.
- Ao encontrar um título novo com internet disponível: busca por nome (e ano, se houver), escolhe o primeiro resultado
  e permite corrigir manualmente na tela do título.
- Capas e fundos são baixados para a pasta de dados do app; o catálogo só lê do cache local.
- Sem internet: o título aparece com o nome do arquivo e uma capa gerada (frame do vídeo via ffmpeg ou placeholder);
  a busca é refeita na próxima vez que houver conexão.
- Atribuição: tela "Sobre" com o logo aprovado do TMDB (menor que o logo do app) e o aviso
  "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB."

## 10. Backup no Google Drive

- Login: fluxo OAuth para app desktop com PKCE e redirecionamento loopback (`http://127.0.0.1:<porta aleatória>`).
  Escopos: `openid email https://www.googleapis.com/auth/drive.appdata`.
- O refresh token é guardado com `safeStorage` (criptografia do Windows atrelada ao usuário).
- Arquivo `progress.json` na `appDataFolder`:

```json
{
  "schema": 1,
  "exportedAt": "2026-10-14T12:00:00Z",
  "deviceId": "<uuid do notebook>",
  "progress": { "tmdb:tv:1399:S01E03": { "position": 1834, "duration": 3420, "watched": false, "updatedAt": "..." } },
  "prefs": { "tmdb:tv:1399": { "audio": "jpn", "sub": "por" } }
}
```

- Mescla: por chave, vence o `updatedAt` mais recente. A mesma regra serve depois para sincronizar vários aparelhos.
- Quando: baixar e mesclar ao abrir o app; enviar 30 s depois de terminar uma sessão de reprodução; botão "Fazer backup agora".
- Sem internet: marca "backup pendente" e tenta de novo quando a conexão voltar. Nunca bloqueia a reprodução.
- Base para o futuro: `deviceId` e `updatedAt` por registro permitem sincronização; perfis entram como o e-mail Google na chave do arquivo.

## 11. Telas

1. **Início:** "Continuar assistindo", "Séries", "Filmes", "Adicionados recentemente". Banner quando um HD está desconectado.
2. **Título:** fundo, sinopse, seletor de temporada, lista de episódios com `S01E03`, nome, duração e barra de progresso.
3. **Painel de play:** seletores de áudio, legenda (inclui "Desligada") e versão (só quando houver mais de uma);
   botões "Continuar de 30:34" e "Começar do início".
4. **Configurações:** Bibliotecas (adicionar pasta, apelido, endereço, status online/offline, revarrer), chave TMDB,
   conta Google e backup.
5. **Não identificados:** associar arquivo a título, temporada e episódio.

## 12. Tratamento de erros

| Situação | Comportamento |
|---|---|
| HD desconectado durante o vídeo | mpv encerra; o app grava a última posição e avisa "HD desconectado" |
| Arquivo não encontrado ao dar play | Mostra o aviso e orienta revarrer a biblioteca; a revarredura automática fica para o M5 |
| mpv ou ffprobe ausente na instalação | Não deveria ocorrer (vão dentro do instalador); se ocorrer, tela de erro pedindo reinstalação |
| ffprobe falha num arquivo | Arquivo continua reproduzível; faixas aparecem como "desconhecidas" |
| TMDB fora do ar ou sem internet | Usa o cache; tenta de novo depois, sem mensagem bloqueante |
| Token Google expirado ou revogado | Banner "Reconectar conta Google"; o progresso local continua intacto |
| Banco corrompido | Na abertura: verificação de integridade; se falhar, oferece restaurar do backup do Drive |

## 13. Testes

- Unitários (Vitest), sem Electron: `parser` (tabela de nomes de arquivo reais), regras de `progress`,
  mescla do `backup`, cálculo de "próximo episódio".
- Integração: `db` com SQLite em arquivo temporário; `scanner` contra uma pasta de fixtures que simula dois HDs.
- `player`: teste com um mpv falso que fala o mesmo protocolo IPC, mais teste manual com o mpv real.
- Manual de ponta a ponta antes de cada marco: desconectar o HD durante o vídeo, fechar o app à força,
  trocar a letra da unidade.

## 14. Instalação e distribuição

Princípio: quem instala não monta nada. Todas as dependências vão dentro do instalador.

Conteúdo do instalador (`brammp4-Setup-<versão>.exe`, NSIS, instalação por usuário, sem pedir administrador):

- o app Electron (Node e Chromium já embutidos);
- `resources/mpv/mpv.exe` e DLLs (build de CI oficial do mpv: código-fonte em github.com/mpv-player/mpv, commit 41f6a64, build de 2025-12-21 distribuído como asset da release v0.41.0; Windows x64);
- `resources/bin/ffprobe.exe` (build estático);
- `resources/mpv-config/` com o uosc e a configuração do app (`mpv.conf`, `input.conf`, `script-opts/uosc.conf`, versionados em `app-config/mpv/` e copiados por cima do uosc baixado).

Os binários não ficam no git. O script `scripts/fetch-binaries.mjs` baixa versões fixadas (URL + SHA-256 conferido)
para `vendor/` antes do empacotamento; o mesmo script é usado em desenvolvimento.

Publicação: um workflow do GitHub Actions (`windows-latest`) roda testes, baixa os binários, gera o instalador
e o anexa a uma GitHub Release quando uma tag `v*` é criada. Cada marco gera uma release instalável.

Instalação no notebook (escrita no README para pessoa ou agente seguir sem decisões):

```
gh auth login                      # o repositório é privado
gh release download --repo lukdoto/brammp4 --pattern "brammp4-Setup-*.exe" --dir $env:TEMP
& "$env:TEMP\brammp4-Setup-<versão>.exe" /S   # instalação silenciosa
```

Depois da instalação: atalho no Menu Iniciar e na área de trabalho. A primeira abertura leva ao cadastro da pasta do catálogo (seção 7).
Atualização: repetir os mesmos comandos com a release nova; dados do usuário (banco, cache, tokens) ficam em
`%APPDATA%\brammp4` e não são apagados.

Segredos: a chave do TMDB e a conta Google são informadas na primeira execução, dentro do app; nada sensível
vai para o repositório ou para o instalador, com exceção do client ID OAuth do Google para app desktop, que o
próprio Google não trata como segredo.

## 15. Marcos

Cada marco termina com uma release instalável pelo processo da seção 14.

1. **M1, Catálogo local instalável:** estrutura do projeto, pipeline de release com binários embutidos, `db`, `parser`
   (vídeos e legendas), `libraries` com seletor de pasta e verificação de conexão, `scanner`, telas Início e Título sem capas.
2. **M2, Reprodução e progresso:** `player` com mpv + uosc, painel de play, gravação de progresso e barras.
3. **M3, Metadados:** TMDB, cache de capas, tela Não identificados.
4. **M4, Backup:** login Google, exportação, mescla e restauração.
5. **M5, Acabamento:** instalador, ícone, atalhos de teclado, tela Sobre.

## 16. Pontos a confirmar antes ou durante a implementação

- Se o escopo `drive.appdata` é classificado pelo Google como sensível, e o efeito disso no aviso de "app não verificado"
  e na validade do refresh token enquanto o projeto do Google Cloud estiver em modo "Teste" (há relatos de expiração em 7 dias).
- Resolvido no M2: mpv = build de CI oficial do projeto mpv, código-fonte em github.com/mpv-player/mpv (commit 41f6a64, build de 2025-12-21 distribuído como asset da release v0.41.0; `x86_64-w64-mingw32`, SHA-256 fixado em `scripts/binaries.json`); uosc 5.13.0. Os textos de licença (mpv GPL e uosc) vão dentro do instalador.
- Se o repositório continua privado (exige `gh auth login` no notebook) ou vira público (download direto, sem login).
- Termos atuais da API do TMDB para uso pessoal não comercial.
