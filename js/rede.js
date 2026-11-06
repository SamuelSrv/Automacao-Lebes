// =========================================================
// REDE — scanner de dispositivos, detalhes e hardware
// =========================================================

let ramIntervalId = null;

// Faixa de IP da telefonia (a mesma usada pelo Scanner de dispositivos e pelo quadro de telefonia)
const FAIXA_TELEFONIA = { inicio: 200, fim: 205 };

function pararRamAoVivo() {
    if (ramIntervalId) { clearInterval(ramIntervalId); ramIntervalId = null; }
}

function modalVisivel(id) { return getComputedStyle($(id)).display !== 'none'; }

// ---------- scanner ----------
async function abrirMapaRede() {
    if (!exigirFilial()) return;
    mostrarLoading('Carregando equipamentos...');

    const rawScript = `
        REDE="${estado.redeBase}"

        > /tmp/scan_dhcp.txt

        cat /etc/dhcp/dhcpd.conf /etc/ltsp/dhcpd.conf 2>/dev/null | tr -d '\\r' | awk '
            $1 == "host" { h=$2; gsub(/[{}]/, "", h); m="Desconhecido" }
            $1 == "hardware" { m=$3; gsub(/;/, "", m) }
            $1 == "fixed-address" { i=$2; gsub(/;/, "", i); if(h!="") print i "|" m "|" h }
        ' > /tmp/scan_dhcp.txt

        > /tmp/scan_ips.txt
        cat /tmp/scan_dhcp.txt | cut -d'|' -f1 >> /tmp/scan_ips.txt
        for i in $(seq 101 250); do echo "${estado.redeBase}.$i" >> /tmp/scan_ips.txt; done
        sort -u /tmp/scan_ips.txt > /tmp/scan_ips_unique.txt

        > /tmp/scan_online.txt
        while read ip; do
            ( ping -c 1 -W 1 $ip >/dev/null 2>&1 && echo "$ip" >> /tmp/scan_online.txt ) &
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
        const res = await window.sistema.rodarSSH({ host: estado.ipServidorBase, script: scriptEmBase64(rawScript), tipo: 'servidor' });
        fecharModais();

        if (!res.sucesso) { showToast('Falha ao mapear a rede.', 'error'); return; }

        const devices = res.resultado.split('\n')
            .map(l => l.trim()).filter(l => l.includes('|'))
            .map(l => { const p = l.split('|'); return { ip: p[0], mac: p[1], host: p[2], status: p[3] }; });

        devices.sort((a, b) => ultimoOcteto(a.ip) - ultimoOcteto(b.ip));
        devices.unshift({ ip: estado.ipServidorBase, mac: 'Lendo hardware...', host: `filial${estado.filialAtual}`, status: 'ONLINE', isServer: true });
        $('mapaFilialNum').textContent = estado.filialAtual;
        montarMapaRede(devices);
    } catch (e) { fecharModais(); showToast('Erro no scanner de rede.', 'error'); }
}

// Classifica cada equipamento pela faixa de IP ou pelo hostname
function classificarDispositivo(dev) {
    if (dev.isServer) return { ...dev, nome: 'Servidor', tipo_acao: 'servidor', num: '', grupo: 'Servidor' };

    const oct = ultimoOcteto(dev.ip);
    const num = oct > 100 ? oct - 100 : oct;
    const host = (dev.host || '').toLowerCase();

    if (oct === 250 || host.includes('impressora') || host.includes('scanner')) return { ...dev, nome: dev.host, tipo_acao: 'impressora', num: '', grupo: 'Impressoras e scanners' };
    if ((oct >= 101 && oct <= 109) || host.includes('ws00')) return { ...dev, nome: `Caixa ADM ${num}`, tipo_acao: 'admin', num, grupo: 'Caixas ADM' };
    if ((oct >= 110 && oct <= 129) || host.includes('pv0')) return { ...dev, nome: `Pré-venda ${num}`, tipo_acao: 'pv', num, grupo: 'Pré-vendas' };
    if ((oct >= 130 && oct <= 139) || host.includes('pdv')) return { ...dev, nome: `PDV ${num}`, tipo_acao: 'pdv', num, grupo: 'PDVs' };
    if ((oct >= FAIXA_TELEFONIA.inicio && oct <= FAIXA_TELEFONIA.fim) || host.includes('telefonia')) {
        const nome = dev.host && dev.host !== 'Desconhecido' ? dev.host : `Telefonia .${oct}`;
        return { ...dev, nome, tipo_acao: 'telefonia', num: '', grupo: 'Telefonia' };
    }
    return { ...dev, nome: dev.host, tipo_acao: 'outros', num, grupo: 'Outros' };
}

const ORDEM_GRUPOS = ['Servidor', 'PDVs', 'Pré-vendas', 'Caixas ADM', 'Telefonia', 'Impressoras e scanners', 'Outros'];

function montarMapaRede(devices) {
    estado.dispositivos = devices.map(classificarDispositivo);
    const container = $('mapaContainer');
    container.textContent = '';

    ORDEM_GRUPOS.forEach(grupo => {
        const itens = estado.dispositivos.map((d, idx) => ({ d, idx })).filter(x => x.d.grupo === grupo);
        if (itens.length === 0) return;

        const secao = document.createElement('div');
        secao.className = 'network-group';
        const titulo = document.createElement('h4');
        titulo.textContent = grupo;
        const grade = document.createElement('div');
        grade.className = 'device-grid';

        itens.forEach(({ d, idx }) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'device-card';
            card.dataset.idx = idx;
            card.innerHTML =
                `<span class="device-name">${escaparHtml(d.nome)} ${statusDot(d.status === 'ONLINE' ? 'ok' : 'bad')}</span>` +
                `<span class="device-ip">${escaparHtml(d.ip)}</span>`;
            grade.appendChild(card);
        });

        secao.append(titulo, grade);
        container.appendChild(secao);
    });

    if (!container.children.length) {
        const vazio = document.createElement('div');
        vazio.className = 'empty';
        vazio.textContent = 'Nenhum dispositivo encontrado.';
        container.appendChild(vazio);
    }
    abrirModal('modalMapaRede');
}

// ---------- terminais sem login automático ----------
function abrirTerminalManual(ferramenta, ip) {
    window.sistema.abrirFerramenta({ ferramenta, ip, tipo: 'manual' });
}

async function reiniciarEquipamentoTelefonia(ip) {
    const sim = await confirmarAcao({
        titulo: 'Reiniciar o equipamento de telefonia?',
        mensagem: `O equipamento ${ip} será reiniciado e as ligações da loja ficam indisponíveis até ele voltar.`,
        confirmar: 'Reiniciar equipamento'
    });
    if (!sim) return;

    mostrarLoading('Enviando comando de reinício...');
    try {
        const res = await window.sistema.rodarSSH({ host: ip, script: 'reboot', tipo: 'telefonia' });
        fecharModais();
        if (res.sucesso) showToast('Comando de reinício enviado.');
        else showToast(`Erro ao reiniciar: ${res.erro || 'falha na execução'}`, 'error');
    } catch (e) { fecharModais(); showToast('Erro de comunicação com o equipamento.', 'error'); }
}

// ---------- detalhes do dispositivo ----------
function abrirDetalhesDispositivo(dev) {
    pararRamAoVivo();
    const { ip, mac, host, nome, status, tipo_acao: tipo, num } = dev;
    const online = status === 'ONLINE';

    $('detNome').textContent = nome;
    const selo = $('detStatusBadge');
    selo.textContent = online ? 'Online' : 'Offline';
    selo.className = `badge ${online ? 'ok' : 'bad'}`;

    $('detHost').textContent = host || 'Desconhecido';
    $('detIP').textContent = ip;
    $('detMAC').textContent = mac || 'Desconhecido';
    ['detOS', 'detRAM', 'detDisco'].forEach(id => { $(id).textContent = 'Carregando...'; });

    const boxBase = $('boxUltimoBase'), txtBase = $('detUltimoBase');
    boxBase.classList.toggle('hidden', tipo !== 'servidor');
    if (tipo === 'servidor') { txtBase.textContent = 'Calculando...'; txtBase.classList.remove('is-ok', 'is-bad'); }

    const acoes = $('detAcoes');
    acoes.textContent = '';

    if (online) {
        const tipoBackend = (tipo === 'pdv' || tipo === 'pv') ? 'pdv' : tipo;
        const chaveAutoVnc = tipo === 'pdv' ? 'vncAutoPdv' : (tipo === 'admin' ? 'vncAutoAdm' : '');
        const botao = (texto, icon, classe, fn, cheio = false) => criarBotao({
            texto, icon, classe: `btn ${classe}${cheio ? ' full' : ''}`.trim(),
            onClick: () => { fecharModal('modalDetalhesDispositivo'); pararRamAoVivo(); fn(); }
        });

        const vnc = () => botao('VNC', 'monitor', 'btn-primary', () =>
            window.sistema.abrirFerramenta({ ferramenta: 'vnc', ip, tipo: tipoBackend, autoVnc: configSistema[chaveAutoVnc] === true }));
        const puttyPdv = () => botao('PuTTY', 'terminal', '', () => abrirFerramentaPdv('putty', ip));
        const mobaPdv = () => botao('MobaXterm', 'terminal', '', () => abrirFerramentaPdv('mobaxterm', ip));
        const puttyManual = () => botao('PuTTY', 'terminal', '', () => abrirTerminalManual('putty', ip));
        const mobaManual = () => botao('MobaXterm', 'terminal', '', () => abrirTerminalManual('mobaxterm', ip));

        let botoes = [];
        if (tipo === 'servidor') {
            botoes = [
                botao('PuTTY', 'terminal', '', () => window.sistema.abrirFerramenta({ ferramenta: 'putty', ip, tipo: 'servidor' })),
                botao('MobaXterm', 'terminal', '', () => window.sistema.abrirFerramenta({ ferramenta: 'mobaxterm', ip, tipo: 'servidor' }))
            ];
        } else if (tipo === 'pdv') {
            botoes = [vnc(), puttyPdv(), mobaPdv(), botao(`Reconfigurar PDV ${num}`, 'wrench', 'btn-danger', () => reconfigurarPdv(ip), true)];
        } else if (tipo === 'pv') {
            botoes = [vnc(), puttyPdv(), mobaPdv()];
        } else if (tipo === 'telefonia') {
            botoes = [vnc(), puttyManual(), mobaManual(), botao('Reiniciar equipamento', 'power', 'btn-danger', () => reiniciarEquipamentoTelefonia(ip), true)];
        } else if (tipo === 'admin' || tipo === 'outros') {
            botoes = [vnc(), puttyManual(), mobaManual()];
        } else if (tipo === 'impressora') {
            botoes = [botao('Abrir interface web', 'globe', 'btn-primary', () => window.sistema.abrirFerramenta({ ferramenta: 'browser', ip }), true)];
        }
        botoes.forEach(b => acoes.appendChild(b));
    } else {
        const aviso = document.createElement('div');
        aviso.className = 'offline-note';
        aviso.textContent = 'Dispositivo offline. As ferramentas ficam indisponíveis.';
        acoes.appendChild(aviso);
    }

    abrirModal('modalDetalhesDispositivo');

    if (online && ['servidor', 'pdv', 'pv', 'telefonia'].includes(tipo)) {
        const tipoSsh = tipo === 'servidor' ? 'servidor' : (tipo === 'telefonia' ? 'telefonia' : 'pdv');
        carregarHardwareDevice(ip, tipoSsh, tipo === 'servidor');
    } else {
        $('detOS').textContent = 'Requer login manual';
        $('detRAM').textContent = 'N/D';
        $('detDisco').textContent = 'N/D';
    }
}

async function carregarHardwareDevice(ip, tipoSsh, isServidor = false) {
    const scriptHW = `
        D_USE=$(df -h / | awk 'NR==2{print $5}')
        MEM_USED=$(free -m | awk 'NR==2{print $3}')
        MEM_TOT=$(free -m | awk 'NR==2{print $2}')
        OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2)
        [ -z "$OS" ] && OS=$(cat /etc/redhat-release 2>/dev/null)
        [ -z "$OS" ] && OS=$(cat /etc/issue 2>/dev/null | head -n 1)

        MAC=$(ip link 2>/dev/null | awk '/ether/ {print $2}' | head -n 1)
        [ -z "$MAC" ] && MAC=$(ifconfig 2>/dev/null | grep -i -o -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | grep -v "00:00:00:00:00:00" | head -n 1)

        echo "$D_USE|$MEM_USED|$MEM_TOT|$OS|$MAC"
    `;
    const falha = msg => ['detOS', 'detRAM', 'detDisco'].forEach(id => { $(id).textContent = msg; });

    try {
        const res = await window.sistema.rodarSSH({ host: ip, script: scriptHW, tipo: tipoSsh });
        if (!(res.sucesso && res.resultado.includes('|'))) { falha('Falha ao ler'); return; }

        const p = res.resultado.trim().split('|');
        $('detDisco').textContent = p[0] || 'N/D';
        $('detOS').textContent = p[3] ? p[3].replace(/\n|\r/g, '') : 'Linux desconhecido';
        $('detRAM').textContent = p[1] && p[2] ? `${p[1]} MB / ${p[2]} MB` : 'N/D';

        const macReal = p[4] ? p[4].replace(/\n|\r/g, '').toUpperCase() : '';
        if (macReal.includes(':')) $('detMAC').textContent = macReal;

        if (isServidor && window.sistema.obterUltimoBase && window.sistema.obterRamAoVivo) {
            window.sistema.obterUltimoBase(ip).then(resBase => {
                const txt = $('detUltimoBase');
                if (resBase && resBase.sucesso) { txt.textContent = resBase.dataBase; txt.classList.add('is-ok'); }
                else { txt.textContent = 'Não encontrado'; txt.classList.add('is-bad'); }
            });

            let buscando = false;
            ramIntervalId = setInterval(async () => {
                if (!modalVisivel('modalDetalhesDispositivo')) { pararRamAoVivo(); return; }
                if (buscando) return;
                buscando = true;
                try {
                    const r = await window.sistema.obterRamAoVivo(ip);
                    if (r && r.sucesso && modalVisivel('modalDetalhesDispositivo')) $('detRAM').textContent = `${r.usado} MB / ${r.total} MB`;
                } catch (e) { console.error(e); } finally { buscando = false; }
            }, 4000);
        }
    } catch (e) { falha('Erro de conexão'); }
}

// ---------- máquinas da telefonia (quadro no Monitoramento) ----------
let maquinasTelefonia = [];
let _buscaTelId = 0;

// Pergunta ao servidor quais máquinas da telefonia existem: IPs da faixa + hosts "telefonia" do DHCP.
// Online = respondeu ping. Offline só aparece se estiver cadastrada no DHCP (igual ao Scanner).
async function escanearTelefonia() {
    const rede = estado.redeBase;
    const script = `
        D=/tmp/scan_tel_$$
        cat /etc/dhcp/dhcpd.conf /etc/ltsp/dhcpd.conf 2>/dev/null | tr -d '\\r' | awk '
            $1 == "host" { h=$2; gsub(/[{}]/, "", h); m="Desconhecido" }
            $1 == "hardware" { m=$3; gsub(/;/, "", m) }
            $1 == "fixed-address" { i=$2; gsub(/;/, "", i); if(h!="") print i "|" m "|" h }
        ' > $D.dhcp
        > $D.ips
        awk -F'|' 'tolower($3) ~ /telefonia/ { print $1 }' $D.dhcp >> $D.ips
        for i in $(seq ${FAIXA_TELEFONIA.inicio} ${FAIXA_TELEFONIA.fim}); do echo "${rede}.$i" >> $D.ips; done
        sort -u $D.ips > $D.uniq
        > $D.on
        while read ip; do
            ( ping -c 1 -W 1 $ip >/dev/null 2>&1 && echo "$ip" >> $D.on ) &
        done < $D.uniq
        wait
        arp -n > $D.arp
        while read ip; do
            dhcp_line=$(grep "^$ip|" $D.dhcp | head -n 1)
            host="Desconhecido"
            [ -n "$dhcp_line" ] && host=$(echo "$dhcp_line" | cut -d'|' -f3)
            if grep -q "^$ip$" $D.on; then
                mac=$(grep "^$ip " $D.arp | grep -i -o -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | head -n 1)
                if [ -z "$mac" ] && [ -n "$dhcp_line" ]; then mac=$(echo "$dhcp_line" | cut -d'|' -f2); fi
                [ -z "$mac" ] && mac="Desconhecido"
                echo "$ip|$mac|$host|ONLINE"
            elif [ -n "$dhcp_line" ]; then
                echo "$ip|$(echo "$dhcp_line" | cut -d'|' -f2)|$host|OFFLINE"
            fi
        done < $D.uniq
        rm -f $D.*
    `;
    const res = await window.sistema.rodarSSH({ host: estado.ipServidorBase, script: scriptEmBase64(script), tipo: 'servidor' });
    if (!res.sucesso) throw new Error(res.erro || 'Falha ao procurar as máquinas da telefonia');

    return (res.resultado || '').split('\n')
        .map(l => l.trim())
        .filter(l => /^\d{1,3}(\.\d{1,3}){3}\|/.test(l))
        .map(l => { const p = l.split('|'); return { ip: p[0], mac: p[1], host: p[2], status: p[3] }; })
        .sort((a, b) => ultimoOcteto(a.ip) - ultimoOcteto(b.ip))
        .map(classificarDispositivo)
        .filter(d => d.tipo_acao === 'telefonia');
}

function mensagemTelefonia(texto) {
    const el = $('telefoniaVazio');
    el.textContent = texto;
    el.classList.toggle('hidden', !texto);
}

function renderizarTelefonia() {
    const board = $('telefoniaBoard');
    board.textContent = '';
    const lista = maquinasTelefonia;
    const online = lista.filter(d => d.status === 'ONLINE').length;
    const contagem = $('telefoniaContagem');
    contagem.textContent = `${online}/${lista.length}`;
    contagem.title = `${online} online de ${lista.length}`;

    if (lista.length === 0) {
        mensagemTelefonia(estado.redeBase ? `Nenhuma máquina da telefonia encontrada (IPs .${FAIXA_TELEFONIA.inicio} a .${FAIXA_TELEFONIA.fim}).` : '');
        return;
    }
    mensagemTelefonia('');

    lista.forEach((d, idx) => {
        const online = d.status === 'ONLINE';
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = `pdv-tile${online ? '' : ' is-offline'}`;
        tile.dataset.idx = idx;
        tile.title = online ? `Abrir ${d.nome}` : `${d.nome} está offline`;
        tile.innerHTML =
            `<span class="tile-icon">${icone('phone')}</span>` +
            `<span class="pdv-info"><span class="pdv-name">${escaparHtml(d.nome)}</span><span class="pdv-ip">${escaparHtml(d.ip)}</span></span>` +
            statusDot(online ? 'ok' : 'bad');
        board.appendChild(tile);
    });
}

function limparTelefonia() {
    _buscaTelId++;
    maquinasTelefonia = [];
    $('btnAtualizarTelefonia').disabled = false;
    renderizarTelefonia();
}

async function atualizarTelefonia() {
    if (!estado.redeBase) return;
    const busca = ++_buscaTelId;
    const btn = $('btnAtualizarTelefonia');
    btn.disabled = true;

    maquinasTelefonia = [];
    $('telefoniaBoard').textContent = '';
    $('telefoniaContagem').textContent = '0';
    mensagemTelefonia('Procurando máquinas da telefonia...');

    try {
        const lista = await escanearTelefonia();
        if (busca !== _buscaTelId) return;       // trocou de filial no meio da busca
        maquinasTelefonia = lista;
    } catch (e) {
        if (busca !== _buscaTelId) return;
        showToast('Não foi possível procurar as máquinas da telefonia.', 'error');
    } finally {
        if (busca === _buscaTelId) btn.disabled = false;
    }
    if (busca === _buscaTelId) renderizarTelefonia();
}

function iniciarRede() {
    $('telefoniaBoard').addEventListener('click', e => {
        const tile = e.target.closest('.pdv-tile');
        if (tile) abrirDetalhesDispositivo(maquinasTelefonia[Number(tile.dataset.idx)]);
    });
    $('mapaContainer').addEventListener('click', e => {
        const card = e.target.closest('.device-card');
        if (card) abrirDetalhesDispositivo(estado.dispositivos[Number(card.dataset.idx)]);
    });
}
