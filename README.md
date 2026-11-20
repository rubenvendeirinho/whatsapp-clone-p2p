💬 WhatsUp-p2p V9
Chat ponto a ponto em tempo real, sem base de dados no servidor e sem serviços de autenticação externos.
Funciona como web app em PC, Mac, Linux, iPhone e Android, e tem uma app Android (APK) que pode até alojar o próprio servidor.
> *O fim do mundo pode vir, mas enquanto o mundo não acabar, continuaremos a comunicar!*
>
> App por **Ruben Vendeirinho** ([@rubenvendeirinho] (https://www.facebook.com/rubenvendeirinho))
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange)
![Capacitor](https://img.shields.io/badge/Capacitor-Android-119eff?logo=capacitor&logoColor=white)
> Projeto independente. Não é afiliado, patrocinado nem aprovado pela WhatsApp LLC / Meta. «WhatsApp» é uma marca registada dos respetivos proprietários.
Aplicação tipo WhatsApp, 100 % ponto a ponto (P2P) e em tempo real, que recria as principais funcionalidades de uma app de mensagens sem base de dados no servidor e sem serviços de autenticação externos. A ligação é muito rápida em rede local ou na Internet, com recurso a um túnel HTTPS (ngrok, Tailscale, Cloudflare, Pinggy…) para dar acesso a clientes web ou à app Android.
Ideal para grupos de trabalho, estudo, culturais ou recreativos e empresas que querem um ambiente independente, privado e seguro, exposto à Internet se necessário. É leve: o servidor (PC, placa tipo Raspberry, Termux ou o próprio smartphone Android) quase não sente o peso, porque o trabalho pesado é feito pelo browser dos clientes.
---
✨ Funcionalidades
Web e app Android. O APK tem de ser compilado por si (usei o Android Studio; ver APK Android).
Identidade sem contas nem palavras-passe. No primeiro uso, o dispositivo gera um par de chaves ECDSA P-256. O ID (20 caracteres, 100 bits) é um hash da chave pública.
Texto em tempo real, em conversas individuais e de grupo.
Grupos com administrador. O criador é o único administrador e pode mudar o nome, adicionar e remover participantes (máx. 25). As alterações são versionadas e só são aceites se vierem do criador.
Mensagens de voz (gravar, enviar, reproduzir). A voz de contactos guardados é aceite automaticamente; a de desconhecidos pede confirmação.
Transferência de ficheiros por WebRTC, em blocos de 16 KiB com controlo de fluxo. Todos os ficheiros pedem confirmação. No Chrome/Edge de computador são escritos diretamente em disco (qualquer tamanho); nos restantes ficam em memória (limite de 300 MB).
Chamadas de voz e vídeo 1:1, com mute, passagem de voz para vídeo, alta-voz, volume, tom e teste do toque nas Definições.
Entrega offline sem base de dados. O remetente guarda o que ficou por entregar (caixa de saída em IndexedDB) e reenvia quando o contacto fica online.
Localização: atual, escolhida no mapa (OpenStreetMap) ou em tempo real (15 min, 1 h ou 8 h, só com a página aberta).
Contactos: adicionar por ID, editar o nome, bloquear/desbloquear e apagar.
Partilha de contactos por QR e meios do sistema: cartão com código QR, botão Partilhar (menu do sistema) e Copiar; leitura de QR com a câmara (ou a partir de uma imagem) para adicionar contactos.
Partilha do endereço de acesso à app (texto, ligação e QR) em Definições → Convidar.
Conta por email (opcional). Liga um email, recebe um código de 6 dígitos e define uma palavra-passe de recuperação. Perfil, contactos, bloqueados, definições e chave são cifrados no dispositivo (PBKDF2 + AES-GCM) antes de serem guardados. O servidor nunca vê a palavra-passe. Noutro dispositivo basta Entrar com email.
Painel de administração na versão web (servidor lançado a partir do terminal): ver abaixo.
Só na app Android
Modo servidor (7 toques no logótipo): arranca o servidor Node.js dentro do telemóvel, com botões Iniciar e Parar.
Túneis HTTPS a partir do telemóvel: ngrok (agente oficial, com authtoken e domínio à escolha), Pinggy, localhost.run, srv.us, Serveo e SSH próprio, com vários perfis guardados.
Manter ligado em segundo plano, com poupança de bateria (serviço em primeiro plano, sem bloqueio permanente do processador).
Interface adaptada à barra de estado e à de navegação do Android.
---
🧠 Como funciona
```
 Browser A ──┐                                      ┌── Browser B
  IndexedDB  │      server/ (Node + Socket.IO)      │  IndexedDB
  chave ECDSA│  • autentica (desafio/assinatura)    │  chave ECDSA
             ├──►• relé de texto e sinais WebRTC ◄──┤
             │   • presença (só em memória)         │
             └────────── WebRTC (DTLS) ─────────────┘
                voz · ficheiros · áudio/vídeo das chamadas
```
Autenticação por desafio/assinatura. O servidor envia um desafio aleatório, o cliente assina-o com a chave privada e o servidor verifica a assinatura e deriva o ID. Ninguém pode usar o ID de outra pessoa sem a respetiva chave privada.
Texto passa pelo servidor, apenas em memória, nunca em disco.
Voz, ficheiros e chamadas vão por WebRTC, cifrados (DTLS/SRTP), sem passar pelo servidor.
Grupos: o identificador do grupo contém o ID do criador. Cada alteração (nome, membros) é uma mensagem de controlo com número de versão; os clientes só a aceitam se vier do criador e se for mais recente.
A única persistência no servidor é opcional: as contas por email, que guardam uma cópia de segurança já cifrada no cliente (`server/data/accounts.json`).
🧰 Stack
Camada	Tecnologias
Frontend	React 18, Vite 6, Tailwind CSS 3, react-icons, qrcode, jsQR
Tempo real	Socket.IO (polling com upgrade para WebSocket), WebRTC
Armazenamento local	IndexedDB
Criptografia	WebCrypto (ECDSA P-256, PBKDF2, AES-GCM)
Backend	Node.js (HTTP nativo + Socket.IO), Nodemailer (opcional)
Android	Capacitor, Node.js embebido (capacitor-nodejs), plugin nativo em Java, ssh2 (túneis)
Testes	`node:test`, Playwright (Chromium), ESLint
📁 Estrutura
```
├── server/            # Sinalização, autenticação, contas por email e painel de administração
├── src/
│   ├── components/    # Chat, Composer, CallOverlay, GroupInfo, ServerPanel, TunnelPanel, AdminPanel…
│   ├── context/       # AppProvider (estado global)
│   ├── core/          # net, peers (WebRTC), identity, account, db
│   └── lib/           # crypto, grupos, túneis, QR/partilha, gravação, localização…
├── mobile/            # Android: Node embebido, túneis SSH, plugin Java, ícones e ferramentas
├── scripts/           # dev.mjs (arranque único) e scripts de build do Android
├── test/              # Testes unitários, de ligação e e2e
└── public/            # Logótipos, ícones e fundos
```
---
🚀 Instalação e execução (web)
Requisitos: Node.js 22 ou superior.
```bash
git clone https://github.com/<o-teu-utilizador>/<o-teu-repositorio>.git
cd <o-teu-repositorio>

npm install
npm run server:install
npm run dev:all
```
O `dev:all` inicia o servidor Node e só abre o Vite depois de `/api/health` responder. A app fica em http://localhost:5173. O terminal mostra também o código de administrador (ver Administração).
Testar entre dispositivos (ngrok)
Microfone, câmara, câmara de QR e WebCrypto exigem HTTPS (exceto em `localhost`). Num segundo terminal:
```bash
ngrok http 5173
```
Todos abrem o mesmo URL HTTPS do ngrok.
Cada pessoa cria a sua identidade num browser ou perfil diferente.
Adicionem os IDs uns dos outros (ou leiam o QR de contacto).
> ⚠️ **Não definas `VITE_SOCKET_URL=http://localhost:5000` para acesso remoto.** No telemóvel, `localhost` seria o próprio telemóvel. Deixa a variável por definir: a sinalização usa a origem da página.
>
> **Obrigatório com ngrok:** adiciona o domínio que o ngrok te atribuir ao `.env.local`, sem `https://`, e reinicia: `TUNNEL_HOSTS=o-teu-host.ngrok-free.app`. Sem isto, o Vite devolve 403 a pedidos vindos do túnel. (Também podes editá-lo no [painel de administração](#-administração-da-versão-web).)
Diagnóstico de ligação
Abre `https://O-TEU-HOST/api/health`. O esperado é JSON com `ok: true` e `service: "whatsapp-p2p-signaling"`. HTML ou erro indicam túnel na porta errada ou sinalização parada.
> Não limpes os dados do site para resolver problemas de ligação: perdes a identidade, os contactos e o histórico.
---
🤖 APK Android
O APK é o cliente (e, se quiseres, também o servidor). Compila-se no teu PC.
Requisitos: Node.js 22+, JDK 21 e Android Studio (com o Android SDK), e internet para o `npm install` e o Gradle.
```bash
npm install                 # não uses "npm ci"
npm run server:install
npm run android:init        # só da primeira vez: cria a pasta android/ e ajusta permissões, ícones e nome
npm run android:ngrok -- caminho/para/ngrok-v3-stable-linux-arm64.tgz   # opcional (túnel ngrok)
npm run android:build       # compila web + servidor embebido e sincroniza com o Android
npm run android:open        # abre o Android Studio
```
No Android Studio:
Espera pelo Gradle Sync (File → Sync Project with Gradle Files se parar). Em Settings → Build Tools → Gradle, confirma que o Gradle JDK é o 21.
Build → Clean Project (recomendado em atualizações).
Build → Generate App Bundles or APKs → Generate APKs. O ficheiro fica em `android/app/build/outputs/apk/debug/app-debug.apk`. (Em linha de comandos: `cd android && ./gradlew assembleDebug`; no Windows `gradlew.bat assembleDebug`.)
Instala no telemóvel (cabo + ▶ Run, ou copia o APK e permite fontes desconhecidas). Instalar por cima mantém os dados.
Sempre que alterares o código, repete `npm run android:build`. Se o launcher continuar a mostrar o ícone antigo, reinicia o telemóvel (desinstalar apaga os dados locais).
Primeira utilização
Indica o endereço do servidor (por exemplo, o túnel HTTPS de quem aloja a app). Pode ser mudado em Definições → Servidor.
Para usar o servidor do próprio telemóvel: toca 7 vezes no logótipo → Modo servidor → Iniciar servidor → «Usar o servidor deste telemóvel».
Concede as notificações e, no Modo servidor, pede a isenção da otimização de bateria.
Modo servidor (7 toques no logótipo)
Secção	O que faz
Servidor a que a app se liga	Endereço do servidor (túnel, IP da rede local ou o do telemóvel)
Servidor neste telemóvel	Porta, endereço público, Gmail para códigos, arranque automático, Iniciar / Parar
Manter ligado em segundo plano	Serviço em primeiro plano (ativo por omissão) e pedido de isenção de bateria
Túnel HTTPS	Perfis de túnel e botões Iniciar túnel / Parar túnel
Como dar acesso a outros	Partilha do endereço (texto, ligação, QR) e instruções
Parar desliga as ligações, fecha o túnel e liberta a porta; podes voltar a iniciar (inclusive noutra porta). Alterações ao Gmail só se aplicam depois de fechar a app por completo.
Túneis a partir do telemóvel
Serviço	Autenticação	Notas
ngrok	Authtoken (+ domínio fixo opcional)	Usa o agente oficial (Linux ARM64). Descarrega-o em ngrok.com/download e corre `npm run android:ngrok -- ficheiro.tgz` antes de compilar. Não o incluas no repositório nem distribuas o APK com ele. Podes ter vários perfis (vários domínios) e trocar entre eles.
Pinggy	Token opcional	Sem token é gratuito (o endereço muda e expira).
localhost.run	Utilizador/chave opcionais	Sem chave: endereço aleatório.
srv.us	Chave SSH (a app gera uma)	O endereço depende da chave.
Serveo	Subdomínio/chave opcionais	
SSH próprio	Utilizador + palavra-passe ou chave	Equivale a `ssh -R`; a chave do servidor é fixada na 1.ª ligação; podes indicar o endereço público.
O endereço detetado passa a «endereço público», pronto a partilhar. Os perfis (authtokens, palavras-passe, chaves) ficam guardados em texto neste telemóvel.
Para dar acesso sem túnel: mesma Wi‑Fi (`http://IP-DO-TELEMÓVEL:PORTA`, só nos APKs) ou Tailscale (`http://100.x.y.z:PORTA`, só nos APKs). Os browsers exigem HTTPS.
Notas Android
O servidor embebido usa o plugin capacitor-nodejs (Node 18), que o autor declara sem manutenção; fica isolado no modo servidor (sem ele o APK continua a funcionar como cliente).
O Node embebido aumenta bastante o tamanho do APK; o agente do ngrok só existe para arm64.
Em Xiaomi, Huawei, Samsung e semelhantes pode ser preciso permitir o «arranque automático» e bloquear a app nas apps recentes para ela não ser adormecida.
Os ícones (web e Android) geram-se com `python3 mobile/tools/make-icons.py` (Pillow). O ecrã de abertura do Capacitor não foi alterado.
---
🖥️ Servidor num Android com Termux
Alternativa ao modo servidor do APK: correr o servidor no Termux.
Instala o Termux a partir do F-Droid ou do GitHub (a versão da Play Store está desatualizada).
No Termux:
```bash
pkg update && pkg upgrade
pkg install nodejs git
git clone https://github.com/<o-teu-utilizador>/<o-teu-repositorio>.git
cd <o-teu-repositorio>
```
Opção A (recomendada): compilar uma vez e servir com Node. O servidor serve a app compilada (`dist/`) e a sinalização na mesma porta.
```bash
npm install
npm run server:install
npm run build
node server/index.js
```
Abre http://localhost:5000 no Chrome do próprio telemóvel (`localhost` conta como contexto seguro). Se o `npm install` falhar no Termux, compila no PC (`npm run build`) e copia a pasta, com `dist/`, para o telemóvel; aí só precisas de `npm run server:install` e `node server/index.js`.
Para outros dispositivos, um túnel HTTPS para a porta 5000:
```bash
pkg install cloudflared
cloudflared tunnel --url http://localhost:5000
```
Mostra um URL `https://….trycloudflare.com`. No modo `node server/index.js` não é preciso `TUNNEL_HOSTS` (essa restrição é do Vite).
> ⚠️ Os dados (identidade, contactos, histórico) ficam ligados ao **endereço**. `localhost:5000` e o URL do túnel são identidades diferentes, e o URL do cloudflared muda a cada reinício: cria a identidade já no URL que vais usar. Se tiveres problemas de ligação, define `ALLOWED_ORIGINS=https://o-teu-url` antes de arrancar.
Opção B: modo de desenvolvimento (`npm run dev:all`). O Vite usa binários nativos e o Termux costuma falhar; se aparecer «esbuild: failed to install correctly»: `pkg install esbuild` e `export ESBUILD_BINARY_PATH=$(which esbuild)`. Aqui precisas de `TUNNEL_HOSTS` (o ngrok com domínio fixo é mais prático).
Para o Android não matar o servidor: `termux-wake-lock` e desativa a otimização de bateria do Termux. Mesmo assim, o Android 12+ pode terminar processos em segundo plano.
Limitações: chamadas, ficheiros e mensagens offline dependem do servidor estar ligado (telemóvel acordado e com rede); sem servidor TURN, as chamadas podem falhar em redes móveis com NAT restritivo.
---
🛠️ Administração da versão web
Quando o servidor é lançado a partir do terminal, mostra um código de administrador (ou usa o `ADMIN_TOKEN` que definires; `ADMIN_DISABLE=1` desativa o painel).
Na app web, toca 7 vezes no logótipo (canto superior esquerdo da lista de conversas, ou no título do ecrã inicial).
Introduz o código.
O painel mostra o estado do servidor (Node, tempo ativo, porta, utilizadores online, envio de códigos) e permite editar o `.env.local`: porta, hosts de túnel, origens, STUN/TURN, Gmail…
As alterações só se aplicam quando reiniciares o servidor. Os segredos nunca são mostrados e há limite de tentativas. No APK o painel web fica desativado (usa-se o Modo servidor).
---
⚙️ Configuração
Copia `.env.example` para `.env.local` e ajusta o que precisares (ou usa o painel de administração).
Variável	Função
`PORT`	Porta da sinalização (omissão: 5000)
`SIGNALING_URL`	Servidor de sinalização externo (o `dev:all` não cria outro)
`TUNNEL_HOSTS`	Hosts de túnel autorizados no Vite, separados por vírgula
`VITE_SOCKET_URL`	Só se a sinalização estiver noutro domínio
`ALLOWED_ORIGINS`	Origens CORS quando a app é servida de outro domínio
`STUN_URLS`	Servidores STUN (omissão: Google)
`TURN_URLS`, `TURN_SECRET`, `TURN_TTL`	TURN com credenciais temporárias (coturn `use-auth-secret`)
`ICE_SERVERS`	JSON completo de ICE servers
`TLS_KEY`, `TLS_CERT`	HTTPS direto no servidor
`GMAIL_USER`, `GMAIL_APP_PASSWORD`	Envio do código por email (Gmail)
`ACCOUNTS_FILE`	Ficheiro das contas (omissão: `server/data/accounts.json`)
`ADMIN_TOKEN`	Código de administrador fixo (mín. 8 caracteres; omissão: gerado ao arrancar)
`ADMIN_DISABLE`	`1` desativa o painel de administração
Conta por email com Gmail (opcional)
Ativa a verificação em 2 passos na conta Google.
Cria uma palavra-passe de aplicação.
Define `GMAIL_USER` e `GMAIL_APP_PASSWORD` em `.env.local` (ou no Modo servidor do APK).
Executa `npm run server:install` (instala o nodemailer).
Sem isto, o código de 6 dígitos aparece no terminal do servidor, o que é útil para testes.
🏭 Produção
```bash
npm run build
TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node server/index.js
```
O servidor serve `dist/` e a sinalização, com cabeçalhos de segurança e CSP. Em alternativa, coloca um proxy TLS à frente.
Instala um servidor TURN (coturn). Sem ele, chamadas e transferências falham em redes com NAT restritivo.
🧪 Testes
```bash
npm run lint
npm test                          # testes unitários e de ligação
npx playwright install chromium   # apenas uma vez
npm run test:e2e                  # três utilizadores em Chromium (Hub simulado): mensagens, grupos, contactos, chamadas…
npm run test:admin                # painel de administração contra o servidor real
npm run test:signaling            # Chromium + Socket.IO reais, fallback por polling, reinício do servidor
```
O e2e cobre: login por assinatura, contactos (editar, partilhar com QR), presença, texto, caixa de saída offline, voz, ficheiros nos dois sentidos (verificação SHA-256), escrita em disco, chamadas voz→vídeo com mute/recusa/repetição, grupos com administrador (criar, adicionar, remover, remoção com o membro offline, ordem forjada ignorada) e a área secreta.
Não testado em ambiente real: a app Android em telemóveis de várias marcas, os túneis a partir do telemóvel com contas reais (ngrok, Pinggy, etc.), TURN real e redes externas.
🔒 Segurança e privacidade
Chaves privadas nunca saem do dispositivo, exceto cifradas na cópia de segurança da conta.
O servidor não guarda mensagens, contactos nem ficheiros.
Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e CSP restrita.
Limite de tentativas e de pedidos nos códigos por email e no painel de administração.
No APK, authtokens, palavras-passe, chaves SSH e a palavra-passe de aplicação do Gmail ficam guardados em texto no armazenamento da app.
Este projeto não foi sujeito a uma auditoria de segurança completa. Não o uses para comunicações críticas sem revisão independente.
⚠️ Limitações conhecidas
A identidade vive no dispositivo e está ligada ao endereço da app: limpar os dados do site ou mudar de endereço perde-a (a menos que exista conta por email).
As chamadas são só 1:1. Voz, ficheiros e localização enviam-se a cada membro, também em grupos.
Ficheiros guardados para envio posterior estão limitados a 50 MB; acima disso só se enviam com o contacto online.
A entrega offline exige que remetente e destinatário estejam online em algum momento, e que o remetente não limpe os dados até lá.
O QR de contacto partilha o ID, mas não o verifica: confirma o ID por outro canal se for importante.
Grupos: um único administrador (se perder a identidade, o grupo fica sem administração); quem é removido mantém o que já recebeu; quem é adicionado não vê as mensagens anteriores; apagar a conversa de um grupo equivale a sair dele neste dispositivo; as conversas de grupo não entram na cópia de segurança da conta por email.
Localização em tempo real só funciona com a página aberta.
A leitura de QR com a câmara precisa de HTTPS (ou `localhost`, ou o APK).
Android: o servidor e os túneis a partir do telemóvel dependem do telemóvel ligado, acordado e com rede, e alguns fabricantes adormecem a app mesmo com a isenção de bateria.
🤝 Contribuir
Issues e pull requests são bem-vindos. Antes de submeter, corre `npm run lint` e `npm test`.
Desenvolvido por Ruben Vendeirinho.
📄 Licença
The MIT License (MIT)
Copyright (c) 2026 Ruben Vendeirinho
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
