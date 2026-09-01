let ipServidorBase = "", redeBase = "", filialAtual = "", filaDesligamentos = [];
let acaoPendentePDV = "";
let ultimoArquivoNSUName = "";
const dominio = ".lebes.com.br";

// --- FUNÇÕES DE INTERFACE ---
function mudarAba(nome, el) {
    document.querySelectorAll('.tab-content').forEach(a => a.style.display = 'none');
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`aba-${nome}`).style.display = 'block';
    el.classList.add('active');
}

function showToast(mensagem, tipo = "success") {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerText = mensagem;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "fadeOut 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function mostrarLoading(t) {
    document.getElementById('modalTitulo').innerText = t;
    document.getElementById('modalLoading').style.display = 'flex';
}

function fecharModais() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
}

function setStatusOffline(motivo = "Offline") {
    fecharModais();
    showToast(`Falha: ${motivo}`, "error");
    document.getElementById('valNomeFilial').innerHTML = "Indisponível";
    document.getElementById('valServidor').innerHTML = '--- <span style="color:#ef4444; font-size:10px;">●</span>';
    document.getElementById('valInternet').innerHTML = '--- <span style="color:#ef4444; font-size:10px;">●</span>';
    document.getElementById('valStatusGeral').innerHTML = `${motivo}`;
    document.getElementById('valStatusGeral').style.color = "#ef4444";
    document.getElementById('painelFerramentas').classList.remove('active');
}

// --- CONEXÃO E AUTENTICAÇÃO ---
async function conectarFilial() {
    filialAtual = document.getElementById('inputFilial').value.trim();
    if (!filialAtual) { showToast("Informe a filial.", "error"); return; }

    mostrarLoading("Consultando Filial...");
    document.getElementById('painelFerramentas').classList.remove('active');

    const resDns = await window.sistema.rodarComando(`nslookup filial${filialAtual}${dominio}`);
    const out = resDns.resultado.toLowerCase();

    if (out.includes("can't find") || out.includes("não é possível") || out.includes("nxdomain")) return setStatusOffline("Filial não encontrada (DNS)");

    const match = resDns.resultado.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
    if (!match || match.length === 0) return setStatusOffline("Erro de Resolução");

    ipServidorBase = match[match.length - 1];
    if (ipServidorBase === "8.8.8.8" || ipServidorBase.startsWith("127.")) return setStatusOffline("Sem VPN / Interceptado");

    redeBase = ipServidorBase.substring(0, ipServidorBase.lastIndexOf('.'));
    const ipInternet = redeBase + ".1";

    const srvRes = await window.sistema.rodarComando(`ping -n 1 -w 1000 ${ipServidorBase}`);
    const intRes = await window.sistema.rodarComando(`ping -n 1 -w 1000 ${ipInternet}`);

    const srvOnline = srvRes.resultado.toUpperCase().includes("TTL=");
    const intOnline = intRes.resultado.toUpperCase().includes("TTL=");

    document.getElementById('valNomeFilial').innerHTML = `Filial ${filialAtual}`;

    document.getElementById('valServidor').innerHTML = srvOnline
        ? `${ipServidorBase} <span style="color:#10b981; font-size:12px; margin-left:4px;">●</span>`
        : `${ipServidorBase} <span style="color:#ef4444; font-size:12px; margin-left:4px;">●</span>`;

    document.getElementById('valInternet').innerHTML = intOnline
        ? `${ipInternet} <span style="color:#10b981; font-size:12px; margin-left:4px;">●</span>`
        : `${ipInternet} <span style="color:#ef4444; font-size:12px; margin-left:4px;">●</span>`;

    if (!srvOnline) {
        document.getElementById('valStatusGeral').innerHTML = "Servidor Offline";
        document.getElementById('valStatusGeral').style.color = "#ef4444";
        showToast("Ferramentas bloqueadas. Servidor inoperante.", "error");
        fecharModais();
        return;
    }

    mostrarLoading("Autenticando no Servidor...");
    const auth = await window.sistema.autenticarServidor(ipServidorBase);

    if (auth.sucesso) {
        if (intOnline) {
            document.getElementById('valStatusGeral').innerHTML = "Operacional";
            document.getElementById('valStatusGeral').style.color = "#10b981";
        } else {
            document.getElementById('valStatusGeral').innerHTML = "Gateway Inativo";
            document.getElementById('valStatusGeral').style.color = "#f59e0b";
        }
        document.getElementById('painelFerramentas').classList.add('active');
        showToast("Conectado e Autenticado!");
    } else {
        setStatusOffline("Falha de Senha (SSH)");
        showToast("Nenhuma senha padrão funcionou neste servidor.", "error");
    }

    fecharModais();
}

// --- SERVIDOR: FERRAMENTAS ---
async function executarServidor(comandoBash, msgLoad, msgSucesso) {
    if (!ipServidorBase) { showToast("Erro: IP da filial vazio. Conecte novamente.", "error"); return; }
    mostrarLoading(msgLoad);
    try {
        const res = await window.sistema.rodarSSH({ host: ipServidorBase, script: comandoBash, tipo: 'servidor' });
        if (res.sucesso) { showToast(msgSucesso); } else { showToast(`Erro: ${res.erro || 'Falha na execução'}`, "error"); }
    } catch (e) {
        showToast("Erro crítico de comunicação.", "error");
    } finally {
        fecharModais();
    }
}

function reiniciarAgente() {
    const comandoBash = `pkill -9 -f "[a]gente.php" || true ; pkill -9 -f "[a]gente.sh" || true ; sleep 1 ; cd /usr/admcom/agente ; chmod -R 755 . ; nohup sh -c 'echo "" | ./start-ag"e"nte.sh' > /dev/null 2>&1 & sleep 2 ; echo "\\n--- PROCESSOS ATIVOS NA MEMORIA ---" ; ps aux | grep "[a]gente" | grep -v grep`.replace(/\n/g, '');
    executarServidor(comandoBash, "Reiniciando Agente...", "Agente reiniciado! Verifique o Console.");
}
function reiniciarBasesPV() {
    const comandoBash = `cd /usr/admcom/bases ; ./desativa ; rm -f *.lk ; nohup ./ativa > /dev/null 2>&1 & sleep 2 ; echo "\\n--- ATIVACAO ENVIADA PARA O BACKGROUND ---"`.replace(/\n/g, '');
    executarServidor(comandoBash, "Reiniciando Bases...", "Bases PV reiniciadas! Verifique o Console.");
}
function reiniciarResgateComFTP() { executarServidor(`service p2k-sp stop || true ; service vsftpd stop || true ; sleep 2 ; service p2k-sp start ; service vsftpd start`, "Reiniciando Serviços...", "Resgate e FTP reiniciados!"); }
function abrirPuttyServidor() { window.sistema.abrirFerramenta({ ferramenta: 'putty', ip: ipServidorBase, tipo: 'servidor' }); }
function abrirMobaServidor() { if (!ipServidorBase) return showToast("Conecte na filial primeiro.", "error"); window.sistema.abrirFerramenta({ ferramenta: 'mobaxterm', ip: ipServidorBase, tipo: 'servidor' }); }
function abrirWinSCPServidor() { window.sistema.abrirFerramenta({ ferramenta: 'winscp', ip: ipServidorBase, tipo: 'servidor' }); }


// --- RECONFIGURAR PDV ---
function reconfigurarPDVPorIP(ip, pdv) {
    fecharModais();
    showToast(`Processo iniciado no PDV ${pdv}! Acompanhe a tela preta.`);

    const cmdLinux = "cd /p2k/bin ; chown -hR p2k /usr/p2k/* ; chmod 777 -R /usr/p2k/* ; init 3 ; . setClassPathComponente.sh ; . configPDV.sh ; init 5";
    const cmdWindows = `start "Reconfigurando PDV ${pdv}" cmd.exe /c "color 0A & echo ========================================== & echo    RECONFIGURANDO PDV ${pdv} (${ip}) & echo ========================================== & echo. & echo Acompanhe a execucao passo a passo... & echo. & echo y | "C:\\Program Files\\PuTTY\\plink.exe" -ssh root@${ip} -pw p2k2016 "${cmdLinux}" & echo. & echo ========================================== & echo Processo Linux concluido! & echo Aguardando 8 segundos para a interface carregar (init 5)... & timeout /t 8 /nobreak > nul & cd "C:\\Program Files\\uvnc bvba\\UltraVNC" & start vncviewer.exe ${ip}"`;

    window.sistema.rodarComando(cmdWindows);
}

// --- PDV: FERRAMENTAS ---
function abrirModalPDV(acao) {
    if (!redeBase) { showToast("Conecte na filial primeiro.", "error"); return; }
    acaoPendentePDV = acao;
    document.getElementById('inputPdvModal').value = '';
    document.getElementById('modalInputPDV').style.display = 'flex';
    document.getElementById('inputPdvModal').focus();
}

async function confirmarAcaoPDV() {
    const pdv = document.getElementById('inputPdvModal').value;
    if (!pdv) return;
    document.getElementById('modalInputPDV').style.display = 'none';

    const ip = `${redeBase}.1${pdv}`;
    const acao = acaoPendentePDV;

    if (acao === 'vnc') { window.sistema.abrirFerramenta({ ferramenta: 'vnc', ip: ip, tipo: 'pdv' }); fecharModais(); }
    else if (acao === 'putty') { window.sistema.abrirFerramenta({ ferramenta: 'putty', ip: ip, tipo: 'pdv' }); fecharModais(); }
    else if (acao === 'mobaxterm') { window.sistema.abrirFerramenta({ ferramenta: 'mobaxterm', ip: ip, tipo: 'pdv' }); fecharModais(); }
    else if (acao === 'winscp') { window.sistema.abrirFerramenta({ ferramenta: 'winscp', ip: ip, tipo: 'pdv' }); fecharModais(); }
    else if (acao === 'log') { window.sistema.abrirFerramenta({ ferramenta: 'log-pdv', ip: ip, tipo: 'pdv' }); fecharModais(); }
    else if (acao === 'reconfig') { reconfigurarPDVPorIP(ip, pdv); }
    else if (acao === 'hora') { prepararModalHora(ip, pdv); }
}

// --- AJUSTE DE HORA NO PDV ---
let ipPDVAtualParaHora = "";
async function prepararModalHora(ip, pdvNum) {
    ipPDVAtualParaHora = ip;
    mostrarLoading("Consultando hora no PDV...");
    try {
        const resPDV = await window.sistema.rodarSSH({ host: ip, script: "date '+%d/%m/%Y %H:%M:%S'", tipo: 'pdv' });
        const horaPC = new Date().toLocaleString('pt-BR');
        document.getElementById('modalLoading').style.display = 'none';

        if (resPDV.sucesso && resPDV.resultado.trim() !== "") {
            document.getElementById('horaPDVDisplay').innerText = resPDV.resultado.trim();
            document.getElementById('horaPCDisplay').innerText = horaPC;
            document.getElementById('modalAjusteHora').style.display = 'flex';
        } else {
            showToast("Não foi possível ler a hora do PDV.", "error");
        }
    } catch (e) { fecharModais(); showToast("Erro ao ler hora.", "error"); }
}

async function executarSincronizacaoHora() {
    document.getElementById('modalAjusteHora').style.display = 'none';
    mostrarLoading("Sincronizando Relógio...");
    try {
        const d = await window.sistema.rodarComando("powershell -Command \"Get-Date -Format 'MMddHHmmyyyy'\"");
        const res = await window.sistema.rodarSSH({ host: ipPDVAtualParaHora, script: `date ${d.resultado.trim()} ; sudo hwclock --systohc`, tipo: 'pdv' });
        if (res.sucesso) showToast("Relógio sincronizado com sucesso!");
        else showToast("Erro ao sincronizar relógio.", "error");
    } catch (e) { showToast("Falha na sincronização.", "error"); } finally { fecharModais(); }
}

// --- SEGUNDA VIA NSU ---
function abrirModalNSU() {
    if (!redeBase) { showToast("Conecte na filial primeiro.", "error"); return; }
    document.getElementById('nsuData').value = '';
    document.getElementById('nsuPdv').value = '';
    document.getElementById('nsuNumero').value = '';
    document.getElementById('modalInputNSU').style.display = 'flex';
    document.getElementById('nsuData').focus();
}

async function processarExtrairNSU() {
    const d = document.getElementById('nsuData').value.trim();
    const pdv = document.getElementById('nsuPdv').value.trim();
    const nsu = document.getElementById('nsuNumero').value.trim();

    if (!d || !pdv || !nsu) { showToast("Preencha todos os campos.", "error"); return; }
    const dLimpa = d.replace(/\D/g, "");
    if (dLimpa.length !== 8) { showToast("A data precisa ter 8 dígitos (DDMMAAAA)", "error"); return; }

    const dia = dLimpa.slice(0, 2), mes = dLimpa.slice(2, 4), ano = dLimpa.slice(4, 8);
    const ipPdv = `${redeBase}.1${pdv}`;

    document.getElementById('modalInputNSU').style.display = 'none';
    mostrarLoading("Extraindo do PDV...");
    const nsuSanitizado = nsu.replace(/[^0-9]/g, '');

    const scriptBash = `
        F=$(ls /usr/p2k/bin/MFDE/MFDE*${ano}${mes}${dia}* 2>/dev/null | head -n 1)
        if [ -f "$F" ]; then
            if [ "\${F##*.}" = "zip" ]; then unzip -p "$F"; else cat "$F"; fi | awk -v n='${nsuSanitizado}' -v r='NSU(:|[[:space:]])[[:space:]]*0*' -v e='([^0-9]|$)' '{b=b $0 "\\r\\n"; if($0 ~ /^--+/ && p_line ~ /STOREX/){p=r n e; if(b ~ p) { sub(/^[^\\n]*\\n/, "", b); print b }; b=""}; p_line=$0} END{p=r n e; if(b ~ p && b != "") { sub(/^[^\\n]*\\n/, "", b); print b } }'
        fi
    `;

    try {
        const res = await window.sistema.rodarSSH({ host: ipPdv, script: scriptBash, tipo: 'pdv' });
        const textoExtraido = res.resultado ? res.resultado.trim() : "";
        document.getElementById('modalLoading').style.display = 'none';

        if (res.sucesso && textoExtraido !== "" && !textoExtraido.toLowerCase().includes("not found")) {
            ultimoArquivoNSUName = `SegundaVia_NSU${nsuSanitizado}_Filial${filialAtual}_PDV${pdv}.txt`;
            document.getElementById('previewNSU').value = textoExtraido;
            document.getElementById('modalResultadoNSU').style.display = 'flex';
        } else {
            document.getElementById('modalInputNSU').style.display = 'flex';
            showToast("Nota não encontrada na MFDE do PDV.", "error");
        }
    } catch (e) { fecharModais(); showToast("Erro ao extrair NSU.", "error"); }
}

async function salvarArquivoNSU() {
    const textoExtraido = document.getElementById('previewNSU').value;
    if (!textoExtraido) { showToast("Nada para salvar.", "error"); return; }
    const res = await window.sistema.salvarArquivoNativo({ nomeSugerido: ultimoArquivoNSUName || "SegundaVia.txt", conteudo: textoExtraido });
    fecharModais();
    if (res.cancelado) showToast("Salvamento cancelado.", "warning");
    else if (res.sucesso) { showToast("Arquivo salvo com sucesso!"); }
    else showToast(`Falha ao salvar: ${res.erro}`, "error");
}


// --- FILA DE DESLIGAMENTOS ---
function adicionarFilaDesligamento() {
    const f = document.getElementById('desligFilial').value.trim();
    const s = document.getElementById('desligSispe').value.trim();
    if (!f || !s) { showToast("Preencha a Filial e o SISPE.", "error"); return; }
    filaDesligamentos.push({ filial: f, sispe: s });
    document.getElementById('desligFilial').value = '';
    document.getElementById('desligSispe').value = '';
    document.getElementById('desligFilial').focus();
    atualizarTabelaFila();
}

function removerItemFila(idx) { filaDesligamentos.splice(idx, 1); atualizarTabelaFila(); }

function atualizarTabelaFila() {
    const tbody = document.getElementById('tabelaFilaDesligamento');
    if (filaDesligamentos.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Fila vazia</td></tr>'; return; }
    tbody.innerHTML = filaDesligamentos.map((i, idx) => `<tr><td style="color:#38bdf8; font-weight:bold;">Filial ${i.filial}</td><td style="font-family:monospace;">${i.sispe}</td><td style="text-align:right;"><button onclick="removerItemFila(${idx})" style="background:#ef4444; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Remover</button></td></tr>`).join('');
}

async function iniciarDesligamentoLote() {
    if (filaDesligamentos.length === 0) { showToast("A fila está vazia.", "warning"); return; }
    mostrarLoading("Processando Desligamentos...");
    let sucessos = 0;
    try {
        for (let item of filaDesligamentos) {
            const res = await window.sistema.rodarSSH({ host: `filial${item.filial}`, script: `echo '${item.sispe}' | /srv/scripts/alterafunc.sh || true`, tipo: 'servidor' });
            if (res.sucesso) sucessos++;
        }
    } catch (e) { console.error(e); } finally { fecharModais(); }
    filaDesligamentos = [];
    atualizarTabelaFila();
    if (sucessos > 0) showToast(`${sucessos} processado(s) com sucesso!`);
    else showToast("Falha ao processar os desligamentos.", "error");
}


// --- SCANNER DE DISPOSITIVOS INTELIGENTE ---
async function abrirMapaRede() {
    if (!redeBase || !ipServidorBase) { showToast("Conecte na filial primeiro.", "error"); return; }
    mostrarLoading("Carregando Equipamentos...");

    const scriptScanner = `
        REDE="${redeBase}"
        FILE=""
        if [ -f /etc/dhcp/dhcpd.conf ]; then FILE="/etc/dhcp/dhcpd.conf"; 
        elif [ -f /etc/ltsp/dhcpd.conf ]; then FILE="/etc/ltsp/dhcpd.conf"; fi

        > /tmp/scan_dhcp.txt
        if [ -n "$FILE" ]; then
            cat "$FILE" | tr -d '\\r' | awk '
                BEGIN { h="Desconhecido"; m="Desconhecido"; i="Desconhecido" }
                { gsub(/[{};]/, " ") }
                $1 == "host" { if(i != "Desconhecido") print i "|" m "|" h; h=$2; m="Desconhecido"; i="Desconhecido" }
                $1 == "hardware" && $2 == "ethernet" { m=$3 }
                $1 == "fixed-address" { i=$2 }
                END { if(i != "Desconhecido") print i "|" m "|" h }
            ' > /tmp/scan_dhcp.txt
        fi

        > /tmp/scan_ips.txt
        cat /tmp/scan_dhcp.txt | cut -d'|' -f1 >> /tmp/scan_ips.txt
        for i in $(seq 101 250); do echo "$REDE.$i" >> /tmp/scan_ips.txt; done
        sort -u /tmp/scan_ips.txt > /tmp/scan_ips_unique.txt

        > /tmp/scan_online.txt
        while read ip; do
            ( if ping -c 1 -W 1 $ip >/dev/null 2>&1; then echo "$ip" >> /tmp/scan_online.txt; fi ) &
        done < /tmp/scan_ips_unique.txt
        wait

        arp -n > /tmp/scan_arp.txt

        while read ip; do
            dhcp_line=$(grep "^$ip|" /tmp/scan_dhcp.txt | head -n 1)
            is_online=$(grep "^$ip$" /tmp/scan_online.txt)
            
            if [ -n "$is_online" ]; then
                mac=$(grep "^$ip " /tmp/scan_arp.txt | grep -i -o -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | head -n 1)
                if [ -z "$mac" ] && [ -n "$dhcp_line" ]; then
                    mac=$(echo "$dhcp_line" | cut -d'|' -f2)
                elif [ -z "$mac" ]; then
                    mac="Desconhecido"
                fi
                
                host="Desconhecido"
                [ -n "$dhcp_line" ] && host=$(echo "$dhcp_line" | cut -d'|' -f3)
                
                echo "$ip|$mac|$host|ONLINE"
                
            elif [ -n "$dhcp_line" ]; then
                mac=$(echo "$dhcp_line" | cut -d'|' -f2)
                host=$(echo "$dhcp_line" | cut -d'|' -f3)
                echo "$ip|$mac|$host|OFFLINE"
            fi
        done < /tmp/scan_ips_unique.txt

        rm -f /tmp/scan_dhcp.txt /tmp/scan_ips.txt /tmp/scan_ips_unique.txt /tmp/scan_online.txt /tmp/scan_arp.txt
    `;

    try {
        const res = await window.sistema.rodarSSH({ host: ipServidorBase, script: scriptScanner, tipo: 'servidor' });
        fecharModais();

        if (res.sucesso) {
            let devices = res.resultado.split('\n')
                .map(l => l.trim()).filter(l => l.includes('|'))
                .map(l => {
                    const p = l.split('|');
                    return { ip: p[0], mac: p[1], host: p[2], status: p[3] };
                });

            devices.sort((a, b) => parseInt(a.ip.split('.').pop()) - parseInt(b.ip.split('.').pop()));
            devices.unshift({ ip: ipServidorBase, mac: "Lendo Hardware...", host: `filial${filialAtual}`, status: "ONLINE", isServer: true });
            document.getElementById('mapaFilialNum').innerText = filialAtual;
            montarMapaRede(devices);
        } else {
            showToast("Falha ao mapear rede.", "error");
        }
    } catch (e) { fecharModais(); showToast("Erro no scanner.", "error"); }
}

function montarMapaRede(devices) {
    const servidores = [], pdvs = [], pvs = [], caixasAdm = [], telefonia = [], impressoras = [], outros = [];

    devices.forEach(dev => {
        if (dev.isServer) { servidores.push({ ...dev, nome: `Servidor`, tipo_acao: 'servidor', num: '' }); return; }
        const oct = parseInt(dev.ip.split('.').pop());
        let num_pdv = oct > 100 ? oct - 100 : oct;

        if (oct === 250 || dev.host.toLowerCase().includes("impressora") || dev.host.toLowerCase().includes("scanner")) { impressoras.push({ ...dev, nome: dev.host, tipo_acao: 'impressora', num: '' }); }
        else if (oct >= 101 && oct <= 109 || dev.host.toLowerCase().includes("ws00")) { caixasAdm.push({ ...dev, nome: `Caixa ADM ${num_pdv}`, tipo_acao: 'admin', num: num_pdv }); }
        else if (oct >= 110 && oct <= 129 || dev.host.toLowerCase().includes("pv0")) { pvs.push({ ...dev, nome: `Pré-Venda ${num_pdv}`, tipo_acao: 'pv', num: num_pdv }); }
        else if (oct >= 130 && oct <= 139 || dev.host.toLowerCase().includes("pdv")) { pdvs.push({ ...dev, nome: `PDV ${num_pdv}`, tipo_acao: 'pdv', num: num_pdv }); }
        else if (oct >= 200 && oct <= 205 || dev.host.toLowerCase().includes("telefonia")) { telefonia.push({ ...dev, nome: dev.host, tipo_acao: 'telefonia', num: '' }); }
        else { outros.push({ ...dev, nome: dev.host, tipo_acao: 'outros', num: num_pdv }); }
    });

    const renderGroup = (titulo, lista) => {
        if (lista.length === 0) return '';
        return `
        <div class="network-group" style="margin-bottom: 25px;">
            <h4 style="margin-bottom: 10px; color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 5px; text-align: left;">${titulo}</h4>
            <div class="device-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
                ${lista.map(dev => `
                    <div class="device-card" style="cursor: pointer; padding: 15px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; transition: 0.2s; text-align: center;" 
                         onclick="abrirDetalhesDispositivo('${dev.ip}', '${dev.mac}', '${dev.host}', '${dev.nome}', '${dev.status}', '${dev.tipo_acao}', '${dev.num}')" 
                         onmouseover="this.style.borderColor='#38bdf8'; this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='#334155'; this.style.transform='none'">
                        <div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <strong style="color: #f8fafc; font-size: 14px; font-weight: 600;">${dev.nome}</strong>
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dev.status === 'ONLINE' ? '#10b981' : '#ef4444'}; box-shadow: 0 0 4px ${dev.status === 'ONLINE' ? '#10b981' : '#ef4444'}; flex-shrink: 0;"></span>
                        </div>
                        <div style="color: #94a3b8; font-size: 13px; font-family: monospace;">${dev.ip}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    };

    let htmlMapa = renderGroup('Servidor', servidores) + renderGroup('PDVs', pdvs) + renderGroup('Pré-Vendas', pvs) + renderGroup('Caixas ADM', caixasAdm) + renderGroup('Telefonia', telefonia) + renderGroup('Impressoras / Scanner', impressoras) + renderGroup('Outros', outros);
    document.getElementById('mapaContainer').innerHTML = htmlMapa || '<p style="text-align: center; margin-top: 30px;">Nenhum dispositivo mapeado.</p>';
    document.getElementById('modalMapaRede').style.display = 'flex';
}

function abrirTerminalManual(ferramenta, ip) {
    if (ferramenta === 'putty') {
        window.sistema.rodarComando(`start "" "C:\\Program Files\\PuTTY\\putty.exe" -ssh ${ip}`);
    } else if (ferramenta === 'mobaxterm') {
        window.sistema.rodarComando(`start "" "C:\\Program Files (x86)\\Mobatek\\MobaXterm\\MobaXterm.exe" -newtab "ssh ${ip}"`);
    }
}

// CORREÇÃO: Função transformada em Assíncrona para permitir o teste prévio (Loading)
async function abrirDetalhesDispositivo(ip, mac, host, nome, status, tipo_acao, num_pdv) {
    
    // --- NOVO PASSO: Pré-autenticação igual ao Servidor ---
    if (status === 'ONLINE' && tipo_acao === 'telefonia') {
        mostrarLoading(`Autenticando ${nome}...`);
        // Dispara o motor de tentativa e erro do main.js para descobrir e salvar a senha correta
        await window.sistema.rodarSSH({ host: ip, script: "echo 1", tipo: 'telefonia' });
        fecharModais();
    }

    document.getElementById('detNome').innerText = nome;
    document.getElementById('detStatusBadge').innerText = status;
    document.getElementById('detStatusBadge').style.backgroundColor = status === 'ONLINE' ? '#10b981' : '#ef4444';

    document.getElementById('detHost').innerText = host || "Desconhecido";
    document.getElementById('detIP').innerText = ip;
    document.getElementById('detMAC').innerText = mac || "Desconhecido";
    document.getElementById('detOS').innerText = "Carregando...";
    document.getElementById('detRAM').innerText = "Carregando...";
    document.getElementById('detDisco').innerText = "Carregando...";

    let htmlBotoes = '';

    if (status === 'ONLINE') {
        const btnStyle = "flex: 1 1 calc(33% - 10px); padding: 8px 12px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; font-weight: 600; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;";

        // NOVO: Define dinamicamente o motor de senha correto ('pdv', 'servidor' ou 'telefonia')
        const toolTipo = (tipo_acao === 'servidor' || tipo_acao === 'telefonia') ? tipo_acao : 'pdv';

        // Botões Automáticos - Agora são universais e injetam senha baseada no toolTipo!
        const btnVncAuto = `<button class="btn-action" style="${btnStyle} background: #0284c7; color: white;" onclick="window.sistema.abrirFerramenta({ferramenta:'vnc', ip:'${ip}', tipo:'${toolTipo}'})">VNC</button>`;
        const btnPuttyAuto = `<button class="btn-action" style="${btnStyle} background: #2563eb; color: white;" onclick="window.sistema.abrirFerramenta({ferramenta:'putty', ip:'${ip}', tipo:'${toolTipo}'})">PuTTY</button>`;
        const btnMobaAuto = `<button class="btn-action" style="${btnStyle} background: #4f46e5; color: white;" onclick="window.sistema.abrirFerramenta({ferramenta:'mobaxterm', ip:'${ip}', tipo:'${toolTipo}'})">MobaXterm</button>`;

        // Botões Manuais (Para Caixas ADM e Outros Dispositivos não mapeados)
        const btnPuttyManual = `<button class="btn-action" style="${btnStyle} background: #2563eb; color: white;" onclick="abrirTerminalManual('putty', '${ip}')">PuTTY</button>`;
        const btnMobaManual = `<button class="btn-action" style="${btnStyle} background: #4f46e5; color: white;" onclick="abrirTerminalManual('mobaxterm', '${ip}')">MobaXterm</button>`;

        // Ações extras
        const btnBrowser = `<button class="btn-action" style="${btnStyle} background: #059669; color: white; flex-basis: 100%;" onclick="window.sistema.abrirFerramenta({ferramenta:'browser', ip:'${ip}'})">Acessar Interface Web</button>`;
        const btnReconfig = `<button class="btn-action" style="${btnStyle} background: #dc2626; color: white; flex-basis: 100%;" onclick="reconfigurarPDVPorIP('${ip}', '${num_pdv}')">Reconfigurar PDV ${num_pdv}</button>`;
        const btnAjusteImp = `<button class="btn-action" style="${btnStyle} background: #059669; color: white; flex-basis: 100%;" onclick="ajustarImpressoraTelefonia('${ip}')">Desbloquear Impressoras</button>`;

        // Lógica de Atribuição
        if (tipo_acao === 'servidor') {
            htmlBotoes = `<button class="btn-action" style="${btnStyle} background: #2563eb; color: white; flex-basis: 45%;" onclick="window.sistema.abrirFerramenta({ferramenta:'putty', ip:'${ip}', tipo:'servidor'})">PuTTY</button>
                          <button class="btn-action" style="${btnStyle} background: #4f46e5; color: white; flex-basis: 45%;" onclick="window.sistema.abrirFerramenta({ferramenta:'mobaxterm', ip:'${ip}', tipo:'servidor'})">MobaXterm</button>`;
        }
        else if (tipo_acao === 'pdv') { htmlBotoes = btnVncAuto + btnPuttyAuto + btnMobaAuto + btnReconfig; }
        else if (tipo_acao === 'pv') { htmlBotoes = btnVncAuto + btnPuttyAuto + btnMobaAuto; }
        // CORREÇÃO: A Telefonia agora usa os botões AUTO em vez dos MANUAIS
        else if (tipo_acao === 'telefonia') { htmlBotoes = btnVncAuto + btnPuttyAuto + btnMobaAuto + btnAjusteImp; }
        else if (tipo_acao === 'admin' || tipo_acao === 'outros') { htmlBotoes = btnVncAuto + btnPuttyManual + btnMobaManual; }
        else if (tipo_acao === 'impressora') { htmlBotoes = btnBrowser; }

    } else {
        htmlBotoes = `<div style="width: 100%; text-align: center; color: #ef4444; padding: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid #7f1d1d; border-radius: 4px; font-size: 13px; font-weight: 500;">Dispositivo offline. Ferramentas indisponíveis.</div>`;
    }

    document.getElementById('detAcoes').innerHTML = htmlBotoes;
    document.getElementById('modalDetalhesDispositivo').style.display = 'flex';

    if (status === 'ONLINE' && tipo_acao !== 'impressora') {
        let tipo_ssh_hw = 'pdv';
        if (tipo_acao === 'servidor') tipo_ssh_hw = 'servidor';
        if (tipo_acao === 'telefonia') tipo_ssh_hw = 'telefonia';
        
        carregarHardwareDevice(ip, tipo_ssh_hw);
    } else {
        document.getElementById('detOS').innerText = "N/A";
        document.getElementById('detRAM').innerText = "N/A";
        document.getElementById('detDisco').innerText = "N/A";
    }
}

async function carregarHardwareDevice(ip, tipo_ssh) {
    const scriptHW = `
        D_USE=$(df -h / | awk 'NR==2{print $5}')
        MEM_USED=$(free -m | awk 'NR==2{print $3}')
        MEM_TOT=$(free -m | awk 'NR==2{print $2}')
        OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2)
        [ -z "$OS" ] && OS=$(cat /etc/redhat-release 2>/dev/null)
        [ -z "$OS" ] && OS=$(cat /etc/issue 2>/dev/null | head -n 1)
        
        # COMANDOS PARA PUXAR O MAC REAL DA PLACA FÍSICA
        MAC=$(ip link 2>/dev/null | awk '/ether/ {print $2}' | head -n 1)
        [ -z "$MAC" ] && MAC=$(ifconfig 2>/dev/null | grep -i -o -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | grep -v "00:00:00:00:00:00" | head -n 1)
        
        echo "$D_USE|$MEM_USED|$MEM_TOT|$OS|$MAC"
    `;
    try {
        const res = await window.sistema.rodarSSH({ host: ip, script: scriptHW, tipo: tipo_ssh });
        if (res.sucesso && res.resultado.includes('|')) {
            const p = res.resultado.trim().split('|');
            document.getElementById('detDisco').innerText = p[0] ? p[0] : "N/A";
            document.getElementById('detRAM').innerText = p[1] && p[2] ? `${p[1]}MB / ${p[2]}MB` : "N/A";
            document.getElementById('detOS').innerText = p[3] ? p[3].replace(/\n|\r/g, '') : "Linux Desconhecido";

            const macReal = p[4] ? p[4].replace(/\n|\r/g, '').toUpperCase() : "";
            if (macReal && macReal.includes(":")) {
                document.getElementById('detMAC').innerText = macReal;
            }
        } else {
            document.getElementById('detOS').innerText = "Falha ao ler";
            document.getElementById('detRAM').innerText = "Falha ao ler";
            document.getElementById('detDisco').innerText = "Falha ao ler";
        }
    } catch (e) {
        document.getElementById('detOS').innerText = "Erro de conexão";
        document.getElementById('detRAM').innerText = "Erro de conexão";
        document.getElementById('detDisco').innerText = "Erro de conexão";
    }
}

// --- ATUALIZAÇÃO ---
document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key === 'U') checarAtualizacao(); });
async function checarAtualizacao() {
    mostrarLoading("Verificando atualizações na rede...");
    try {
        const res = await window.sistema.verificarAtualizacao();
        fecharModais();
        if (res && res.atualizado) showToast("Sistema já está na versão mais recente.", "success");
        else if (res && res.erro) showToast(res.erro, "error");
    } catch (err) { fecharModais(); showToast("Erro crítico: " + err.message, "error"); }
}

// --- SISTEMA DE CONSOLE EM TEMPO REAL ---
window.sistema.onConsoleUpdate((texto) => {
    const consoleDiv = document.getElementById('consoleOutput');
    if (consoleDiv) {
        consoleDiv.innerHTML += texto.replace(/\n/g, '<br>');
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
});

function abrirConsole() {
    document.getElementById('modalConsole').style.display = 'flex';
}

function limparConsole() {
    document.getElementById('consoleOutput').innerHTML = '';
}

// --- TELEFONIA: AJUSTE E DESBLOQUEIO DE IMPRESSORA ---
async function ajustarImpressoraTelefonia(ip) {
    mostrarLoading("Desbloqueando e reiniciando spooler...");
    try {
        const scriptCups = "cancel -a ; lpstat -a | awk '{print $1}' | xargs cupsenable ; systemctl restart cups || service cups restart";
        
        const res = await window.sistema.rodarSSH({ host: ip, script: scriptCups, tipo: 'telefonia' });

        fecharModais();
        if (res.sucesso) {
            showToast("Spooler limpo e impressoras ativadas com sucesso!");
        } else {
            showToast(`Falha ao comunicar: ${res.erro}`, "error");
        }
    } catch (e) {
        fecharModais();
        showToast("Erro crítico de rede ao ajustar impressora.", "error");
    }
}