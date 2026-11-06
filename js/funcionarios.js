// =========================================================
// FUNCIONÁRIOS — consulta, cadastro e desligamento em lote
// =========================================================

const removerAcentos = texto => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

function mudarSubAba(nome, el) {
    document.querySelectorAll('.sub-tab-content').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.seg-btn[role="tab"]').forEach(b => b.classList.remove('active'));
    $(`sub-${nome}`).classList.add('active');
    el.classList.add('active');
}

function mensagemErroFilial(r) {
    return r.erro === 'dns' ? 'Filial não encontrada (DNS).' : 'Falha de senha (SSH) na filial informada.';
}

// ---------- consulta ----------
let senhaConsultaAtual = '';
let senhaConsultaVisivel = false;

function atualizarSenhaConsulta() {
    $('resConsSenha').textContent = senhaConsultaVisivel
        ? senhaConsultaAtual
        : '•'.repeat(Math.max(senhaConsultaAtual.length, 5));
    $('btnOlhoSenha').innerHTML = icone(senhaConsultaVisivel ? 'eye-off' : 'eye');
}

function toggleSenhaConsulta() {
    senhaConsultaVisivel = !senhaConsultaVisivel;
    atualizarSenhaConsulta();
}

async function copiarSenhaConsulta() {
    if (!senhaConsultaAtual || senhaConsultaAtual === 'Sem senha') { showToast('Não há senha para copiar.', 'warning'); return; }
    try {
        await navigator.clipboard.writeText(senhaConsultaAtual);
    } catch (e) {
        const t = document.createElement('textarea');
        t.value = senhaConsultaAtual;
        document.body.appendChild(t); t.select();
        document.execCommand('copy');
        t.remove();
    }
    showToast('Senha copiada.');
}

function mostrarResultadoConsulta({ nome, senha, gerente, ativo }) {
    $('resConsNome').textContent = nome;
    senhaConsultaAtual = senha;
    senhaConsultaVisivel = false;
    atualizarSenhaConsulta();

    const elGer = $('resConsGerente');
    if (elGer) {
        elGer.textContent = '';
        elGer.appendChild(criarBadge(gerente ? 'Sim' : 'Não', gerente ? 'info' : ''));
    }

    const elSit = $('resConsStatus');
    elSit.textContent = '';
    elSit.appendChild(criarBadge(ativo ? 'Ativo' : 'Inativo', ativo ? 'ok' : 'bad'));

    $('painelResultadoConsulta').classList.add('show');
}

async function consultarFuncionario() {
    const filialRaw = $('consFilial').value.trim();
    const sispe = $('consSispe').value.trim();

    if (!filialRaw || !sispe) { showToast('Preencha a filial e o SISPE.', 'warning'); return; }

    const filialStr = filialRaw.padStart(3, '0');
    $('painelResultadoConsulta').classList.remove('show');
    mostrarLoading(`Conectando na filial ${filialRaw}...`);

    const alvo = await resolverEAutenticarFilial(filialRaw);
    if (!alvo.ok) { fecharModais(); showToast(mensagemErroFilial(alvo), 'error'); return; }

    mostrarLoading('Consultando o banco de dados...');

    const progressConsulta = `
export TERM=xterm
cd /usr/admcom/progr/
cat <<EOF > func_cons_${sispe}.p
output to "/tmp/res_cons_${sispe}.txt".
for each func where funcod = ${sispe} and etbcod = ${filialStr} no-lock:
    put unformatted "RESULTADO|" func.FunNom "|" func.Senha "|" func.FunSit "|" func.FunMec skip.
end.
output close.
EOF
chmod 777 func_cons_${sispe}.p
mbpro -b -pf /srv/admcom/bases/remoto.pf -p /usr/admcom/progr/func_cons_${sispe}.p > /dev/null 2>&1
sleep 4
cat /tmp/res_cons_${sispe}.txt
rm -f func_cons_${sispe}.p /tmp/res_cons_${sispe}.txt
`;

    try {
        const res = await window.sistema.rodarSSH({ host: alvo.ip, script: scriptEmBase64(progressConsulta), tipo: 'servidor' });
        fecharModais();

        if (!(res.sucesso && res.resultado)) { showToast('Erro ao comunicar com o banco de dados.', 'error'); return; }

        const linha = res.resultado.split('\n').find(l => l.startsWith('RESULTADO|'));
        if (!linha) { showToast('Matrícula não encontrada nesta filial.', 'error'); return; }

        const partes = linha.split('|');
        const sim = v => ['yes', 'true'].includes((v || '').trim().toLowerCase());
        mostrarResultadoConsulta({
            nome: partes[1] || 'Não informado',
            senha: partes[2] || 'Sem senha',
            ativo: sim(partes[3]),
            gerente: sim(partes[4])
        });
        showToast('Dados recuperados.');
    } catch (e) {
        fecharModais();
        showToast('Falha de ligação com a loja.', 'error');
    }
}

// ---------- cadastro ----------
// Usuário e senha acompanham a matrícula enquanto ninguém os altera à mão.
function sincronizarCredenciaisCadastro() {
    const matricula = $('cadMatricula').value;
    ['cadUsuario', 'cadSenha'].forEach(id => {
        const campo = $(id);
        if (campo.dataset.manual !== 'true') campo.value = matricula;
    });
}

// Chamado quando alguém digita direto em usuário ou senha: passa a respeitar o valor digitado.
// Se o campo ficar vazio ou igual à matrícula, volta a acompanhar a matrícula.
function marcarCredencialManual(campo) {
    const igual = campo.value === '' || campo.value === $('cadMatricula').value;
    campo.dataset.manual = igual ? 'false' : 'true';
}

async function cadastrarFuncionario() {
    const matricula = $('cadMatricula').value.trim();
    const nomeRaw = $('cadNome').value.trim();
    const apelidoRaw = $('cadApelido').value.trim();
    const estab = $('cadEstab').value.trim();
    const funcaoRaw = $('cadFuncao').value.trim();
    const usuarioRaw = $('cadUsuario').value.trim();
    const senha = $('cadSenha').value.trim();
    const isGerente = $('cadGerente').value;           // TRUE ou FALSE

    if (!matricula || !nomeRaw || !estab || !senha) { showToast('Preencha matrícula, nome, filial e senha.', 'error'); return; }
    if (matricula.length !== 5) { showToast('A matrícula deve ter exatamente 5 dígitos.', 'warning'); return; }
    if (senha.length !== 5) { showToast('A senha deve ter exatamente 5 caracteres.', 'warning'); return; }

    const nome = removerAcentos(nomeRaw).substring(0, 35);
    const apelido = apelidoRaw ? removerAcentos(apelidoRaw).substring(0, 20) : '';
    const funcao = funcaoRaw ? removerAcentos(funcaoRaw).substring(0, 15) : '';
    const usuario = usuarioRaw ? removerAcentos(usuarioRaw).substring(0, 5) : '';

    mostrarLoading(`Conectando na filial ${estab}...`);
    const alvo = await resolverEAutenticarFilial(estab);
    if (!alvo.ok) { fecharModais(); showToast(mensagemErroFilial(alvo), 'error'); return; }

    mostrarLoading('Enviando para o banco de dados...');

    let assignBlock = `
    func.FunCod = ${matricula}
    func.FunNom = '${nome}'
    func.FunSit = TRUE
    func.FunDtCad = TODAY
    func.FunMec = ${isGerente}`;

    if (apelido) assignBlock += `\n    func.FunApe = '${apelido}'`;
    if (estab) assignBlock += `\n    func.EtbCod = ${estab}`;
    if (funcao) assignBlock += `\n    func.FunFunc = '${funcao}'`;
    if (usuario) assignBlock += `\n    func.UserCod = '${usuario}'`;
    if (senha) assignBlock += `\n    func.Senha = '${senha}'`;
    assignBlock += `.`;

    const progressCadastro = `
export TERM=xterm
cd /usr/admcom/progr/
cat <<EOF > func_cad_${matricula}.p
create func.
assign ${assignBlock}
EOF
chmod 777 func_cad_${matricula}.p
mbpro -b -pf /srv/admcom/bases/remoto.pf -p /usr/admcom/progr/func_cad_${matricula}.p
sleep 5
rm -f func_cad_${matricula}.p
echo 'FIM_SCRIPT_PROGRESS'
`;

    try {
        abrirConsole();
        logConsole('\n');
        logSeparador();
        logConsole(`[PROGRESS DB] Conectado na filial ${estab} (${alvo.ip})\n`, 'log-info');
        logConsole(`[PROGRESS DB] Enviando o cadastro (matrícula ${matricula})...\n`, 'log-info');

        const res = await window.sistema.rodarSSH({ host: alvo.ip, script: scriptEmBase64(progressCadastro), tipo: 'servidor' });
        fecharModais();

        if (!res.sucesso) { showToast('Erro ao comunicar com o servidor.', 'error'); return; }

        logConsole(`Retorno do banco:\n${res.resultado}\n`);

        if (res.resultado.includes("ja' existe") || res.resultado.includes('(132)')) {
            showToast(`O SISPE ${matricula} já está cadastrado nesta loja.`, 'warning');
        } else if (res.resultado.includes('**') || res.resultado.toLowerCase().includes('error')) {
            showToast('Falha na sintaxe do banco de dados. Veja o console.', 'error');
        } else {
            showToast('Funcionário cadastrado.');
            ['cadMatricula', 'cadNome', 'cadApelido', 'cadEstab', 'cadFuncao', 'cadUsuario', 'cadSenha'].forEach(id => { $(id).value = ''; });
            ['cadUsuario', 'cadSenha'].forEach(id => { delete $(id).dataset.manual; });
            $('cadGerente').value = 'FALSE';
        }
    } catch (e) {
        fecharModais();
        showToast('Falha de ligação com a loja.', 'error');
    }
}

// ---------- desligamento em lote ----------
let filaDesligamentos = [];

function adicionarFilaDesligamento() {
    const f = $('desligFilial').value.trim();
    const s = $('desligSispe').value.trim();
    if (!f || !s) { showToast('Preencha a filial e o SISPE.', 'error'); return; }
    if (!/^\d+$/.test(f) || !/^\d+$/.test(s)) { showToast('Filial e SISPE devem conter apenas números.', 'warning'); return; }

    filaDesligamentos.push({ filial: f, sispe: s });
    $('desligFilial').value = '';
    $('desligSispe').value = '';
    $('desligFilial').focus();
    atualizarTabelaFila();
}

function removerItemFila(idx) { filaDesligamentos.splice(idx, 1); atualizarTabelaFila(); }

function atualizarTabelaFila() {
    const tbody = $('tabelaFilaDesligamento');
    if (filaDesligamentos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="table-empty">A fila está vazia.</td></tr>';
        return;
    }
    tbody.innerHTML = filaDesligamentos.map((item, idx) =>
        `<tr>
            <td class="cell-key">Filial ${escaparHtml(item.filial)}</td>
            <td class="mono">${escaparHtml(item.sispe)}</td>
            <td class="right"><button class="btn btn-ghost btn-sm" onclick="removerItemFila(${idx})" aria-label="Remover da fila">${icone('trash')}Remover</button></td>
        </tr>`).join('');
}

async function iniciarDesligamentoLote() {
    if (filaDesligamentos.length === 0) { showToast('A fila está vazia.', 'warning'); return; }

    const total = filaDesligamentos.length;
    const sim = await confirmarAcao({
        titulo: `Desligar ${total} ${total === 1 ? 'funcionário' : 'funcionários'}?`,
        mensagem: 'Cada SISPE da fila será desativado e terá a senha redefinida no banco da respectiva loja. Essa ação altera dados de produção.',
        confirmar: 'Desligar'
    });
    if (!sim) return;

    mostrarLoading('Processando desligamentos...');

    let sucessos = 0;
    const filiaisComErro = [];
    const novaFila = [];

    try {
        for (const item of filaDesligamentos) {
            const alvo = await resolverEAutenticarFilial(item.filial);
            if (!alvo.ok) {
                filiaisComErro.push(`F${item.filial} (${alvo.erro === 'dns' ? 'DNS' : 'senha SSH'})`);
                novaFila.push(item);
                continue;
            }

            const progressDesligar = `
cat <<EOF > /tmp/deslig_${item.sispe}.p
for each func where funcod = ${item.sispe}:
assign
    func.funsit = FALSE
    func.senha  = '102030'.
end.
EOF
cd /usr/admcom/progr/
mbpro -b -pf /srv/admcom/bases/remoto.pf -p /tmp/deslig_${item.sispe}.p > /dev/null 2>&1
sleep 5
rm -f /tmp/deslig_${item.sispe}.p
echo 'SUCESSO_DESLIGAMENTO'
`;
            const res = await window.sistema.rodarSSH({ host: alvo.ip, script: scriptEmBase64(progressDesligar), tipo: 'servidor' });

            if (res.sucesso && res.resultado && res.resultado.includes('SUCESSO_DESLIGAMENTO')) {
                sucessos++;
            } else {
                filiaisComErro.push(`F${item.filial} (falha no banco)`);
                novaFila.push(item);
            }
        }
    } catch (e) { console.error(e); } finally { fecharModais(); }

    filaDesligamentos = novaFila;
    atualizarTabelaFila();

    if (filiaisComErro.length > 0) showToast(`Falhas em: ${filiaisComErro.join(', ')}`, 'error');
    if (sucessos > 0) showToast(`${sucessos} desligamento(s) concluído(s).`);
}