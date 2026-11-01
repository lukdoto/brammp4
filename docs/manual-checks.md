# Verificação manual do M2

Conferências que os testes automáticos não cobrem. Faça com o app instalado (ou em `npm run dev`), usando seus HDs. Cada passo diz o que precisa acontecer para passar.

## Reprodução e progresso

1. Abra um episódio nunca visto. Passa se o painel de play aparece com áudio, legenda, versão (quando houver mais de uma) e o botão "Assistir".
2. Clique em "Assistir", assista cerca de 1 minuto e feche o mpv com Q. Passa se, de volta ao app, o episódio mostra a barra de progresso parcial e a fileira "Continuar assistindo" do Início tem o card desse título.
3. Abra o mesmo episódio. Passa se o painel mostra "Continuar de mm:ss" e "Começar do início", e o mm:ss bate com o ponto em que você fechou (o vídeo começa até 5 s antes dele).
4. Em um episódio com ponto salvo, clique em "Começar do início". Passa se o vídeo começa em 0:00.
5. Assista um episódio até o fim (pode avançar até os últimos 20 s). Passa se o selo "Assistido" aparece e o card de "Continuar assistindo" passa a mostrar o próximo episódio.
6. Com um vídeo tocando, feche o app pela janela. Passa se no Gerenciador de Tarefas não sobra nenhum `mpv.exe` e, ao reabrir o app, o episódio mostra "Continuar de mm:ss" com o ponto em que você estava.
7. Com um vídeo tocando, encerre o app à força pelo Gerenciador de Tarefas. Limitação conhecida (sem job object do Windows): um `mpv.exe` pode continuar aberto; feche-o à mão. Passa se, ao reabrir o app, o ponto salvo tem no máximo uns 5 s de atraso.
8. Com um vídeo tocando, suspenda o notebook e retome. Passa se o ponto continua salvo (feche o mpv e confira o "Continuar de mm:ss").
9. Com um vídeo tocando no meio do episódio, desconecte o disco. Passa se aparece o aviso "O disco foi desconectado durante a reprodução. O último ponto gravado foi mantido.", o ponto fica salvo e o episódio NÃO aparece como "Assistido".
10. Troque a letra da unidade do disco (Gerenciamento de Disco), revarra se o app pedir e continue um episódio. Passa se o progresso e o "Continuar de mm:ss" sobreviveram à troca.

## Janela do mpv e uosc

11. Na janela real do mpv, confirme a barra de controle moderna do uosc. Passa se os menus de áudio e de legenda abrem pela barra.
12. Aperte F para entrar e sair da tela cheia. Passa se alterna nos dois sentidos (Esc também sai).
13. Olhe a barra do uosc. Passa se NÃO há botões de anterior, lista (playlist) nem próximo.
14. Abra o menu (botão de menu da barra ou clique direito). Passa se aparece o menu curto em português (Pausar ou retomar, Áudio, Legendas, Tela cheia, Avançar e voltar, Velocidade, Volume, Fechar o player) e NÃO há "Open file" nem "Delete file".
15. Arraste um arquivo de vídeo do Explorer para a janela do mpv. Passa se nada muda: o mesmo vídeo continua tocando.
16. Feche com Shift+Q, depois abra o mesmo episódio pelo botão do painel ("Continuar de mm:ss" ou "Assistir"). Passa se Shift+Q fechou como Q e o vídeo começa exatamente onde o painel diz (o mpv não criou ponto de retomada próprio).

## Arquivos reais

17. Reproduza um arquivo x265 real com áudio AC3 ou DTS de um dos seus discos. Passa se vídeo, áudio e legenda ficam sincronizados e sem engasgos.
18. Escolha no painel uma legenda externa com acento no nome. Passa se a legenda aparece no vídeo.
19. Troque áudio e legenda pelo menu do uosc, feche e abra o próximo episódio da mesma série. Passa se ele abre com os mesmos idiomas.

## Instância única

20. Com o app aberto, dê dois cliques no atalho de novo. Passa se nenhuma janela nova abre e a janela existente vem para a frente.

# Verificação manual do M3

Conferências de metadados (TMDB) que os testes automáticos não cobrem. Precisa de uma chave do TMDB (ver README) e de pelo menos uma série com arquivos de episódio no catálogo. Faça os passos na ordem.

## Chave do TMDB

21. Em Configurações, cole um texto qualquer (por exemplo `abc123`) e clique em "Salvar e testar". Passa se aparece uma mensagem clara em português (formato inválido ou chave recusada pelo TMDB), nada fica salvo (a seção continua pedindo a chave) e o catálogo segue como estava, sem capas.
22. Cole a chave válida e clique em "Salvar e testar". Passa se a tela confirma a chave configurada, nunca exibe a chave de volta, e em poucos instantes os cards do Início ganham capas e a página de um título mostra fundo, sinopse e nomes de episódios, sem precisar reiniciar o app nem revarrer.
23. Leia o fim da tela de Configurações. Passa se o aviso "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB." está visível.

## Offline

24. Feche o app, desligue a internet (modo avião ou cabo) e abra de novo. Passa se o catálogo abre normalmente com todas as capas e sinopses já baixadas, sem mensagem de erro nem tela bloqueante, e um episódio ainda toca.
25. Ainda sem internet, adicione ou revarra uma pasta com um título novo. Passa se o título aparece com o nome do arquivo e a capa gerada (iniciais), sem erro; ao reabrir o app com internet, o título ganha capa e sinopse sozinho.

## Correção manual e reclassificação

26. Escolha uma série em que o TMDB acertou o nome, abra a página dela e clique em "Corrigir identificação". Busque um título homônimo ou outro título, escolha-o e confirme. Passa se a página passa a mostrar a capa, a sinopse e os nomes de episódios do novo título, e nenhum nome de episódio do título anterior sobrevive.
27. Assista cerca de 1 minuto de um episódio dessa série, anote o ponto, depois revarra a biblioteca em Configurações. Passa se não aparecem itens duplicados, o "Continuar de mm:ss" é o mesmo e o título corrigido manualmente continua com a identificação escolhida e os nomes de episódios do TMDB.
28. Coloque na biblioteca um vídeo com nome que o app não reconhece (por exemplo `video123.mkv`), revarra e abra "Não identificados". Passa se o arquivo está na lista com o motivo; ao clicar em "Reclassificar", escolher série ou filme, título e (se série) temporada e episódio, o botão mostra "Aguarde…" durante a operação (leva o tempo de uma revarredura da biblioteca) e, ao terminar, o arquivo sai da lista e aparece no catálogo no título e episódio escolhidos.
29. Com a biblioteca desconectada, tente reclassificar um arquivo. Passa se aparece "Conecte a biblioteca para reclassificar este arquivo." e nada muda.

## Remover a chave

30. Em Configurações, clique em "Remover". Passa se a tela volta a pedir a chave, o catálogo continua mostrando as capas e sinopses já baixadas (agora só do cache) e "Corrigir identificação" avisa para configurar a chave em Configurações em vez de falhar.
