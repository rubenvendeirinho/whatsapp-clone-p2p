# WhatsUp-p2p V9

Chat em tempo real **sem base de dados no servidor** e **sem serviços de autenticação externos**:
mensagens de texto, **mensagens de voz**, **ficheiros**, **chamadas de voz e vídeo**, tudo ponto a ponto (WebRTC) quando possível.

## Como funciona

```
 Browser A ──┐                                   ┌── Browser B
   IndexedDB │      server/ (Node + socket.io)   │ IndexedDB
   chave ECDSA│  • autentica (desafio/assinatura)│ chave ECDSA
             ├──►  • relé de texto e sinais WebRTC ◄──┤
             │      • presença        (só memória)│
             └────────── WebRTC (DTLS) ───────────┘
                 voz · ficheiros · áudio/vídeo das chamadas
```

* **Identidade local.** No primeiro uso o browser gera um par ECDSA P‑256 (chave privada guardada em IndexedDB; só é exportada, cifrada, para a cópia de segurança da conta).
  O **ID** (20 caracteres, 100 bits) é um hash da chave pública. Ao ligar, o servidor envia um desafio aleatório e o cliente
  assina-o; o servidor verifica a assinatura e deriva o ID. Ninguém consegue usar o ID de outro sem a sua chave privada,
  não há passwords nem contas, e o servidor não guarda nada.
* **Texto** passa pelo servidor (em memória, nunca em disco). **Voz, ficheiros e chamadas** vão por WebRTC, cifrados (DTLS/SRTP), sem passar pelo servidor.
* **Entrega offline sem base de dados:** o remetente guarda o que ficou por entregar (outbox em IndexedDB) e reenvia assim que o
  contacto fica online. Ambos têm de estar online *em algum momento*, e o remetente não pode limpar os dados do browser até lá.
* Voz de **contactos guardados** é aceite automaticamente; voz de desconhecidos e **todos os ficheiros** pedem confirmação.
  Os ficheiros são transferidos em blocos de 16 KiB com controlo de fluxo; com Chrome/Edge desktop são escritos diretamente em disco (qualquer tamanho),
  nos restantes browsers ficam em memória (limite de 300 MB).

## Executar

Ambiente verificado: Node.js 22.23.4. Na raiz do projeto:

```bash
npm install
npm run server:install
npm run dev:all
```

O comando inicia o servidor Node e só abre o Vite depois de verificar `/api/health`.
O arranque usa Node diretamente, sem `npx`/shell, incluindo no Windows. A porta do
Vite é fixa: **5173**. Se estiver ocupada, pare a instância anterior em vez de deixar
o túnel ligado à aplicação errada. `PORT` altera a porta interna da sinalização e é
respeitada pelo proxy; o Vite continua em 5173.

Noutro terminal, para testar entre dispositivos:

```bash
ngrok http 5173
```

Todos os utilizadores devem abrir **o mesmo URL HTTPS do ngrok**, criar as suas
próprias identidades em navegadores/perfis diferentes e adicionar os IDs uns dos
outros como contactos. O microfone, a câmara e WebCrypto requerem HTTPS, exceto em
localhost. Não exponha a porta 5000 separadamente: `/socket.io` passa pela mesma
origem da aplicação. Se o ngrok apresentar uma página de aviso, confirme-a antes
de usar a aplicação.

**Não configure `VITE_SOCKET_URL=http://localhost:5000` para acesso remoto.** Remova
essa variável de `.env`, `.env.local` ou do ambiente e reinicie/recompile: num
telemóvel, `localhost` aponta para o próprio telemóvel. A omissão é a mesma origem.
Por segurança, o Vite só aceita pedidos de hosts autorizados. Ao usar o ngrok, adicione o
seu domínio ao `.env` (ou `.env.local`), sem `https://`, e reinicie:
`TUNNEL_HOSTS=o-seu-host.ngrok-free.app` (vários hosts separados por vírgula).

### Diagnóstico de ligação

Abra `https://SEU-HOST/api/health` no mesmo URL público. O resultado esperado é JSON
com `ok: true` e `service: "whatsapp-p2p-signaling"`. HTML ou erro indicam um túnel
na porta errada, um proxy antigo ou sinalização parada. A interface agora mostra
diagnósticos de transporte/autenticação e um botão para tentar novamente.
O chat aceita HTTP polling e faz upgrade para WebSocket quando disponível.

É possível usar `npm run server` e `npm run dev` separadamente. Para preview,
execute `npm run build`, mantenha `npm run server` ativo e use `npm run preview`;
o túnel deve então apontar para **4173**. O preview também inclui o proxy.

Não limpe os dados do site para tentar resolver a ligação: perderia a identidade
local, os contactos e o histórico. A origem (domínio) determina os dados guardados.

### Produção

```bash
npm run build
TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node server/index.js   # serve dist/ + sinalização, com CSP
```

| Variável (servidor) | Função |
|---|---|
| `PORT` | porta (omissão 5000) |
| `TLS_KEY`, `TLS_CERT` | ativa HTTPS direto (ou ponha um proxy TLS à frente) |
| `ALLOWED_ORIGINS` | origens CORS quando a app é servida de outro domínio |
| `STUN_URLS` | STUN (omissão: Google) |
| `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` | TURN com credenciais temporárias (coturn `use-auth-secret`) |
| `ICE_SERVERS` | JSON completo, se preferir |

**Instale um TURN (coturn)** para produção: sem ele, chamadas e transferências falham em redes com NAT restritivo.
No cliente, `VITE_SOCKET_URL` só é necessário se o servidor estiver noutro domínio (ver `.env.example`).

## Testes

```bash
npm run lint
npm test          # compila e executa 20 testes, incluindo subtestes de ligação real
npx playwright install chromium  # uma vez; em Linux pode ser necessário install --with-deps chromium
npm run test:e2e  # 19 verificações com dois utilizadores em Chromium (Hub simulado)
npm run test:signaling # Chromium + Socket.IO reais; proxy sem WebSocket e reinício do servidor
npm run build
npm audit
npm --prefix server audit
```

O e2e cobre: login por assinatura, contactos/presença, texto, outbox offline, voz (gravar → enviar → reproduzir),
ficheiros nos dois sentidos em simultâneo (SHA‑256), escrita em disco, recusa, chamadas voz→vídeo, mute, recusar e repetir chamada.

O teste `test:e2e` usa WebRTC real e sinalização simulada pelo Hub; microfone/câmara
e escrita direta em disco são simulados. O teste `test:signaling` usa a aplicação
React e o servidor Socket.IO reais com dois contextos Chromium: autenticação,
presença, mensagens nos dois sentidos e reconexão após reiniciar o servidor.
Um proxy local simula o Host do ngrok e bloqueia os upgrades WebSocket para testar
o fallback por polling. A suíte `npm test` também cobre dev, preview, health e
recuperação da ligação. O túnel ngrok real do utilizador, redes externas, TURN
real, dispositivos físicos e outros navegadores não foram testados nesta revisão.

## Revisão V5: ligação ao servidor

* HTTP polling com upgrade para WebSocket habilitado no cliente e no servidor.
* Proxy de sinalização tanto no desenvolvimento como no preview.
* Porta interna configurável e porta pública fixa; arranque verificado por health,
  sem shell/npx e sem continuar silenciosamente quando a sinalização falha.
* Removido o logger que ocultava todos os erros WebSocket após a primeira falha.
* Diagnóstico visível, timeout de autenticação, botão de reconexão e recuperação
  após uma desconexão forçada pelo servidor.
* Hosts de desenvolvimento restritos ao domínio indicado e a `TUNNEL_HOSTS`;
  não é necessário permitir globalmente todos os túneis públicos.

## Correções anteriores (V2)

* Servidor resistente a caminhos HTTP malformados, bytes nulos e travessia para diretórios com prefixo semelhante.
* Argumentos de confirmação Socket.IO inválidos deixam de provocar exceções no servidor.
* Validação de mensagens e ofertas P2P reforçada: IDs vazios, datas não finitas e tamanhos fracionários são rejeitados.
* Mensagens JSON nulas ou inválidas no DataChannel são ignoradas; falhas ao finalizar gravações em disco são reportadas e finais duplicados são ignorados.
* Escritas em IndexedDB só são confirmadas após o commit da transação, incluindo tratamento de abortos posteriores ao sucesso do pedido.
* Limpeza de presença e ofertas pendentes ao perder a ligação ao servidor.
* Compositor isolado por conversa, com proteção contra gravações concorrentes, limpeza de pedidos de microfone concluídos após sair e tratamento de erros de envio.
* Corrigidos os cinco erros iniciais de ESLint. Dependências atualizadas, incluindo Vite 6.4.6; Playwright, esbuild e fake-indexeddb declarados para os testes.
* Verificação final: 13 testes aprovados, 19 verificações no Chromium aprovadas, compilação e ESLint sem erros; ambas as auditorias npm sem vulnerabilidades reportadas no momento da revisão.

Esta revisão não constitui uma auditoria de segurança completa nem garante ausência de vulnerabilidades.

## Limitações conhecidas

* A identidade vive neste browser: limpar os dados do site perde-a (não há recuperação, por desenho).
* Chamadas e ficheiros são 1:1 (texto e voz suportam grupos, com envio individual a cada membro).
* O tamanho de ficheiros guardados para envio posterior é limitado a 50 MB; acima disso só se enviam com o contacto online.
* Não há bloqueio de contactos nem verificação do ID por QR/código; confirme o ID por outro canal.


## V7 full — novidades

**Conta por email (opcional).** Em *Definições → Conta* liga um email, recebe um código de 6 dígitos e escolhe uma palavra-passe de
recuperação. Perfil, contactos, bloqueados, definições e a chave são cifrados no browser (PBKDF2 + AES-GCM) e guardados em
`server/data/accounts.json`; o servidor nunca vê a palavra-passe. Noutro dispositivo use **Entrar com email**. Conversas e ficheiros
ficam só nos dispositivos. Para Gmail: verificação em 2 passos + palavra-passe de aplicação, `GMAIL_USER` e `GMAIL_APP_PASSWORD` em
`.env.local`, e `npm run server:install` (nodemailer). Sem isso o código aparece no terminal do servidor.

**Contactos.** Menu ⋮: bloquear/desbloquear e apagar contacto. **Chamadas.** Volume, tom e teste do toque em Definições; botão Alta-voz
na chamada (em telemóveis a saída é decidida pelo sistema). **Localização.** Botão 📍: atual, escolher no mapa (OpenStreetMap) e em tempo
real (15 min, 1 h, 8 h; só com a página aberta). Requer HTTPS (ngrok) ou localhost.


## APK Android (Capacitor) e modo servidor

O mesmo cliente pode ser empacotado como APK. O APK é só o cliente: liga-se a um servidor de sinalização (ngrok, Tailscale, Cloudflare ou outro).
Opcionalmente, **7 toques seguidos no logótipo** abrem o *Modo servidor*, que arranca o servidor Node.js dentro do próprio telemóvel.

### Requisitos (no PC)

Node.js 22+, JDK 21 e Android Studio (com o Android SDK). Acesso à internet para `npm install` e para o Gradle.

### Compilar

```bash
npm install
npm run server:install
npm run android:init     # só na primeira vez: cria android/ e ajusta permissões e serviço
npm run android:build    # compila web + servidor embebido e sincroniza com o Android
npm run android:open     # abre o Android Studio
```

No Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Em linha de comandos: `cd android && ./gradlew assembleDebug`
(Windows: `gradlew.bat assembleDebug`). O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`.
Repita `npm run android:build` sempre que alterar o código.

### Utilização

1. Ao abrir o APK pela primeira vez, indique o endereço do servidor (por exemplo `https://o-seu-host.ngrok-free.app`). Pode alterá-lo em *Definições → Servidor*.
2. **Modo servidor:** toque 7 vezes no logótipo (ecrã inicial ou canto superior esquerdo da lista de conversas). Aí pode:
   * definir a porta, o endereço público do túnel e o Gmail para o envio de códigos;
   * iniciar o servidor neste telemóvel e ligar a app a ele (`http://127.0.0.1:PORTA`).
3. Para outros acederem ao servidor do telemóvel: mesma Wi‑Fi (`http://IP:PORTA`), Tailscale (`http://100.x.y.z:PORTA`) ou um túnel HTTPS que aponte para a porta do telemóvel (por exemplo, `cloudflared`/`ngrok` no Termux, ou num PC para `IP-DO-TELEMÓVEL:PORTA`).
4. Os browsers exigem HTTPS para microfone/câmara; o APK aceita também `http://` (rede local ou Tailscale).

### Notas e limitações

* O servidor embebido usa o plugin [capacitor-nodejs](https://github.com/hampoelz/Capacitor-NodeJS) (Node.js 18). O autor declara-o **sem manutenção**; o seu uso aqui está isolado no modo servidor. Sem ele, o APK continua a funcionar como cliente.
* O runtime Node não pode ser parado nem reiniciado dentro da app: para parar o servidor ou aplicar uma nova configuração, feche a app por completo.
* O servidor só fica ativo em segundo plano com o serviço em primeiro plano (notificação permanente). Permita as notificações e retire a app da otimização de bateria.
* O Node embebido aumenta bastante o tamanho do APK.
* A palavra-passe de aplicação do Gmail fica guardada em texto no armazenamento da app neste telemóvel.
* Ficheiros recebidos ficam em memória (sem escrita direta em disco no WebView).


## Contactos, partilha por QR e grupos

* **Editar contacto:** menu ⋮ de um contacto → *Editar contacto* (muda o nome; o ID identifica a pessoa e não se edita).
* **Partilhar contacto:** no seu perfil (ou no menu ⋮ de um contacto) há um cartão com código QR e os botões *Partilhar* (menu do sistema) e *Copiar*.
  O QR contém uma ligação `https://…/#add=ID&n=Nome`; quem a abre no browser (ou lê o QR em *Adicionar contacto → Ler código QR com a câmara*) fica com o formulário preenchido.
  A leitura usa a câmara (precisa de HTTPS ou do APK) e também aceita uma imagem com o código.
* **Endereço de acesso:** *Definições → Convidar* e o *Modo servidor* partilham o endereço da app (texto, ligação e QR).
* **Grupos com administrador:** em *Nova conversa*, escolha dois ou mais contactos e dê um nome. Quem cria o grupo é o único administrador e, em *Informações do grupo*, pode mudar o nome e adicionar ou remover participantes (máx. 25).
  * O identificador do grupo contém o ID do criador; os clientes só aceitam alterações vindas dele, por isso um membro não consegue forjá-las.
  * Cada alteração tem um número de versão e vence a mais recente. Um membro offline recebe as alterações quando voltar a ligar-se (ficam na fila do administrador).
  * Quem é removido deixa de receber e de poder enviar mensagens novas, mas mantém o histórico que já tinha.
  * Apagar a conversa de um grupo equivale a sair dele neste dispositivo: os restantes não são avisados.
  * Os grupos antigos (criados antes desta versão, sem administrador) continuam a funcionar como antes.
  * As conversas de grupo não fazem parte da cópia de segurança da conta por email (tal como o histórico).


## Android: manter ligado, parar servidor e túneis

Tudo isto está no *Modo servidor* (7 toques no logótipo do APK).

* **Manter ligado em segundo plano** (ativo por omissão): serviço em primeiro plano com notificação permanente. Não usa bloqueio de CPU; o gasto é o de uma ligação aberta em repouso.
  Para ser fiável, peça a *isenção da otimização de bateria* no mesmo ecrã. Em Xiaomi, Huawei, Samsung e semelhantes pode ser preciso permitir também o «arranque automático» e bloquear a app nas apps recentes.
* **Parar servidor:** desliga as ligações, fecha o túnel e liberta a porta. Pode voltar a iniciar (inclusive noutra porta). Gmail e origens só mudam depois de fechar a app por completo.
* **Túnel HTTPS** (perfis guardados; pode ter vários domínios e trocar entre eles):
  * **ngrok** (agente oficial, authtoken + domínio opcional). Descarregue «Linux ARM64» em https://ngrok.com/download e execute **uma vez**, antes de `npm run android:build`:
    `npm run android:ngrok -- caminho/para/ngrok-v3-stable-linux-arm64.tgz`.
    O agente fica em `mobile/vendor/` (ignorado pelo Git; não o distribua) e é incluído no APK. Se o ngrok recusar um agente antigo, descarregue outro e repita o comando.
  * **Pinggy, localhost.run, srv.us, Serveo e SSH próprio:** por SSH (equivale a `ssh -R …`), com token, utilizador/palavra-passe ou chave (pode gerar uma ed25519 na app). O endereço público é detetado e passa a «endereço público» para partilhar.
  * Os perfis (authtokens, palavras-passe, chaves) ficam guardados em texto neste telemóvel.
* O plugin nativo (Java) é copiado para o projeto Android por `npm run android:build` (que corre `scripts/android-patch.mjs`), incluindo permissões, ícones e o empacotamento do agente.

## Administração da versão web

Quando o servidor é lançado a partir do terminal, ele mostra um **código de administrador** (ou use `ADMIN_TOKEN` no `.env.local`; `ADMIN_DISABLE=1` desativa o painel).
Na app web, toque 7 vezes no logótipo (canto superior esquerdo da lista de conversas, ou no título do ecrã inicial) e introduza o código.
O painel mostra o estado do servidor e edita o `.env.local` (porta, hosts de túnel, origens, STUN/TURN, Gmail…); as alterações só se aplicam depois de reiniciar. Os segredos nunca são mostrados e há limite de tentativas.

## Ícones

Os ícones (web e Android) são gerados a partir de `mobile/tools/app_icon_512x512.png` e `app_icon.ico`:
`python3 mobile/tools/make-icons.py` (requer Pillow). O ecrã de abertura (splash) do Capacitor não foi alterado.

## Testes

`npm test` (unitários), `npm run test:e2e` (dois a três utilizadores em Chromium) e `npm run test:admin` (painel de administração contra o servidor real).


## WhatsUp-p2p V9: atualizar o APK

1. Descompacte esta versão e, na pasta, execute `npm install` e `npm run android:build` (também aplica o ícone, o nome e a versão 9.0 ao projeto Android existente em `android/`; se a pasta `android/` ainda não existir, execute antes `npm run android:init`).
2. No Android Studio: **Build → Clean Project** e depois **Build → Generate App Bundles or APKs → Generate APKs**.
3. Instale o APK por cima da versão anterior (mantém os dados). Se o launcher continuar a mostrar o ícone antigo, desinstale a app (perde os dados locais, a não ser que use a conta por email) e instale de novo, ou reinicie o telemóvel para limpar a cache do launcher.

A interface respeita a barra de estado e a barra de navegação do Android (áreas seguras), no APK e no browser do telemóvel.
