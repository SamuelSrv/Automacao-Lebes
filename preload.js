const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sistema', {
    rodarComando: (comando) => ipcRenderer.invoke('rodar-comando', comando),
    rodarSSH: (dados) => ipcRenderer.invoke('rodar-ssh', dados),
    abrirFerramenta: (dados) => ipcRenderer.invoke('abrir-ferramenta', dados),
    salvarArquivoNativo: (dados) => ipcRenderer.invoke('salvar-arquivo-nativo', dados),
    verificarAtualizacao: () => ipcRenderer.invoke('verificar-atualizacao'),
    autenticarServidor: (ip) => ipcRenderer.invoke('autenticar-servidor', ip),
    configurarPdv: (dados) => ipcRenderer.invoke('configurar-pdv', dados),
    toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
    onConsoleUpdate: (callback) => ipcRenderer.on('console-update', (event, data) => callback(data)),
    onStatusSenha: (callback) => ipcRenderer.on('status-senha-pdv', (event, data) => callback(data)),
    obterUltimoBase: (ip) => ipcRenderer.invoke('obter-ultimo-base', ip),
    obterRamAoVivo: (ip) => ipcRenderer.invoke('obter-ram-ao-vivo', ip),
    obterVersaoLocal: () => ipcRenderer.invoke('obter-versao-local'),
    obterInfoVersao: () => ipcRenderer.invoke('obter-info-versao'),
    desbloquearPutty: (dados) => ipcRenderer.invoke('desbloquear-putty', dados)
});