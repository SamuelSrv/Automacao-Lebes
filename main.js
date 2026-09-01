const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

// --- CREDENCIAIS DO SISTEMA ---
const SENHAS_SERVIDOR = ['cln2015', 'l@(w#0&3j!'];
const SENHA_PDV = 'p2k2016';

// NOVO: Multi-credenciais para a Telefonia (com elevação de privilégio)
const CREDENCIAIS_TELEFONIA = [
    { user: 'root', pass: 'cln2015' },
    { user: 'infra-linux', pass: 'SU^p_h541W@g', elevatePass: 'cln2015' }
];

let cacheSenhaServidor = {};
let cacheCredencialTelefonia = {}; // Memoriza qual credencial funcionou em cada IP

function createWindow() {
    const win = new BrowserWindow({
        width: 1050, height: 750,
        webPreferences: {
            nodeIntegration: false, contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

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
        try {
            // Agora passamos o 'root' explicitamente para o motor SSH
            await tentarConexaoSSH(ip, 'root', senha, "echo 1", true);
            cacheSenhaServidor[ip] = senha;
            return { sucesso: true };
        } catch (err) { }
    }
    return { sucesso: false };
});

ipcMain.handle('rodar-ssh', async (event, dados) => {
    try {
        // --- MOTOR DE FALLBACK PARA TELEFONIA ---
        if (dados.tipo === 'telefonia') {
            // Se já sabemos qual funciona, tentamos ela primeiro
            let tentativas = CREDENCIAIS_TELEFONIA;
            if (cacheCredencialTelefonia[dados.host]) {
                tentativas = [
                    cacheCredencialTelefonia[dados.host],
                    ...CREDENCIAIS_TELEFONIA.filter(c => c.user !== cacheCredencialTelefonia[dados.host].user)
                ];
            }

            for (const cred of tentativas) {
                try {
                    let cmdExec = dados.script;
                    
                    // Se não for root, constrói a injeção de senha (tenta sudo, depois su)
                    if (cred.user !== 'root') {
                        let cmdEscapado = dados.script.replace(/'/g, "'\\''");
                        cmdExec = `echo '${cred.elevatePass}' | sudo -S bash -c '${cmdEscapado}' 2>/dev/null || echo '${cred.elevatePass}' | su - root -c '${cmdEscapado}'`;
                    }
                    
                    const resposta = await tentarConexaoSSH(dados.host, cred.user, cred.pass, cmdExec, false);
                    cacheCredencialTelefonia[dados.host] = cred; // Salva o vencedor no cache!
                    return { sucesso: true, resultado: resposta };
                } catch (err) {
                    // Ignora a falha e tenta o próximo usuário da lista
                }
            }
            return { sucesso: false, erro: "Nenhuma credencial funcionou na máquina de telefonia." };
        }

        // --- LÓGICA PADRÃO (SERVIDOR / PDV) ---
        let username = 'root';
        let senha = dados.tipo === 'pdv' ? SENHA_PDV : cacheSenhaServidor[dados.host];
        if (!senha && dados.tipo === 'servidor') senha = SENHAS_SERVIDOR[0];

        const resposta = await tentarConexaoSSH(dados.host, username, senha, dados.script, false);
        return { sucesso: true, resultado: resposta };

    } catch (error) {
        return { sucesso: false, erro: error.message };
    }
});

// MOTOR COM TRANSMISSÃO EM TEMPO REAL (Agora aceita Username dinâmico)
function tentarConexaoSSH(ip, username, senha, comando, isSilent = false) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let saida = '', erroSaida = '', jaFinalizou = false;

        const win = BrowserWindow.getAllWindows()[0];

        const timeout = setTimeout(() => {
            if (!jaFinalizou) {
                jaFinalizou = true; try { conn.end(); } catch (e) { }
                if (!isSilent && win) win.webContents.send('console-update', '\n[SISTEMA] Timeout: Servidor demorou a responder.\n');
                reject(new Error('Timeout: Servidor demorou a responder.'));
            }
        }, 120000);

        if (!isSilent && win) win.webContents.send('console-update', `\n--- Conectando em ${ip} (${username}) ---\n[Comando]: ${comando}\n`);

        conn.on('ready', () => {
            conn.exec(comando, (err, stream) => {
                if (err) {
                    if (!jaFinalizou) { jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { } reject(err); }
                    return;
                }
                stream.on('close', (code) => {
                    if (!jaFinalizou) {
                        jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { }
                        if (!isSilent && win) win.webContents.send('console-update', `\n[Encerrado com código: ${code}]\n`);
                        if (code === 0 || code == null) resolve(saida || "Comando executado.");
                        else reject(new Error(erroSaida || `Erro código ${code}`));
                    }
                }).on('data', (d) => {
                    saida += d.toString();
                    if (!isSilent && win) win.webContents.send('console-update', d.toString());
                }).stderr.on('data', (d) => {
                    erroSaida += d.toString();
                    if (!isSilent && win) win.webContents.send('console-update', '[ERRO] ' + d.toString());
                });
            });
        }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([senha]);
        }).on('error', (err) => {
            if (!jaFinalizou) { jaFinalizou = true; clearTimeout(timeout); try { conn.end(); } catch (e) { } reject(err); }
        }).connect({
            host: ip, port: 22, username: username, password: senha, tryKeyboard: true, readyTimeout: 10000
        });
    });
}

// --- LANÇADOR DE FERRAMENTAS ---
ipcMain.handle('abrir-ferramenta', async (event, { ferramenta, ip, tipo }) => {
    let username = 'root';
    let senha = '';

    // Define qual credencial a ferramenta deve usar baseada na categoria
    if (tipo === 'pdv') {
        senha = SENHA_PDV;
    } else if (tipo === 'telefonia') {
        const cred = cacheCredencialTelefonia[ip] || CREDENCIAIS_TELEFONIA[0];
        username = cred.user;
        senha = cred.pass;
    } else {
        senha = cacheSenhaServidor[ip] || SENHAS_SERVIDOR[0];
    }

    let cmd = '';

    if (ferramenta === 'vnc') {
        cmd = `start "" "C:\\Program Files\\uvnc bvba\\UltraVNC\\vncviewer.exe" ${ip}`;
    } else if (ferramenta === 'putty') {
        cmd = `start "" "C:\\Program Files\\PuTTY\\putty.exe" -ssh ${username}@${ip} -pw "${senha}"`;
    } else if (ferramenta === 'winscp') {
        cmd = `start "" "C:\\Program Files (x86)\\WinSCP\\WinSCP.exe" sftp://${username}:${senha}@${ip}/`;
    } else if (ferramenta === 'log-pdv') {
        const comandoPlink = `"C:\\Program Files\\PuTTY\\plink.exe" -ssh ${username}@${ip} -pw "${senha}" "cd /p2k/bin/log ; tail -F storex.log"`;
        cmd = `start "Log PDV ${ip}" cmd.exe /k "echo y | ${comandoPlink}"`;
    } else if (ferramenta === 'browser') {
        cmd = `start http://${ip}`;
    } else if (ferramenta === 'mobaxterm') {
        clipboard.writeText(senha);
        cmd = `start "" "C:\\Program Files (x86)\\Mobatek\\MobaXterm\\MobaXterm.exe" -newtab "ssh -legacy ${username}@${ip}"`;
    }

    if (cmd) {
        exec(cmd);
        return { sucesso: true };
    }

    return { sucesso: false };
});

// --- UPDATE ---
ipcMain.handle('verificar-atualizacao', async () => {
    const caminhoRedeUpdate = 'S:\\TI\\INFORMAÇÕES DE USO INTERNO\\SERVICE DESK\\Diversos\\Automacao\\LebesAutomation\\Atualizacoes\\';
    const pastaInstalacao = process.cwd();

    try {
        const arquivoJsonPath = path.join(caminhoRedeUpdate, 'version.json');
        if (!fs.existsSync(arquivoJsonPath)) return { erro: `Arquivo version.json não encontrado na rede.` };

        const remoteVersion = JSON.parse(fs.readFileSync(arquivoJsonPath, 'utf-8')).version;

        const localVersion = "1.0";

        if (remoteVersion !== localVersion) {
            const win = BrowserWindow.getFocusedWindow();
            const op = await dialog.showMessageBox(win, {
                type: 'info', buttons: ['Atualizar agora', 'Cancelar'],
                title: 'Nova versão disponível', message: `A versão ${remoteVersion} está disponível. O sistema será fechado para instalar a atualização.`
            });

            if (op.response === 0) {
                const batRede = path.join(caminhoRedeUpdate, 'atualizar.bat');
                const batLocal = path.join(pastaInstalacao, 'atualizar.bat');
                if (fs.existsSync(batRede)) {
                    fs.copyFileSync(batRede, batLocal);
                    exec(`start "" "${batLocal}"`);
                    app.quit();
                } else return { erro: "Script atualizar.bat não encontrado." };
            }
            return { atualizado: false };
        } else return { atualizado: true };
    } catch (e) { return { erro: "Erro ao acessar rede: " + e.message }; }
});

ipcMain.handle('toggle-devtools', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.toggleDevTools();
    return { sucesso: true };
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });