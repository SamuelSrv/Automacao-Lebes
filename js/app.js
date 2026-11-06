// =========================================================
// APP — navegação, atalhos e inicialização (carregado por último)
//
// Módulos (ordem de carga no index.html):
//   core.js          estado, utilitários, toast, modais e confirmação
//   config.js        opções, tema, versão e atualização
//   console.js       console de ações
//   monitor.js       conexão com a filial, servidor e acesso rápido
//   pdv.js           quadro de PDVs, hora e segunda via
//   funcionarios.js  consulta, cadastro e desligamento
//   rede.js          scanner de dispositivos e detalhes
// =========================================================

let _versaoRedeCarregada = false;

function mudarAba(nome, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
    $(`aba-${nome}`).classList.add('active');
    el.classList.add('active');
    el.setAttribute('aria-current', 'page');

    // a leitura da versão na rede só acontece quando Opções é aberta pela primeira vez
    if (nome === 'configuracoes' && !_versaoRedeCarregada) {
        _versaoRedeCarregada = true;
        carregarInfoVersao();
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { fecharModais(); return; }
    if (!(e.ctrlKey && e.shiftKey)) return;

    const tecla = e.key.toUpperCase();
    if (tecla === 'U') checarAtualizacao();
    if (tecla === 'C') {
        const aberto = $('devBox').classList.toggle('open');
        showToast(aberto ? 'Modo desenvolvedor ativado.' : 'Modo desenvolvedor desativado.', 'warning');
    }
});

async function iniciarVersaoLocal() {
    try {
        if (!window.sistema.obterVersaoLocal) return;   // preload antigo
        const { versaoLocal } = await window.sistema.obterVersaoLocal();
        estado.versaoLocal = versaoLocal;
        $('versaoSidebar').textContent = `v${versaoLocal}`;
        $('verLocal').textContent = versaoLocal;
        verificarExibicaoChangelog();
    } catch (e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => {
    carregarTema();
    carregarConfiguracoes();
    iniciarConsole();
    iniciarMonitor();
    iniciarPdv();
    iniciarRede();

    $('confirmarOk').addEventListener('click', () => resolverConfirmacao(true));
    $('confirmarCancelar').addEventListener('click', () => resolverConfirmacao(false));

    iniciarVersaoLocal();
});
