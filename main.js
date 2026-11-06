const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const SENHAS_SERVIDOR = ['cln2015', 'l@(w#0&3j!'];
const CREDENCIAIS_TELEFONIA = [
    { user: 'root', pass: 'cln2015' },
    { user: 'suporte-ti', pass: 'suporte@l3bes', elevatePass: 'cln2015' },
    { user: 'infra-linux', pass: 'SU^p_h541W@g' }
];

// Localiza um executável nas pastas padrão (Program Files e Program Files (x86))
function acharExecutavel(nome) {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const rel = {
        putty: ['PuTTY\\putty.exe'],
        plink: ['PuTTY\\plink.exe'],
        winscp: ['WinSCP\\WinSCP.exe'],
        mobaxterm: ['Mobatek\\MobaXterm\\MobaXterm.exe'],
        vnc: ['uvnc bvba\\UltraVNC\\vncviewer.exe', 'UltraVNC\\vncviewer.exe']
    }[nome] || [];
    const candidatos = [];
    for (const r of rel) { candidatos.push(path.join(pf, r), path.join(pf86, r)); }
    for (const c of candidatos) { if (fs.existsSync(c)) return c; }
    return candidatos[0] || nome;
}

// Pasta de atualizações na rede (version.json, atualizar.bat)
const CAMINHO_REDE_UPDATE = '\\\\10.2.0.21\\setores\\TI\\INFORMAÇÕES DE USO INTERNO\\SERVICE DESK\\Diversos\\Automacao\\LebesAutomation\\Atualizacoes\\';

let cacheSenhaServidor = {};
let cacheCredencialTelefonia = {};
let cacheSenhaPDV = {};

function obterHostKeyPlink(ip, user, plinkPath) {
    return new Promise(resolve => {
        if (!fs.existsSync(plinkPath)) return resolve("");

        exec(`"${plinkPath}" -batch -ssh ${user}@${ip} exit`, { timeout: 3000 }, (err, stdout, stderr) => {
            const output = (stdout || '') + '\n' + (stderr || '') + '\n' + (err ? err.message : '');

            const match = output.match(/(SHA256:[a-zA-Z0-9+/=]+)/);
            if (match) return resolve(` -hostkey "${match[1]}"`);

            const matchMd5 = output.match(/([0-9a-f]{2}(?::[0-9a-f]{2}){15})/i);
            if (matchMd5) return resolve(` -hostkey "${matchMd5[1]}"`);

            resolve("");
        });
    });
}

// MOTOR NATIVO COM AUTO-FALLBACK INTELIGENTE
async function rodarPdvNativo(ip, user, comando, isSilent = false, senhaForcada = null) {
    const b64Cmd = Buffer.from(comando, 'utf-8').toString('base64');
    const cmdExec = `echo ${b64Cmd} | base64 -d | sh`;

    let tentativasDeSenha = [];
    if (senhaForcada) {
        tentativasDeSenha = [senhaForcada];
    } else {
        tentativasDeSenha = cacheSenhaPDV[ip] ? [cacheSenhaPDV[ip], 'p2k2016', 'p2k20', '123456'] : ['p2k2016', 'p2k20', '123456'];
        tentativasDeSenha = [...new Set(tentativasDeSenha)];
    }

    for (const senhaTestada of tentativasDeSenha) {
        try {
            const resultado = await tentarConexaoSSH(ip, user, senhaTestada, cmdExec, isSilent, true);

            if (!senhaForcada && user === 'root') {
                cacheSenhaPDV[ip] = senhaTestada;
            }
            return resultado;
        } catch (erro) {
            const msg = erro.message ? erro.message.toLowerCase() : '';
            if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('ehostunreach') || msg.includes('timed out')) {
                throw erro;
            }
        }
    }
    throw new Error('Todas as senhas padrão falharam (p2k2016, p2k20, 123456) ou o protocolo foi rejeitado.');
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1050, height: 750,
        webPreferences: {
            nodeIntegration: false, contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        autoHideMenuBar: true
    });
    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    setTimeout(() => { executarChecagemAtualizacao(true); }, 3000);
});

ipcMain.handle('rodar-comando', async (event, comando) => {
    return new Promise((resolve) => {
        exec(comando, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            resolve({ sucesso: !error, erro: stderr || (error ? error.message : null), resultado: stdout });
        });
    });
});

ipcMain.handle('salvar-arquivo-nativo', async (event, dados) => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Salvar Segunda Via', defaultPath: dados.nomeSugerido,
        filters: [{ name: 'Arquivo de Texto', extensions: ['txt'] }]
    });
    if (canceled || !filePath) return { cancelado: true };
    try {
        fs.writeFileSync(filePath, dados.conteudo, 'utf-8');
        return { sucesso: true, caminho: filePath };
    } catch (err) { return { sucesso: false, erro: err.message }; }
});

ipcMain.handle('autenticar-servidor', async (event, ip) => {
    for (const senha of SENHAS_SERVIDOR) {
        const sucesso = await new Promise((resolve) => {
            const conn = new Client();
            conn.on('ready', () => { conn.end(); resolve(true); }).on('error', () => { resolve(false); })
                .connect({
                    host: ip, port: 22, username: 'root', password: senha, readyTimeout: 8000,
                    algorithms: { serverHostKey: ['ssh-rsa', 'ssh-dss', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256'] }
                });
        });
        if (sucesso) { cacheSenhaServidor[ip] = senha; return { sucesso: true }; }
    }
    return { sucesso: false };
});

function tentarConexaoSSH(ip, username, senha, comando, isSilent = false, isPdv = false, elevatePass = null) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let saida = '', erroSaida = '', jaFinalizou = false, comandoEnviado = false;
        const win = BrowserWindow.getAllWindows()[0];

        const algos = isPdv ? {
            kex: [
                'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1',
                'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group-exchange-sha256',
                'curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256'
            ],
            cipher: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss', 'rsa-sha2-512', 'rsa-sha2-256'],
            hmac: ['hmac-sha1', 'hmac-sha1-96', 'hmac-md5', 'hmac-md5-96', 'hmac-sha2-256', 'hmac-sha2-512']
        } : {
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss', 'rsa-sha2-512', 'rsa-sha2-256']
        };

        const timeoutMs = isSilent ? 8000 : 25000;
        const timeout = setTimeout(() => {
            if (!jaFinalizou) {
                jaFinalizou = true; try { conn.end(); } catch (e) { }
                if (!isSilent && win) win.webContents.send('console-update', '\n[SISTEMA] Timeout.\n');
                reject(new Error('Timeout: Servidor demorou a responder.'));
            }
        }, timeoutMs);

        const isPowerCommand = /init 0|init 6|reboot|shutdown|poweroff/i.test(comando);
        if (!isSilent && win) win.webContents.send('console-update', `\n--- Conectando em ${ip} (${username}) ---\n[Comando]: ${comando}\n`);

        conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([senha]);
        });

        conn.on('ready', () => {
            const execOptions = elevatePass ? { pty: true } : {};
            conn.exec(comando, execOptions, (err, stream) => {
                if (err) {
                    if (!jaFinalizou) { jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { } reject(err); }
                    return;
                }
                comandoEnviado = true;
                try { if (!elevatePass) stream.write('\n'); } catch (e) { }
                stream.on('close', () => {
                    if (!jaFinalizou) {
                        jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { }
                        if (!isSilent && win) win.webContents.send('console-update', `\n[Encerrado]\n`);
                        let saidaLimpa = saida.replace(/Access granted\. Press Return to begin session\./gi, '').replace(/^\s*[\r\n]/gm, '').trim();
                        resolve(saidaLimpa || "Comando executado.");
                    }
                }).on('data', (d) => {
                    const out = d.toString();
                    saida += out;
                    if (!isSilent && win) win.webContents.send('console-update', out);
                    if (elevatePass && (out.toLowerCase().includes('senha') || out.toLowerCase().includes('password'))) {
                        try { stream.write(elevatePass + '\n'); } catch (e) { }
                        elevatePass = null;
                    }
                }).stderr.on('data', (d) => {
                    const out = d.toString();
                    erroSaida += out;
                    if (!isSilent && win) win.webContents.send('console-update', '\n[ERRO SCRIPT] ' + out);
                    if (elevatePass && (out.toLowerCase().includes('senha') || out.toLowerCase().includes('password'))) {
                        try { stream.write(elevatePass + '\n'); } catch (e) { }
                        elevatePass = null;
                    }
                });
            });
        }).on('error', (err) => {
            if (!jaFinalizou) {
                jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { }
                if (isPowerCommand && comandoEnviado) { resolve("Comando de energia enviado com sucesso."); }
                else {
                    if (!isSilent && win) win.webContents.send('console-update', `\n[FALHA DE CONEXÃO] ${err.message}\n`);
                    reject(err);
                }
            }
        }).connect({
            host: ip, port: 22, username: username, password: senha, tryKeyboard: true, readyTimeout: timeoutMs, algorithms: algos
        });
    });
}

ipcMain.handle('rodar-ssh', async (event, dados) => {
    try {
        if (dados.tipo === 'telefonia') {
            let tentativas = cacheCredencialTelefonia[dados.host]
                ? [cacheCredencialTelefonia[dados.host], ...CREDENCIAIS_TELEFONIA.filter(c => c.user !== cacheCredencialTelefonia[dados.host].user)]
                : CREDENCIAIS_TELEFONIA;

            let ultimosErros = [];

            for (const cred of tentativas) {
                try {
                    let cmdExec = dados.script;
                    let senhaRootParaElevacao = cred.elevatePass;

                    if (cred.user !== 'root') {
                        let cmdEscapado = dados.script.replace(/'/g, "'\\''");
                        cmdExec = `su - root -c '${cmdEscapado}'`;

                        if (!senhaRootParaElevacao && CREDENCIAIS_TELEFONIA[0] && CREDENCIAIS_TELEFONIA[0].user === 'root') {
                            senhaRootParaElevacao = CREDENCIAIS_TELEFONIA[0].pass;
                        }
                    }

                    const resposta = await tentarConexaoSSH(dados.host, cred.user, cred.pass, cmdExec, false, false, senhaRootParaElevacao);

                    cacheCredencialTelefonia[dados.host] = cred;
                    return { sucesso: true, resultado: resposta };

                } catch (err) {
                    ultimosErros.push(`[${cred.user}]: ${err.message}`);
                }
            }
            return { sucesso: false, erro: "Falha na Telefonia. Tentativas:\n" + ultimosErros.join('\n') };
        }

        let username = dados.user || 'root', senha = '', resposta = '';

        if (dados.tipo === 'pdv') {
            resposta = await rodarPdvNativo(dados.host, username, dados.script, false, dados.senha);
        } else {
            senha = cacheSenhaServidor[dados.host] || SENHAS_SERVIDOR[0];
            resposta = await tentarConexaoSSH(dados.host, username, senha, dados.script, false);
        }
        return { sucesso: true, resultado: resposta };

    } catch (error) {
        return { sucesso: false, erro: error.message };
    }
});

ipcMain.handle('configurar-pdv', async (event, { ip }) => {
    const win = BrowserWindow.getFocusedWindow();
    let senhaVencedoraNoHardware = "";

    while (true) {
        let checkRes = "";
        try {
            const checkScript = `
                if [ -L /dev/ttyS4 ]; then echo 'S4_OK'; else echo 'S4_ERRO'; fi
                if [ -L /dev/ttyS5 ]; then echo 'S5_OK'; else echo 'S5_ERRO'; fi
            `;
            checkRes = await rodarPdvNativo(ip, 'root', checkScript, true);
            senhaVencedoraNoHardware = cacheSenhaPDV[ip] || 'p2k2016';
        } catch (e) {
            checkRes = "";
            senhaVencedoraNoHardware = cacheSenhaPDV[ip] || 'p2k2016';
        }

        const temS4 = checkRes.includes('S4_OK');
        const temS5 = checkRes.includes('S5_OK');
        let mainMessage = "";

        if (checkRes === "") { mainMessage = `Erro de Conexão: PDV ${ip} offline ou Senhas Recusadas.`; }
        else if (temS4 && temS5) { mainMessage = `Validação concluída: O hardware do PDV ${ip} está pronto.`; }
        else { mainMessage = `Atenção: Periféricos ausentes no PDV ${ip}.`; }

        let detailMsg = `Resultado da leitura das portas seriais:\n\n • IMPRESSORA (ttyS4) : ${temS4 ? '[ OK ] CONECTADA' : '[ ERRO ] DESCONECTADA'}\n • PINPAD     (ttyS5) : ${temS5 ? '[ OK ] CONECTADO' : '[ ERRO ] DESCONECTADO'}\n\nO que você deseja fazer agora?`;

        const escolha = await dialog.showMessageBox(win, {
            type: (temS4 && temS5) ? 'info' : 'warning',
            buttons: ['Reconfigurar', 'Verificar Novamente', 'Cancelar'],
            defaultId: (temS4 && temS5) ? 0 : 1, cancelId: 2,
            title: 'Diagnóstico de Hardware - Lebes Automation',
            message: mainMessage, detail: detailMsg
        });

        if (escolha.response === 0) break;
        else if (escolha.response === 1) continue;
        else return { sucesso: false, erro: "Ação cancelada pelo utilizador." };
    }

    const scriptConfigPDV = `
sudo init 3
lsusb --verbose 2>/dev/null | grep -i elgin
ls -l /dev/ttyS4
cd /etc
[ -f ./rc.local ] && sh ./rc.local 2>/dev/null || true
ls -l /dev/ttyS4
cd /p2k/bin
chown -hR p2k /usr/p2k
chmod 777 -R /p2k
chown -hR p2k /usr/p2k/*
chmod 777 -R /usr/p2k/*
cd /p2k/bin
. ./setClassPathComponente.sh
. ./configPDV.sh
cd /p2k
printf '2\\n9\\n3\\n' | ./prepVersao.sh
sudo init 5
    `;

    try {
        const b64 = Buffer.from(scriptConfigPDV).toString('base64');
        const batPath = path.join(app.getPath('temp'), `reconfig_pdv_${ip.replace(/\./g, '_')}.bat`);
        const plinkPath = acharExecutavel('plink');

        const hostKeyArg = await obterHostKeyPlink(ip, 'root', plinkPath);

        const batContent = `@echo off
color 0A
title Reconfigurando PDV ${ip}
echo ==========================================
echo    RECONFIGURANDO PDV (${ip})
echo ==========================================
echo.
echo Senha Inteligente utilizada: ${senhaVencedoraNoHardware}
echo Executando script no PDV Linux...
echo.
echo. | "${plinkPath}" -ssh root@${ip} -pw "${senhaVencedoraNoHardware}"${hostKeyArg} "echo ${b64} | base64 -d | sh"
echo.
echo ==========================================
echo Processo Linux concluido!
echo Aguardando 8 segundos para a interface carregar (init 5)...
timeout /t 8 /nobreak > nul
start "" "${acharExecutavel('vnc')}" ${ip}
del "%~f0" & exit
`;
        fs.writeFileSync(batPath, batContent, 'utf-8');
        exec(`start "" "${batPath}"`);
        return { sucesso: true, resultado: "Enviado para a janela do CMD." };
    } catch (error) { return { sucesso: false, erro: error.message }; }
});

ipcMain.handle('abrir-ferramenta', async (event, { ferramenta, ip, tipo, caminho, autoVnc, usuario, senhaCustom }) => {
    let username = 'root', senha = '';

    // Terminal manual: abre sem credenciais (o usuário digita)
    if (tipo === 'manual') {
        if (ferramenta === 'putty') {
            exec(`start "" "${acharExecutavel('putty')}" -ssh ${ip}`);
            return { sucesso: true };
        }
        if (ferramenta === 'mobaxterm') {
            exec(`start "" "${acharExecutavel('mobaxterm')}" -newtab "read -p 'Usuario: ' usr ; ssh $usr@${ip}"`);
            return { sucesso: true };
        }
        return { sucesso: false };
    }

    if (tipo === 'custom') {
        username = usuario || 'root';
        senha = senhaCustom || '';
    } else if (tipo === 'pdv') {
        if (!cacheSenhaPDV[ip] && ferramenta !== 'vnc') {
            try {
                await rodarPdvNativo(ip, 'root', 'echo 1', true);
            } catch (e) {
                return { sucesso: false, erro: "Dispositivo offline ou senhas recusadas." };
            }
        }
        senha = cacheSenhaPDV[ip] || '';
    }
    else if (tipo === 'telefonia') {
        const cred = cacheCredencialTelefonia[ip] || CREDENCIAIS_TELEFONIA[0];
        username = cred.user; senha = cred.pass;
    } else {
        senha = cacheSenhaServidor[ip] || SENHAS_SERVIDOR[0];
    }

    let cmd = '';
    if (ferramenta === 'vnc') {
        const vncExe = acharExecutavel('vnc');
        
        let vncSenha = "";
        if (tipo === 'pdv') {
            vncSenha = 'k2p';
        } else if (tipo === 'admin') {
            vncSenha = 'Lebes123';
        } else {
            vncSenha = senha;
        }

        if (autoVnc && vncSenha) {
            const vbsPath = path.join(app.getPath('temp'), `vnc_auto_${ip.replace(/\./g, '_')}.vbs`);
            // Escapa caracteres especiais do SendKeys
            const vncSenhaSK = vncSenha.replace(/[+^%~(){}\[\]]/g, m => '{' + m + '}');
            // Espera a janela do viewer existir (até 20s), traz para frente pelo PID e só então digita
            const vbsScript = `
Set WshShell = WScript.CreateObject("WScript.Shell")
Set oExec = WshShell.Exec("""${vncExe}"" ${ip}")
ok = False
For i = 1 To 40
    WScript.Sleep 500
    If WshShell.AppActivate(oExec.ProcessID) Then
        ok = True
        Exit For
    End If
Next
If ok Then
    WScript.Sleep 1200
    WshShell.AppActivate oExec.ProcessID
    WScript.Sleep 200
    WshShell.SendKeys "${vncSenhaSK}"
    WScript.Sleep 200
    WshShell.SendKeys "{ENTER}"
End If
            `.trim();
            fs.writeFileSync(vbsPath, vbsScript, 'utf-8');
            cmd = `start "" wscript "${vbsPath}"`;
        } else {
            cmd = `start "" "${vncExe}" ${ip}`;
        }
    } else if (ferramenta === 'putty') {
        cmd = `start "" "${acharExecutavel('putty')}" -ssh ${username}@${ip} -pw "${senha}"`;
    } else if (ferramenta === 'winscp') {
        const pastaAlvo = caminho ? caminho : '/';
        cmd = `start "" "${acharExecutavel('winscp')}" sftp://${encodeURIComponent(username)}:${encodeURIComponent(senha)}@${ip}${pastaAlvo}`;
    } else if (ferramenta === 'log-pdv') {
        const plinkPath = acharExecutavel('plink');
        const hostKeyArg = await obterHostKeyPlink(ip, username, plinkPath);
        const batPath = path.join(app.getPath('temp'), `log_pdv_${ip.replace(/\./g, '_')}.bat`);
        const batContent = `@echo off\ntitle Log PDV ${ip}\ncolor 0A\necho Conectando ao log do PDV ${ip}...\necho.\n:: O "echo." injeta a tecla ENTER automaticamente\necho. | "${plinkPath}" -ssh ${username}@${ip} -pw "${senha}"${hostKeyArg} "cd /p2k/bin/log ; tail -F storex.log"\n`;
        fs.writeFileSync(batPath, batContent, 'utf-8');
        cmd = `start "" "${batPath}"`;
    } else if (ferramenta === 'browser') {
        cmd = `start http://${ip}`;
    } else if (ferramenta === 'mobaxterm') {
        clipboard.writeText(senha);
        const mobaPath = acharExecutavel('mobaxterm');
        cmd = `start "" "${mobaPath}" -newtab "ssh -legacy ${username}@${ip}"`;
    }

    if (cmd) { exec(cmd); return { sucesso: true }; }
    return { sucesso: false };
});

async function executarChecagemAtualizacao(modoSilencioso = false) {
    const caminhoRedeUpdate = CAMINHO_REDE_UPDATE;
    try {
        const arquivoJsonPath = path.join(caminhoRedeUpdate, 'version.json');
        if (!fs.existsSync(arquivoJsonPath)) return modoSilencioso ? null : { erro: `Arquivo version.json não encontrado na rede.` };
        const remoteVersion = JSON.parse(fs.readFileSync(arquivoJsonPath, 'utf-8')).version;
        const localVersion = app.getVersion();

        if (remoteVersion !== localVersion) {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return;
            const op = await dialog.showMessageBox(win, {
                type: 'info', buttons: ['Atualizar agora', 'Depois'],
                title: 'Nova versão disponível', message: `A versão ${remoteVersion} está disponível! O sistema será fechado para aplicar a atualização.`
            });
            if (op.response === 0) {
                const batRede = path.join(caminhoRedeUpdate, 'atualizar.bat');
                const batLocal = path.join(app.getPath('temp'), 'atualizar.bat');
                if (fs.existsSync(batRede)) { fs.copyFileSync(batRede, batLocal); exec(`start "" "${batLocal}"`); app.quit(); }
                else return modoSilencioso ? null : { erro: "Script atualizar.bat não encontrado." };
            }
            return { atualizado: false };
        } else return modoSilencioso ? null : { atualizado: true };
    } catch (e) { return modoSilencioso ? null : { erro: "Erro ao acessar rede: " + e.message }; }
}

ipcMain.handle('verificar-atualizacao', async () => { return await executarChecagemAtualizacao(false); });

// ---- versão: instalada x disponível na rede (tela Opções) ----
ipcMain.handle('obter-versao-local', () => ({ versaoLocal: app.getVersion() }));

// Lê o version.json da rede sem travar: se o compartilhamento não responder em 6s, desiste.
async function lerVersionJsonRede() {
    const arquivo = path.join(CAMINHO_REDE_UPDATE, 'version.json');
    const texto = await Promise.race([
        fs.promises.readFile(arquivo, 'utf-8'),
        new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('a rede não respondeu a tempo')), 6000))
    ]);
    return JSON.parse(texto);
}

// version.json aceito: { "version": "1.6.0", "date": "29/10/2026", "notes": ["item 1", "item 2"] }
// ("notes" também pode ser um texto com uma nota por linha)
ipcMain.handle('obter-info-versao', async () => {
    const versaoLocal = app.getVersion();
    try {
        const json = await lerVersionJsonRede();
        if (!json.version) throw new Error('o version.json não tem o campo "version"');

        const bruto = json.notes ?? json.notas ?? null;
        let notas = null;
        if (Array.isArray(bruto)) notas = bruto.map(n => String(n).trim()).filter(Boolean);
        else if (typeof bruto === 'string') notas = bruto.split(/\r?\n/).map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

        return { sucesso: true, versaoLocal, versaoRede: String(json.version), data: json.date || json.data || null, notas };
    } catch (e) {
        let erro = `Rede indisponível: ${e.message}`;
        if (e.code === 'ENOENT') erro = 'O arquivo version.json não foi encontrado na rede.';
        else if (e instanceof SyntaxError) erro = 'O version.json da rede está com formato inválido.';
        return { sucesso: false, versaoLocal, erro };
    }
});
ipcMain.handle('toggle-devtools', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.toggleDevTools(); return { sucesso: true }; });

function extrairDataBase(filename) {
    const match = filename.match(/ScLibera(\d{4})(\d{2})(\d{2})\.txt/i);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return "Data Inválida";
}

ipcMain.handle('obter-ultimo-base', async (event, ip) => {
    try {
        let senha = cacheSenhaServidor[ip] || SENHAS_SERVIDOR[0];
        const cmdBusca = `ls -t /usr/p2ksp/*/bin/logTrace/sc_libera/ScLibera*.txt 2>/dev/null | head -n 1`;
        const resultado = await tentarConexaoSSH(ip, 'root', senha, cmdBusca, true);
        const nomeArquivo = resultado.trim();
        if (nomeArquivo && nomeArquivo.includes('ScLibera')) return { sucesso: true, dataBase: extrairDataBase(nomeArquivo) };
        return { sucesso: false, erro: "Nenhum arquivo ScLibera encontrado." };
    } catch (e) { return { sucesso: false, erro: e.message }; }
});

ipcMain.handle('obter-ram-ao-vivo', async (event, ip) => {
    try {
        let senha = cacheSenhaServidor[ip] || SENHAS_SERVIDOR[0];
        const cmdRam = `free -m | awk '/^Mem:/{print $3","$2}'`;
        const resultado = await tentarConexaoSSH(ip, 'root', senha, cmdRam, true);
        const partes = resultado.trim().split(',');
        if (partes.length === 2) return { sucesso: true, usado: parseInt(partes[0]), total: parseInt(partes[1]) };
        return { sucesso: false };
    } catch (e) { return { sucesso: false }; }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });