# 💬 WhatsApp clone P2P
# App com 100% das funcionalidades do Whatsapp a funcionar em ponto a ponto, sem servidores externos, a app #funciona como WhatsApp p2p web, em PC, MAC, IPhone, Linux, Android e tem uma app em Android.
#( App por Ruben Vendeirinho @rubenvendeirinho https://www.facebook.com/rubenvendeirinho ) 
# O fim do mundo pode vir, mas enquanto o mundo não acabar, continuaremos a comunicar!

Aplicação tipo/clone do WhatsApp 100% ponto a ponto (p2p) e em tempo real que recria todas as funcionalidade existentes na app Whatsapp mas **sem base de dados no servidor** e **sem serviços de autenticação externos**, ligação e comunicações extremamente rápidas em ambiente rede local ou na Internet com recurso a túnel ngrok, tailscail ou outro para publicar em https e disponibilizar acesso a clientes, seja web ou por app android.
Funcionalidades existentes: Mensagens de texto, mensagens de voz, ficheiros e chamadas de voz/vídeo, grupos, tudo ponto a ponto utilizando WebRTC.
Ideal para grupos de trabalho, estudo, culturais ou recreativos, empresas, etc que pretendam obter estas funcionalidade em ambiente independente, privado e seguro, exposto à Internet se necessário e extremamente leve a nível de recursos, onde o servidor (pc, pcb, ou em termux num android smartphone) mal sente o peso do serviço, já que ele utiliza recursos mínimos para o funcionamento, sendo o maior peso processado pelo browser/navegador web dos clientes.

Tecnologias utilizadas
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange)

---

## ✨ Funcionalidades
- Web e App Android, ap apk necessita ser compilada. (eu utilizei o Android Studio) 
- **Identidade sem contas nem passwords.** No primeiro uso, o browser gera um par de chaves ECDSA P-256. O **ID** (20 caracteres, 100 bits) é um hash da chave pública.
- **Texto em tempo real**, incluindo conversas de grupo (envio individual a cada membro).
- **Mensagens de voz** (gravar, enviar, reproduzir). Voz de contactos guardados é aceite automaticamente; a de desconhecidos pede confirmação.
- **Transferência de ficheiros** por WebRTC, em blocos de 16 KiB com controlo de fluxo. Todos os ficheiros pedem confirmação. No Chrome/Edge desktop são escritos diretamente em disco (qualquer tamanho); nos restantes browsers ficam em memória (limite de 300 MB).
- **Chamadas de voz e vídeo 1:1**, com mute, passagem de voz para vídeo, alta-voz, volume, tom e teste do toque nas Definições.
- **Entrega offline sem base de dados.** O remetente guarda o que ficou por entregar (outbox em IndexedDB) e reenvia quando o contacto fica online.
- **Localização**: atual, escolhida no mapa (OpenStreetMap) ou em tempo real (15 min, 1 h ou 8 h, só com a página aberta).
- **Gestão de contactos**: adicionar por ID, bloquear/desbloquear e apagar.
- **Conta por email (opcional).** Liga um email, recebe um código de 6 dígitos e define uma palavra-passe de recuperação. Perfil, contactos, bloqueados, definições e chave são cifrados no browser (PBKDF2 + AES-GCM) antes de serem guardados. O servidor nunca vê a palavra-passe. Noutro dispositivo basta **Entrar com email**.

## 🧠 Como funciona

```
 Browser A ──┐                                    ┌── Browser B
   IndexedDB │      server/ (Node + Socket.IO)    │ IndexedDB
   chave ECDSA│  • autentica (desafio/assinatura) │ chave ECDSA
             ├──►  • relé de texto e sinais WebRTC ◄──┤
             │      • presença (só em memória)    │
             └────────── WebRTC (DTLS) ───────────┘
                 voz · ficheiros · áudio/vídeo das chamadas
```

1. **Autenticação por desafio/assinatura.** Ao ligar, o servidor envia um desafio aleatório, o cliente assina-o com a chave privada e o servidor verifica a assinatura e deriva o ID. Ninguém pode usar o ID de outra pessoa sem a respetiva chave privada.
2. **Texto** passa pelo servidor, apenas em memória, nunca em disco.
3. **Voz, ficheiros e chamadas** vão por WebRTC, cifrados (DTLS/SRTP), sem passar pelo servidor.
4. **A única persistência no servidor** é opcional: as contas por email, que guardam uma cópia de segurança **já cifrada no cliente** (`server/data/accounts.json`).

## 🧰 Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 18, Vite 6, Tailwind CSS 3, react-icons |
| Tempo real | Socket.IO (polling com upgrade para WebSocket), WebRTC |
| Armazenamento local | IndexedDB |
| Criptografia | WebCrypto (ECDSA P-256, PBKDF2, AES-GCM) |
| Backend | Node.js (HTTP nativo + Socket.IO), Nodemailer (opcional) |
| Testes | `node:test`, Playwright (Chromium), fake-indexeddb, ESLint |

## 📁 Estrutura

```
├── server/          # Sinalização, autenticação e contas por email
├── src/
│   ├── components/  # Chat, Composer, CallOverlay, MapView, Definições…
│   ├── context/     # AppProvider (estado global)
│   ├── core/        # net, peers (WebRTC), identity, account, db
│   └── lib/         # crypto, recorder, geo, backup, ring, validação…
├── scripts/dev.mjs  # Arranque único: sinalização + Vite
├── test/            # Testes unitários, de ligação e e2e
└── public/          # Logótipos e fundos
```

## 🚀 Instalação e execução

**Requisitos:** Node.js 22 ou superior.

```bash
git clone https://github.com/<o-teu-utilizador>/<o-teu-repositorio>.git
cd <o-teu-repositorio>

npm install
npm run server:install
npm run dev:all
```

O `dev:all` inicia o servidor Node e só abre o Vite depois de `/api/health` responder. A app fica em **http://localhost:5173**.

No Android utilizando o Termux:

Preparação
Instala o Termux a partir do F-Droid ou do GitHub. A versão da Play Store está desatualizada e dá problemas.
Copia o whatsapp-p2p_V7_full_working.zip para a pasta Transferências do telemóvel.
No Termux:
bash
pkg update && pkg upgrade
pkg install nodejs git unzip
termux-setup-storage          # aceita a permissão de ficheiros
cp ~/storage/downloads/whatsapp-p2p_V7_full_working.zip ~
unzip whatsapp-p2p_V7_full_working.zip
cd whatsapp-p2p_V7_full_working
Opção A (recomendada): compilar uma vez e servir com Node

É a mais leve, porque o servidor Node já serve a app compilada (dist/) e a sinalização na mesma porta.

bash
npm install
npm run server:install
npm run build
node server/index.js

Depois abre http://localhost:5000 no Chrome do próprio telemóvel. O localhost conta como contexto seguro, por isso microfone, câmara e WebCrypto funcionam sem HTTPS.

Se o npm install falhar no Termux, podes compilar no PC (npm run build) e copiar a pasta inteira, com dist/, para o telemóvel. Aí só precisas de npm run server:install e node server/index.js.

Para outros dispositivos usarem a tua app

Precisas de um túnel HTTPS para a porta 5000.

bash
pkg install cloudflared
cloudflared tunnel --url http://localhost:5000

O comando mostra um URL https://….trycloudflare.com, que os outros utilizadores abrem. Escolhi o cloudflared porque o ngrok costuma dar erros de DNS no Termux. No modo node server/index.js não é preciso configurar TUNNEL_HOSTS, porque essa restrição é do Vite.

Dois avisos:

Os dados (identidade, contactos, histórico) ficam ligados ao endereço. localhost:5000 e o URL do túnel são identidades diferentes, e o URL do cloudflared muda de cada vez que o reinicias. Por isso, quem usa o túnel deve criar a identidade já nesse URL, e perde-a se ele mudar.
Se tiveres problemas de ligação, define ALLOWED_ORIGINS=https://o-teu-url antes de arrancar o servidor.
Opção B: modo de desenvolvimento completo
bash
npm install
npm run server:install
npm run dev:all

Funciona em teoria, mas o Vite usa binários nativos (esbuild, rollup) e é aqui que o Termux costuma dar erro. Se aparecer algo como “esbuild: failed to install correctly”:

bash
pkg install esbuild
export ESBUILD_BINARY_PATH=$(which esbuild)

Neste modo precisas de TUNNEL_HOSTS com o host do túnel, e o ngrok com domínio fixo é mais prático do que o cloudflared.

Para o Android não matar o servidor
bash
termux-wake-lock

Desativa também a otimização de bateria do Termux nas definições. Mesmo assim, o Android 12 ou superior pode terminar processos em segundo plano, e a app deixa de receber mensagens quando isso acontece.

Limitações
Chamadas, ficheiros e mensagens offline dependem do servidor estar ligado, ou seja, do telemóvel acordado e com rede.
Sem servidor TURN, as chamadas podem falhar em redes móveis com NAT restritivo.
Se quiseres usar a conta por email, define GMAIL_USER e GMAIL_APP_PASSWORD com export antes de arrancar o servidor, ou num ficheiro .env.local.



### Testar entre dispositivos (ngrok)

Microfone, câmara e WebCrypto exigem HTTPS (exceto em `localhost`). Num segundo terminal:

```bash
ngrok http 5173
```

1. Todos abrem **o mesmo URL HTTPS** do ngrok.
2. Cada pessoa cria a sua identidade num browser ou perfil diferente.
3. Adicionem os IDs uns dos outros como contactos.

> ⚠️ **Não definas `VITE_SOCKET_URL=http://localhost:5000` para acesso remoto.** No telemóvel, `localhost` seria o próprio telemóvel. Deixa a variável por definir: a sinalização usa a origem da página.
>
> **Obrigatório com ngrok:** adiciona o domínio que o ngrok te atribuir ao `.env` (ou `.env.local`), sem `https://`, e reinicia: `TUNNEL_HOSTS=o-teu-host.ngrok-free.app`. Sem isto, o Vite devolve 403 a pedidos vindos do túnel.

### Diagnóstico de ligação

Abre `https://O-TEU-HOST/api/health`. O esperado é JSON com `ok: true` e `service: "whatsapp-p2p-signaling"`. HTML ou erro indicam túnel na porta errada ou sinalização parada.

> Não limpes os dados do site para resolver problemas de ligação: perdes a identidade, os contactos e o histórico.

## ⚙️ Configuração

Copia `.env.example` para `.env` (ou `.env.local`) e ajusta o que precisares.

| Variável | Função |
|---|---|
| `PORT` | Porta da sinalização (omissão: 5000) |
| `SIGNALING_URL` | Servidor de sinalização externo (o `dev:all` não cria outro) |
| `TUNNEL_HOSTS` | Hosts de túnel autorizados, separados por vírgula |
| `VITE_SOCKET_URL` | Só se a sinalização estiver noutro domínio |
| `ALLOWED_ORIGINS` | Origens CORS quando a app é servida de outro domínio |
| `STUN_URLS` | Servidores STUN (omissão: Google) |
| `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` | TURN com credenciais temporárias (coturn `use-auth-secret`) |
| `ICE_SERVERS` | JSON completo de ICE servers |
| `TLS_KEY`, `TLS_CERT` | HTTPS direto no servidor |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Envio do código por email (Gmail) |
| `ACCOUNTS_FILE` | Ficheiro das contas (omissão: `server/data/accounts.json`) |

### Conta por email com Gmail (opcional)

1. Ativa a verificação em 2 passos na conta Google.
2. Cria uma **palavra-passe de aplicação**.
3. Define `GMAIL_USER` e `GMAIL_APP_PASSWORD` em `.env.local`.
4. Executa `npm run server:install` (instala o nodemailer).

Sem isto, o código de 6 dígitos aparece no terminal do servidor, o que é útil para testes.

## 🏭 Produção

```bash
npm run build
TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node server/index.js
```

O servidor serve `dist/` e a sinalização, com cabeçalhos de segurança e CSP. Em alternativa, coloca um proxy TLS à frente.

**Instala um servidor TURN (coturn).** Sem ele, chamadas e transferências falham em redes com NAT restritivo.

## 🧪 Testes

```bash
npm run lint
npm test                 # compila e executa os testes unitários e de ligação
npx playwright install chromium   # apenas uma vez
npm run test:e2e         # dois utilizadores em Chromium (Hub simulado)
npm run test:signaling   # Chromium + Socket.IO reais, fallback por polling, reinício do servidor
```

O e2e cobre: login por assinatura, contactos e presença, texto, outbox offline, voz, ficheiros nos dois sentidos (verificação SHA-256), escrita em disco, recusa de ficheiros e chamadas voz→vídeo com mute, recusa e repetição.

**Não testado:** túnel ngrok real, redes externas, TURN real, dispositivos físicos e outros navegadores.

## 🔒 Segurança e privacidade

- Chaves privadas nunca saem do browser, exceto cifradas na cópia de segurança da conta.
- O servidor não guarda mensagens, contactos nem ficheiros.
- Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e CSP restrita.
- Limite de tentativas e de pedidos nos códigos por email.

Este projeto **não foi sujeito a uma auditoria de segurança completa**. Não o uses para comunicações críticas sem revisão independente.

## ⚠️ Limitações conhecidas

- A identidade vive no browser: limpar os dados do site perde-a (a menos que exista conta por email).
- Chamadas e ficheiros são apenas 1:1.
- Ficheiros guardados para envio posterior estão limitados a 50 MB; acima disso só se enviam com o contacto online.
- A entrega offline exige que remetente e destinatário estejam online *em algum momento*, e que o remetente não limpe os dados do browser até lá.
- Não há verificação do ID por QR/código. Confirma o ID por outro canal.
- Localização em tempo real só funciona com a página aberta.

## 🤝 Contribuir

Issues e pull requests são bem-vindos. Antes de submeter, corre `npm run lint` e `npm test`.

Desenvolvido por Ruben Vendeirinho
## 📄 Licença 

The MIT License (MIT)

Copyright (c) <year> Ruben Vendeirinho

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
