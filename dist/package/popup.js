/**
 * YouTube Transcript Copier — Popup Controller
 * Handles UI state, formatting options, content script injection,
 * transcript formatting, clipboard copy, and feedback links.
 */

'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const FEEDBACK_EMAIL = 'championabood10@gmail.com';
const EXT_VERSION = chrome.runtime.getManifest().version;

// ---- State references ----
const states = {
  idle: $('#idle-state'),
  loading: $('#loading-state'),
  success: $('#success-state'),
  error: $('#error-state'),
};

// ---- Cached transcript data ----
let cachedData = null;

// ---- Default settings ----
const DEFAULT_SETTINGS = {
  format: 'lines',
  timestamps: true,
  title: true,
  url: false,
  cleanDuplicates: false,
  promptPrepend: '',
  autoCopy: false,
};

function getSettings() {
  return {
    format: document.querySelector('.seg-btn.active')?.dataset.value || 'lines',
    timestamps: $('#include-timestamps').checked,
    title: $('#include-title').checked,
    url: $('#include-url').checked,
    cleanDuplicates: $('#clean-duplicates').checked,
    promptPrepend: ($('#prompt-prepend')?.value || '').trim(),
    autoCopy: $('#auto-copy')?.checked || false,
  };
}

function saveSettings() {
  const settings = getSettings();
  chrome.storage.local.set({ userSettings: settings });
}

// ---- Load & Render Custom Prompts ----
async function loadCustomPrompts() {
  try {
    const result = await chrome.storage.local.get('savedCustomPrompts');
    const customPrompts = result.savedCustomPrompts || [];
    const selectEl = $('#prompt-preset');
    if (!selectEl) return;

    // Remove any previously appended custom options
    const existingCustoms = selectEl.querySelectorAll('.custom-preset-option');
    existingCustoms.forEach((opt) => opt.remove());

    customPrompts.forEach((promptText) => {
      const opt = document.createElement('option');
      opt.className = 'custom-preset-option';
      opt.value = promptText;
      const displayLabel = promptText.length > 30 ? promptText.slice(0, 30) + '…' : promptText;
      opt.textContent = `★ ${displayLabel}`;
      selectEl.appendChild(opt);
    });
  } catch (err) {
    console.warn('[YT Transcript Copier] Error loading custom prompts:', err);
  }
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('userSettings');
    const s = result.userSettings || DEFAULT_SETTINGS;

    // Apply format
    $$('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === s.format);
    });
    // Apply toggles
    if ($('#include-timestamps')) $('#include-timestamps').checked = s.timestamps;
    if ($('#include-title')) $('#include-title').checked = s.title;
    if ($('#include-url')) $('#include-url').checked = s.url;
    if ($('#clean-duplicates')) $('#clean-duplicates').checked = s.cleanDuplicates;
    if ($('#auto-copy')) $('#auto-copy').checked = s.autoCopy || false;
    if ($('#prompt-prepend')) $('#prompt-prepend').value = s.promptPrepend || '';

    await loadCustomPrompts();
  } catch { /* ignore storage errors on first run */ }
}

// ---- UI helpers ----
function showState(name, message) {
  Object.values(states).forEach((el) => el.classList.add('hidden'));
  if (states[name]) states[name].classList.remove('hidden');

  if (name === 'success' && $('#success-msg'))
    $('#success-msg').textContent = message || '';
  if (name === 'error' && $('#error-msg'))
    $('#error-msg').textContent = message || '';
}

// ---- Segmented control ----
$$('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    updatePreview();
    saveSettings();
  });
});

// ---- Toggle listeners ----
['#include-timestamps', '#include-title', '#include-url', '#clean-duplicates', '#auto-copy']
  .forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('change', () => { updatePreview(); saveSettings(); });
  });

// ---- Prompt prepend & Preset listeners ----
const promptInput = $('#prompt-prepend');
if (promptInput) {
  promptInput.addEventListener('input', () => { updatePreview(); saveSettings(); });
}

const promptPreset = $('#prompt-preset');
if (promptPreset) {
  promptPreset.addEventListener('change', (e) => {
    if (promptInput) {
      promptInput.value = e.target.value || '';
      updatePreview();
      saveSettings();
    }
  });
}

// ---- Save Custom Prompt Button Handler ----
const savePromptBtn = $('#save-prompt-btn');
if (savePromptBtn) {
  savePromptBtn.addEventListener('click', async () => {
    const val = promptInput?.value?.trim();
    if (!val) {
      showState('error', 'Please enter a prompt first to save it.');
      setTimeout(() => showState('idle'), 2500);
      return;
    }

    try {
      const result = await chrome.storage.local.get('savedCustomPrompts');
      let customPrompts = result.savedCustomPrompts || [];
      
      // Don't add duplicate text
      if (!customPrompts.includes(val)) {
        customPrompts.push(val);
        await chrome.storage.local.set({ savedCustomPrompts: customPrompts });
      }

      await loadCustomPrompts();
      if (promptPreset) promptPreset.value = val;

      showState('success', 'Prompt saved to presets!');
      setTimeout(() => showState('idle'), 2500);
    } catch (err) {
      showState('error', 'Failed to save custom prompt.');
    }
  });
}

// ---- Delete Custom Prompt Button Handler ----
const deletePromptBtn = $('#delete-prompt-btn');
if (deletePromptBtn) {
  deletePromptBtn.addEventListener('click', async () => {
    const val = promptInput?.value?.trim();
    if (!val) {
      showState('error', 'No prompt specified to delete.');
      setTimeout(() => showState('idle'), 2500);
      return;
    }

    try {
      const result = await chrome.storage.local.get('savedCustomPrompts');
      let customPrompts = result.savedCustomPrompts || [];

      if (!customPrompts.includes(val)) {
        showState('error', 'Only saved custom prompts can be deleted.');
        setTimeout(() => showState('idle'), 2500);
        return;
      }

      // Filter out deleted prompt
      customPrompts = customPrompts.filter((p) => p !== val);
      await chrome.storage.local.set({ savedCustomPrompts: customPrompts });

      await loadCustomPrompts();

      if (promptInput) promptInput.value = '';
      if (promptPreset) promptPreset.value = '';

      updatePreview();
      saveSettings();

      showState('success', 'Custom prompt deleted!');
      setTimeout(() => showState('idle'), 2500);
    } catch (err) {
      showState('error', 'Failed to delete custom prompt.');
    }
  });
}



// ---- Multi-language Translations ----
const TRANSLATIONS = {
  en: {
    appTitle: 'Transcript Copier',
    tabSingle: 'Single Video',
    tabBatch: 'Batch Mode',
    batchNoVideos: 'No videos detected',
    batchScanBtn: 'Scan Page',
    batchOverlayBtn: 'Page Overlay',
    batchSelectAll: 'Select All',
    batchSelected: 'selected',
    batchPlaceholder: 'Click "Scan Page" to detect videos on this YouTube page.',
    batchFormatOptions: 'Format & Options',
    outputStyle: 'Output style',
    btnLines: 'Lines',
    btnParagraph: 'Paragraph',
    btnBlocks: 'Blocks',
    toggleTimestamps: 'Include timestamps',
    toggleTitle: 'Include video title',
    toggleUrl: 'Include video URL',
    toggleDuplicates: 'Clean duplicates',
    batchExtracting: 'Extracting transcripts...',
    batchPauseBtn: 'Stop',
    batchResumeBtn: 'Continue',
    batchFinishBtn: 'Finish & Export',
    batchExportAs: 'Export as:',
    batchSingleMerged: 'Single Merged File',
    batchSeparateZip: 'Separate Files (ZIP)',
    batchFileType: 'File type:',
    batchStartExtract: 'Start Extraction',
    batchPlaylistGroup: 'Playlist:',
    batchOtherGroup: 'Other Videos (Bottom / Recommendations)',
    batchVideos: 'videos',
    batchScanning: 'Scanning YouTube page...',
    batchProgressProcessing: 'Processing video',
    batchNavToYouTube: 'Navigate to a YouTube channel, playlist, or video first.',
    batchNoVideosFound: 'No videos found on this page. Try scrolling down to load more.',
    batchScanFailed: 'Failed to scan page. Try refreshing YouTube.',
    batchOverlayInjected: 'Overlay injected! Select videos on the YouTube page.',
    idleHint: 'Navigate to any YouTube video and click the button below to copy its transcript.',
    loadingText: 'Opening transcript & extracting…',
    formatSection: 'Format',
    toggleAutoCopy: 'Auto-copy on video load',
    togglePrompt: 'Prompt prepend',
    promptNoneCustom: 'None / Custom...',
    presetSummarize: 'Summarize (5 Bullets)',
    presetTakeaways: 'Key Takeaways',
    presetOutline: 'Chapter Outline',
    presetTldr: 'TL;DR Summary',
    promptPlaceholder: 'e.g. Summarize this transcript:',
    saveBtn: 'Save',
    deleteBtn: 'Delete',
    aiBridgeLabel: 'Send Prompt + Transcript to AI:',
    previewSection: 'Transcript Workspace',
    savedBtn: 'Saved',
    followBtn: 'Follow',
    notesBtn: 'Notes',
    showAll: 'Show All',
    searchPlaceholder: 'Search transcript... [/]',
    copyTime: 'Copy (+ Time)',
    copyText: 'Copy Text',
    markBtn: 'Mark',
    aiBtn: 'AI',
    summarizeSelected: 'Summarize Selected',
    explainSelected: 'Explain Selected',
    actionItems: 'Action Items',
    translateSelected: 'Translate',
    clearBtn: 'Clear',
    previewPlaceholder: 'Click copy to see a preview here',
    copyBtnText: 'Copy Transcript',
    copyBtn: 'Copy',
    moments: 'moments',
    synthesize: 'Synthesize:',
    savedModalTitle: 'Saved Workspaces',
    savedSearchPlaceholder: 'Search saved transcripts...',
    savedEmptyPlaceholder: 'No saved transcripts yet.\nClick "Save" on any transcript to store it locally.',
    clipNotesTitle: 'Clip Notes',
    clipNotesPlaceholder: 'No bookmarked moments yet. Bookmark moments to compile Clip Notes.',
    ratingTitle: 'Enjoying Transcript Copier?',
    ratingText: 'If this extension saves you time, please take a quick moment to leave a rating on the Chrome Web Store! It helps us keep improving and adding new features.',
    ratingBtnYes: 'Yes, I will',
    ratingBtnNo: 'No thanks',
    ratingBtnNever: "Don't show again",
    aiTokenTitle: 'Large Transcript Warning',
    aiTokenMsg: 'The combined transcript exceeds ~100,000 characters. This may be truncated by the AI model.',
    cancelBtn: 'Cancel',
    sendAnywayBtn: 'Send Anyway',
    feedbackBtn: 'Feedback & Bugs',
    collabBtn: 'Collaborate',
    copiedSuccess: (count) => `Copied ${count} segment${count !== 1 ? 's' : ''} to clipboard!`,
    errors: {
      'not-youtube': 'Navigate to a YouTube video first.',
      'no-active-tab': 'No active tab found. Click on a YouTube tab and try again.',
      'tab-query-failed': 'Could not query browser tabs. Try closing and reopening the extension.',
      'restricted-page': 'Cannot run on this page. Navigate to a youtube.com video.',
      'no-button': 'Could not find "Show transcript" button. Try opening description manually.',
      'no-transcript': 'No transcript segments found on this video.',
      'empty-transcript': 'Transcript panel opened but contains no text.',
      'panel-timeout': 'Clicked transcript button but panel didn\'t open in time.',
      'injection-failed': 'Could not access the page. Try refreshing the YouTube tab.',
      'script-error': 'An internal error occurred. Try refreshing YouTube.',
      'attestation-required': 'YouTube requires verification for this video. Open the video directly in your active tab and try again.',
      'video-unavailable': 'This video is private, removed, or unavailable.',
      'age-restricted': 'This video is age-restricted. Sign in to YouTube in your browser to view its transcript.',
      'no-captions-available': 'No captions or transcript exist for this video.',
    }
  },
  es: {
    appTitle: 'Copiador de Transcripciones',
    tabSingle: 'Video Individual',
    tabBatch: 'Modo por Lotes',
    batchNoVideos: 'No se detectaron videos',
    batchScanBtn: 'Escanear Página',
    batchOverlayBtn: 'Superposición',
    batchSelectAll: 'Seleccionar Todos',
    batchSelected: 'seleccionados',
    batchPlaceholder: 'Haz clic en "Escanear Página" para detectar videos en esta página.',
    batchFormatOptions: 'Formato y Opciones',
    outputStyle: 'Estilo de salida',
    btnLines: 'Líneas',
    btnParagraph: 'Párrafo',
    btnBlocks: 'Bloques',
    toggleTimestamps: 'Incluir marcas de tiempo',
    toggleTitle: 'Incluir título del video',
    toggleUrl: 'Incluir URL del video',
    toggleDuplicates: 'Eliminar duplicados',
    batchExtracting: 'Extrayendo transcripciones...',
    batchPauseBtn: 'Detener',
    batchResumeBtn: 'Continuar',
    batchFinishBtn: 'Finalizar y Exportar',
    batchExportAs: 'Exportar como:',
    batchSingleMerged: 'Archivo Combinado Único',
    batchSeparateZip: 'Archivos Separados (ZIP)',
    batchFileType: 'Tipo de archivo:',
    batchStartExtract: 'Iniciar Extracción',
    batchPlaylistGroup: 'Lista de reproducción:',
    batchOtherGroup: 'Otros Videos (Recomendaciones)',
    batchVideos: 'videos',
    batchScanning: 'Escaneando página de YouTube...',
    batchProgressProcessing: 'Procesando video',
    batchNavToYouTube: 'Navega a un canal, lista o video de YouTube primero.',
    batchNoVideosFound: 'No se encontraron videos. Desplázate hacia abajo para cargar más.',
    batchScanFailed: 'Error al escanear la página. Intenta actualizar YouTube.',
    batchOverlayInjected: '¡Superposición activada! Selecciona videos en la página.',
    idleHint: 'Navega a cualquier video de YouTube y haz clic en el botón para copiar su transcripción.',
    loadingText: 'Abriendo transcripción y extrayendo…',
    formatSection: 'Formato',
    toggleAutoCopy: 'Copia automática al cargar',
    togglePrompt: 'Prefijo de prompt',
    promptNoneCustom: 'Ninguno / Personalizado...',
    presetSummarize: 'Resumir (5 Puntos)',
    presetTakeaways: 'Puntos Clave',
    presetOutline: 'Esquema por Capítulos',
    presetTldr: 'Resumen Breve',
    promptPlaceholder: 'p. ej. Resume esta transcripción:',
    saveBtn: 'Guardar',
    deleteBtn: 'Eliminar',
    aiBridgeLabel: 'Enviar Prompt + Transcripción a la IA:',
    previewSection: 'Espacio de Transcripción',
    savedBtn: 'Guardados',
    followBtn: 'Seguir',
    notesBtn: 'Notas',
    showAll: 'Mostrar Todo',
    searchPlaceholder: 'Buscar en transcripción... [/]',
    copyTime: 'Copiar (+ Hora)',
    copyText: 'Copiar Texto',
    markBtn: 'Marcar',
    aiBtn: 'IA',
    summarizeSelected: 'Resumir Selección',
    explainSelected: 'Explicar Selección',
    actionItems: 'Tareas de Acción',
    translateSelected: 'Traducir',
    clearBtn: 'Limpiar',
    previewPlaceholder: 'Haz clic en copiar para ver una vista previa aquí',
    copyBtnText: 'Copiar Transcripción',
    copyBtn: 'Copiar',
    moments: 'momentos',
    synthesize: 'Sintetizar:',
    savedModalTitle: 'Espacios Guardados',
    savedSearchPlaceholder: 'Buscar en transcripciones guardadas...',
    savedEmptyPlaceholder: 'Aún no hay transcripciones guardadas.\nHaz clic en "Guardar" para almacenarla localmente.',
    clipNotesTitle: 'Notas de Clips',
    clipNotesPlaceholder: 'Aún no hay momentos marcados. Marca momentos para crear Notas.',
    ratingTitle: '¿Disfrutas de Transcript Copier?',
    ratingText: 'Si esta extensión te ahorra tiempo, ¡tómate un momento para dejar una valoración en Chrome Web Store! Nos ayuda a seguir mejorando.',
    ratingBtnYes: 'Sí, calificar ahora',
    ratingBtnNo: 'Ahora no',
    ratingBtnNever: 'No volver a mostrar',
    aiTokenTitle: 'Aviso de Transcripción Extensa',
    aiTokenMsg: 'La transcripción combinada supera los 100.000 caracteres. El modelo de IA podría truncarla.',
    cancelBtn: 'Cancelar',
    sendAnywayBtn: 'Enviar de todos modos',
    feedbackBtn: 'Comentarios y Errores',
    collabBtn: 'Colaborar',
    copiedSuccess: (count) => `¡Copiados ${count} segmento${count !== 1 ? 's' : ''} al portapapeles!`,
    errors: {
      'not-youtube': 'Navega a un video de YouTube primero.',
      'no-active-tab': 'No se encontró pestaña activa de YouTube.',
      'tab-query-failed': 'Error al consultar las pestañas.',
      'restricted-page': 'No se puede ejecutar en esta página.',
      'no-button': 'No se encontró el botón de transcripción.',
      'no-transcript': 'No se encontraron segmentos de transcripción.',
      'empty-transcript': 'El panel de transcripción está vacío.',
      'panel-timeout': 'Tiempo de espera agotado al abrir el panel.',
      'injection-failed': 'No se pudo acceder a la página. Actualiza la pestaña.',
      'script-error': 'Ocurrió un error interno. Intenta actualizar YouTube.',
      'attestation-required': 'YouTube requiere verificación para este video. Ábrelo en tu pestaña activa e inténtalo de nuevo.',
      'video-unavailable': 'Este video es privado, fue eliminado o no está disponible.',
      'age-restricted': 'Este video tiene restricción de edad. Inicia sesión en YouTube para ver su transcripción.',
      'no-captions-available': 'No existen subtítulos ni transcripción para este video.',
    }
  },
  pt: {
    appTitle: 'Copiador de Transcrição',
    tabSingle: 'Vídeo Individual',
    tabBatch: 'Modo em Lote',
    batchNoVideos: 'Nenhum vídeo detectado',
    batchScanBtn: 'Escanear Página',
    batchOverlayBtn: 'Sobreposição',
    batchSelectAll: 'Selecionar Todos',
    batchSelected: 'selecionados',
    batchPlaceholder: 'Clique em "Escanear Página" para detectar vídeos nesta página.',
    batchFormatOptions: 'Formato e Opções',
    outputStyle: 'Estilo de saída',
    btnLines: 'Linhas',
    btnParagraph: 'Parágrafo',
    btnBlocks: 'Blocos',
    toggleTimestamps: 'Incluir marcas de tempo',
    toggleTitle: 'Incluir título do vídeo',
    toggleUrl: 'Incluir URL do vídeo',
    toggleDuplicates: 'Limpar duplicados',
    batchExtracting: 'Extraindo transcrições...',
    batchPauseBtn: 'Parar',
    batchResumeBtn: 'Continuar',
    batchFinishBtn: 'Finalizar e Exportar',
    batchExportAs: 'Exportar como:',
    batchSingleMerged: 'Arquivo Único Mesclado',
    batchSeparateZip: 'Arquivos Separados (ZIP)',
    batchFileType: 'Tipo de arquivo:',
    batchStartExtract: 'Iniciar Extração',
    batchPlaylistGroup: 'Playlist:',
    batchOtherGroup: 'Outros Vídeos (Recomendações)',
    batchVideos: 'vídeos',
    batchScanning: 'Escaneando página do YouTube...',
    batchProgressProcessing: 'Processando vídeo',
    batchNavToYouTube: 'Navegue para um canal, playlist ou vídeo do YouTube primeiro.',
    batchNoVideosFound: 'Nenhum vídeo encontrado. Role para baixo para carregar mais.',
    batchScanFailed: 'Falha ao escanear a página. Tente atualizar o YouTube.',
    batchOverlayInjected: 'Sobreposição ativada! Selecione vídeos na página.',
    idleHint: 'Navegue até qualquer vídeo do YouTube e clique no botão abaixo para copiar a transcrição.',
    loadingText: 'Abrindo transcrição e extraindo…',
    formatSection: 'Formato',
    toggleAutoCopy: 'Copiar automaticamente',
    togglePrompt: 'Prefixo do prompt',
    promptNoneCustom: 'Nenhum / Personalizado...',
    presetSummarize: 'Resumir (5 Tópicos)',
    presetTakeaways: 'Principais Conclusões',
    presetOutline: 'Estrutura dos Capítulos',
    presetTldr: 'Resumo Rápido',
    promptPlaceholder: 'ex.: Resuma esta transcrição:',
    saveBtn: 'Salvar',
    deleteBtn: 'Excluir',
    aiBridgeLabel: 'Enviar Prompt + Transcrição para IA:',
    previewSection: 'Área de Trabalho da Transcrição',
    savedBtn: 'Salvos',
    followBtn: 'Seguir',
    notesBtn: 'Notas',
    showAll: 'Mostrar Todos',
    searchPlaceholder: 'Pesquisar na transcrição... [/]',
    copyTime: 'Copiar (+ Tempo)',
    copyText: 'Copiar Texto',
    markBtn: 'Marcar',
    aiBtn: 'IA',
    summarizeSelected: 'Resumir Selecionado',
    explainSelected: 'Explicar Selecionado',
    actionItems: 'Itens de Ação',
    translateSelected: 'Traduzir',
    clearBtn: 'Limpar',
    previewPlaceholder: 'Clique em copiar para ver uma prévia aqui',
    copyBtnText: 'Copiar Transcrição',
    copyBtn: 'Copiar',
    moments: 'momentos',
    synthesize: 'Sintetizar:',
    savedModalTitle: 'Áreas Salvas',
    savedSearchPlaceholder: 'Pesquisar transcrições salvas...',
    savedEmptyPlaceholder: 'Nenhuma transcrição salva ainda.\nClique em "Salvar" para guardar localmente.',
    clipNotesTitle: 'Notas de Trechos',
    clipNotesPlaceholder: 'Nenhum momento salvo ainda. Marque momentos para criar Notas.',
    ratingTitle: 'Gostando do Transcript Copier?',
    ratingText: 'Se esta extensão economiza seu tempo, por favor reserve um momento para avaliá-la na Chrome Web Store! Ajuda muito a continuar melhorando.',
    ratingBtnYes: 'Sim, vou avaliar',
    ratingBtnNo: 'Agora não',
    ratingBtnNever: 'Não mostrar novamente',
    aiTokenTitle: 'Aviso de Transcrição Longa',
    aiTokenMsg: 'A transcrição combinada ultrapassa ~100.000 caracteres. Pode ser truncada pelo modelo de IA.',
    cancelBtn: 'Cancelar',
    sendAnywayBtn: 'Enviar mesmo assim',
    feedbackBtn: 'Comentários e Bugs',
    collabBtn: 'Colaborar',
    copiedSuccess: (count) => `Copiado ${count} segmento${count !== 1 ? 's' : ''} para a área de transferência!`,
    errors: {
      'not-youtube': 'Navegue para um vídeo do YouTube primeiro.',
      'no-active-tab': 'Nenhuma aba ativa do YouTube encontrada.',
      'tab-query-failed': 'Falha ao consultar as abas do navegador.',
      'restricted-page': 'Não é possível executar nesta página.',
      'no-button': 'Botão de transcrição não encontrado.',
      'no-transcript': 'Nenhum segmento de transcrição encontrado.',
      'empty-transcript': 'Painel de transcrição está vazio.',
      'panel-timeout': 'O painel não abriu a tempo.',
      'injection-failed': 'Não foi possível acessar a página.',
      'script-error': 'Ocorreu um erro interno. Atualize o YouTube.',
      'attestation-required': 'O YouTube requer verificação para este vídeo. Abra o vídeo diretamente na sua guia e tente novamente.',
      'video-unavailable': 'Este vídeo é privado, foi removido ou está indisponível.',
      'age-restricted': 'Este vídeo tem restrição de idade. Faça login no YouTube para ver a transcrição.',
      'no-captions-available': 'Não há legendas ou transcrição para este vídeo.',
    }
  },
  tr: {
    appTitle: 'Transkript Kopyalayıcı',
    tabSingle: 'Tek Video',
    tabBatch: 'Toplu Mod',
    batchNoVideos: 'Video bulunamadı',
    batchScanBtn: 'Sayfayı Tara',
    batchOverlayBtn: 'Sayfa Katmanı',
    batchSelectAll: 'Tümünü Seç',
    batchSelected: 'seçildi',
    batchPlaceholder: 'Bu sayfadaki videoları bulmak için "Sayfayı Tara" butonuna tıklayın.',
    batchFormatOptions: 'Biçim ve Seçenekler',
    outputStyle: 'Çıkartma stili',
    btnLines: 'Satırlar',
    btnParagraph: 'Paragraf',
    btnBlocks: 'Bloklar',
    toggleTimestamps: 'Zaman damgalarını ekle',
    toggleTitle: 'Video başlığını ekle',
    toggleUrl: 'Video bağlantısını ekle',
    toggleDuplicates: 'Yinelenenleri temizle',
    batchExtracting: 'Transkriptler çıkarılıyor...',
    batchPauseBtn: 'Durdur',
    batchResumeBtn: 'Devam Et',
    batchFinishBtn: 'Bitir ve Dışa Aktar',
    batchExportAs: 'Farklı aktar:',
    batchSingleMerged: 'Tek Birleştirilmiş Dosya',
    batchSeparateZip: 'Ayrı Dosyalar (ZIP)',
    batchFileType: 'Dosya türü:',
    batchStartExtract: 'Çıkarmayı Başlat',
    batchPlaylistGroup: 'Oynatma Listesi:',
    batchOtherGroup: 'Diğer Videolar (Öneriler)',
    batchVideos: 'video',
    batchScanning: 'YouTube sayfası taranıyor...',
    batchProgressProcessing: 'İşlenen video',
    batchNavToYouTube: 'Önce bir YouTube kanalına, oynatma listesine veya videoya gidin.',
    batchNoVideosFound: 'Bu sayfada video bulunamadı. Daha fazlası için aşağı kaydırın.',
    batchScanFailed: 'Sayfa taranamadı. YouTube sayfasını yenileyin.',
    batchOverlayInjected: 'Katman eklendi! Videoları YouTube sayfasından seçin.',
    idleHint: 'Herhangi bir YouTube videosuna gidin ve transkriptini kopyalamak için aşağıdaki butona tıklayın.',
    loadingText: 'Transkript açılıyor ve çıkarılıyor…',
    formatSection: 'Biçim',
    toggleAutoCopy: 'Video açıldığında otomatik kopyala',
    togglePrompt: 'İstem ön eki',
    promptNoneCustom: 'Hiçbiri / Özel...',
    presetSummarize: 'Özetle (5 Madde)',
    presetTakeaways: 'Önemli Çıkarımlar',
    presetOutline: 'Bölüm Özeti',
    presetTldr: 'Kısa Özet (TL;DR)',
    promptPlaceholder: 'ör. Bu transkripti özetle:',
    saveBtn: 'Kaydet',
    deleteBtn: 'Sil',
    aiBridgeLabel: 'İstemi ve Transkripti Yapay Zekaya Gönder:',
    previewSection: 'Transkript Çalışma Alanı',
    savedBtn: 'Kayıtlılar',
    followBtn: 'Takip Et',
    notesBtn: 'Notlar',
    showAll: 'Tümünü Göster',
    searchPlaceholder: 'Transkriptte ara... [/]',
    copyTime: 'Kopyala (+ Zaman)',
    copyText: 'Metni Kopyala',
    markBtn: 'İşaretle',
    aiBtn: 'YZ',
    summarizeSelected: 'Seçilenleri Özetle',
    explainSelected: 'Seçilenleri Açıkla',
    actionItems: 'Eylem Maddeleri',
    translateSelected: 'Çevir',
    clearBtn: 'Temizle',
    previewPlaceholder: 'Önizlemeyi görmek için kopyala butonuna tıklayın',
    copyBtnText: 'Transkripti Kopyala',
    copyBtn: 'Kopyala',
    moments: 'an',
    synthesize: 'Özetle / Birleştir:',
    savedModalTitle: 'Kayıtlı Çalışma Alanları',
    savedSearchPlaceholder: 'Kayıtlı transkriptlerde ara...',
    savedEmptyPlaceholder: 'Henüz kaydedilmiş transkript yok.\nYerel olarak saklamak için "Kaydet"e tıklayın.',
    clipNotesTitle: 'Klip Notları',
    clipNotesPlaceholder: 'Henüz işaretlenmiş an yok. Not oluşturmak için anları işaretleyin.',
    ratingTitle: 'Transcript Copier\'ı sevdiniz mi?',
    ratingText: 'Bu uzantı size zaman kazandırıyorsa, lütfen Chrome Web Mağazası\'nda değerlendirme yaparak bizi destekleyin! Geliştirmemize çok yardımcı olur.',
    ratingBtnYes: 'Evet, değerlendireceğim',
    ratingBtnNo: 'Şimdi değil',
    ratingBtnNever: 'Tekrar gösterme',
    aiTokenTitle: 'Büyük Transkript Uyarısı',
    aiTokenMsg: 'Birleştirilmiş transkript ~100.000 karakteri aşıyor. Yapay zeka modeli metni kısaltabilir.',
    cancelBtn: 'İptal',
    sendAnywayBtn: 'Yine de Gönder',
    feedbackBtn: 'Geri Bildirim & Hata',
    collabBtn: 'İşbirliği Yap',
    copiedSuccess: (count) => `${count} bölüm panoya kopyalandı!`,
    errors: {
      'not-youtube': 'Önce bir YouTube videosuna gidin.',
      'no-active-tab': 'Aktif YouTube sekmesi bulunamadı.',
      'tab-query-failed': 'Sekmeler sorgulanamadı.',
      'restricted-page': 'Bu sayfada çalıştırılamaz.',
      'no-button': 'Transkript butonu bulunamadı.',
      'no-transcript': 'Transkript metni bulunamadı.',
      'empty-transcript': 'Transkript paneli boş.',
      'panel-timeout': 'Transkript paneli zamanında açılmadı.',
      'injection-failed': 'Sayfaya erişilemedi. Sayfayı yenileyin.',
      'script-error': 'Dahili bir hata oluştu.',
      'attestation-required': 'YouTube bu video için doğrulama istiyor. Videoyu aktif sekmede açıp tekrar deneyin.',
      'video-unavailable': 'Bu video gizli, kaldırılmış veya kullanılamıyor.',
      'age-restricted': 'Bu videoda yaş kısıtlaması var. Transkripti görmek için YouTube oturumu açın.',
      'no-captions-available': 'Bu video için altyazı veya transkript bulunmuyor.',
    }
  },
  fr: {
    appTitle: 'Copieur de Transcription',
    tabSingle: 'Vidéo Unique',
    tabBatch: 'Mode Lot',
    batchNoVideos: 'Aucune vidéo détectée',
    batchScanBtn: 'Scanner la Page',
    batchOverlayBtn: 'Superposition',
    batchSelectAll: 'Tout Sélectionner',
    batchSelected: 'sélectionnés',
    batchPlaceholder: 'Cliquez sur "Scanner la Page" pour détecter les vidéos de cette page.',
    batchFormatOptions: 'Format et Options',
    outputStyle: 'Style de sortie',
    btnLines: 'Lignes',
    btnParagraph: 'Paragraphe',
    btnBlocks: 'Blocs',
    toggleTimestamps: 'Inclure l\'horodatage',
    toggleTitle: 'Inclure le titre de la vidéo',
    toggleUrl: 'Inclure l\'URL de la vidéo',
    toggleDuplicates: 'Nettoyer les doublons',
    batchExtracting: 'Extraction des transcriptions...',
    batchPauseBtn: 'Arrêter',
    batchResumeBtn: 'Continuer',
    batchFinishBtn: 'Terminer et Exporter',
    batchExportAs: 'Exporter comme :',
    batchSingleMerged: 'Fichier Unique Fusionné',
    batchSeparateZip: 'Fichiers Séparés (ZIP)',
    batchFileType: 'Type de fichier :',
    batchStartExtract: 'Démarrer l\'Extraction',
    batchPlaylistGroup: 'Playlist :',
    batchOtherGroup: 'Autres Vidéos (Recommandations)',
    batchVideos: 'vidéos',
    batchScanning: 'Analyse de la page YouTube...',
    batchProgressProcessing: 'Traitement de la vidéo',
    batchNavToYouTube: 'Veuillez naviguer vers une chaîne, playlist ou vidéo YouTube d\'abord.',
    batchNoVideosFound: 'Aucune vidéo trouvée. Faites défiler vers le bas pour charger plus.',
    batchScanFailed: 'Échec de l\'analyse. Essayez d\'actualiser YouTube.',
    batchOverlayInjected: 'Superposition activée ! Sélectionnez les vidéos sur la page.',
    idleHint: 'Accédez à une vidéo YouTube et cliquez sur le bouton pour copier sa transcription.',
    loadingText: 'Ouverture de la transcription et extraction…',
    formatSection: 'Format',
    toggleAutoCopy: 'Copie automatique au chargement',
    togglePrompt: 'Préfixe d\'instruction',
    promptNoneCustom: 'Aucun / Personnalisé...',
    presetSummarize: 'Résumer (5 Points)',
    presetTakeaways: 'Points Clés',
    presetOutline: 'Plan des Chapitres',
    presetTldr: 'Résumé Rapide',
    promptPlaceholder: 'ex. : Résumez cette transcription :',
    saveBtn: 'Enregistrer',
    deleteBtn: 'Supprimer',
    aiBridgeLabel: 'Envoyer l\'instruction + transcription à l\'IA :',
    previewSection: 'Espace de Transcription',
    savedBtn: 'Enregistrés',
    followBtn: 'Suivre',
    notesBtn: 'Notes',
    showAll: 'Afficher Tout',
    searchPlaceholder: 'Rechercher dans le texte... [/]',
    copyTime: 'Copier (+ Heure)',
    copyText: 'Copier le Texte',
    markBtn: 'Marquer',
    aiBtn: 'IA',
    summarizeSelected: 'Résumer la Sélection',
    explainSelected: 'Expliquer la Sélection',
    actionItems: 'Actions à Mener',
    translateSelected: 'Traduire',
    clearBtn: 'Effacer',
    previewPlaceholder: 'Cliquez sur copier pour voir un aperçu ici',
    copyBtnText: 'Copier la Transcription',
    copyBtn: 'Copier',
    moments: 'moments',
    synthesize: 'Synthétiser :',
    savedModalTitle: 'Espaces Enregistrés',
    savedSearchPlaceholder: 'Rechercher dans les enregistrements...',
    savedEmptyPlaceholder: 'Aucune transcription enregistrée pour le moment.\nCliquez sur "Enregistrer" pour la stocker localement.',
    clipNotesTitle: 'Notes d\'Extraits',
    clipNotesPlaceholder: 'Aucun moment marqué. Marquez des passages pour compiler vos Notes.',
    ratingTitle: 'Vous appréciez Transcript Copier ?',
    ratingText: 'Si cette extension vous fait gagner du temps, prenez un instant pour laisser un avis sur le Chrome Web Store ! Cela nous aide énormément.',
    ratingBtnYes: 'Oui, avec plaisir',
    ratingBtnNo: 'Non merci',
    ratingBtnNever: 'Ne plus afficher',
    aiTokenTitle: 'Avertissement : Transcription Volumineuse',
    aiTokenMsg: 'La transcription combinée dépasse ~100 000 caractères. Elle risque d\'être tronquée par l\'IA.',
    cancelBtn: 'Annuler',
    sendAnywayBtn: 'Envoyer quand même',
    feedbackBtn: 'Avis & Bugs',
    collabBtn: 'Collaborer',
    copiedSuccess: (count) => `${count} segment${count !== 1 ? 's' : ''} copié${count !== 1 ? 's' : ''} dans le presse-papiers !`,
    errors: {
      'not-youtube': 'Veuillez naviguer vers une vidéo YouTube.',
      'no-active-tab': 'Aucun onglet YouTube actif trouvé.',
      'tab-query-failed': 'Impossible de requêter les onglets.',
      'restricted-page': 'Impossible de s\'exécuter sur cette page.',
      'no-button': 'Bouton de transcription introuvable.',
      'no-transcript': 'Aucun segment de transcription trouvé.',
      'empty-transcript': 'Le panneau de transcription est vide.',
      'panel-timeout': 'Le panneau ne s\'est pas ouvert à temps.',
      'injection-failed': 'Impossible d\'accéder à la page.',
      'script-error': 'Une erreur interne est survenue.',
      'attestation-required': 'YouTube requiert une vérification pour cette vidéo. Ouvrez-la dans votre onglet actif et réessayez.',
      'video-unavailable': 'Cette vidéo est privée, supprimée ou indisponible.',
      'age-restricted': 'Cette vidéo est soumise à une limite d\'âge. Connectez-vous à YouTube pour voir la transcription.',
      'no-captions-available': 'Aucun sous-titre ni transcription n\'existe pour cette vidéo.',
    }
  },
  de: {
    appTitle: 'Transkript-Kopierer',
    tabSingle: 'Einzelnes Video',
    tabBatch: 'Stapelmodus',
    batchNoVideos: 'Keine Videos erkannt',
    batchScanBtn: 'Seite scannen',
    batchOverlayBtn: 'Seiten-Overlay',
    batchSelectAll: 'Alle auswählen',
    batchSelected: 'ausgewählt',
    batchPlaceholder: 'Klicken Sie auf "Seite scannen", um Videos auf dieser Seite zu erkennen.',
    batchFormatOptions: 'Format & Optionen',
    outputStyle: 'Ausgabestil',
    btnLines: 'Zeilen',
    btnParagraph: 'Absatz',
    btnBlocks: 'Blöcke',
    toggleTimestamps: 'Zeitstempel einschließen',
    toggleTitle: 'Videotitel einschließen',
    toggleUrl: 'Video-URL einschließen',
    toggleDuplicates: 'Duplikate entfernen',
    batchExtracting: 'Transkripte werden extrahiert...',
    batchPauseBtn: 'Anhalten',
    batchResumeBtn: 'Fortsetzen',
    batchFinishBtn: 'Fertigstellen & Exportieren',
    batchExportAs: 'Exportieren als:',
    batchSingleMerged: 'Einzelne zusammengeführte Datei',
    batchSeparateZip: 'Separate Dateien (ZIP)',
    batchFileType: 'Dateityp:',
    batchStartExtract: 'Extraktion starten',
    batchPlaylistGroup: 'Wiedergabeliste:',
    batchOtherGroup: 'Weitere Videos (Empfehlungen)',
    batchVideos: 'Videos',
    batchScanning: 'YouTube-Seite wird gescannt...',
    batchProgressProcessing: 'Video wird verarbeitet',
    batchNavToYouTube: 'Bitte zuerst zu einem YouTube-Kanal, einer Playlist oder einem Video navigieren.',
    batchNoVideosFound: 'Keine Videos gefunden. Scrollen Sie nach unten, um mehr zu laden.',
    batchScanFailed: 'Seite konnte nicht gescannt werden. Aktualisieren Sie YouTube.',
    batchOverlayInjected: 'Overlay aktiviert! Wählen Sie Videos auf der YouTube-Seite aus.',
    idleHint: 'Navigieren Sie zu einem YouTube-Video und klicken Sie unten auf Kopieren.',
    loadingText: 'Transkript wird geöffnet und extrahiert…',
    formatSection: 'Format',
    toggleAutoCopy: 'Beim Laden automatisch kopieren',
    togglePrompt: 'Prompt-Präfix',
    promptNoneCustom: 'Kein / Benutzerdefiniert...',
    presetSummarize: 'Zusammenfassen (5 Punkte)',
    presetTakeaways: 'Wichtigste Erkenntnisse',
    presetOutline: 'Kapitelgliederung',
    presetTldr: 'Kurzzusammenfassung',
    promptPlaceholder: 'z.B. Fasse dieses Transkript zusammen:',
    saveBtn: 'Speichern',
    deleteBtn: 'Löschen',
    aiBridgeLabel: 'Prompt + Transkript an KI senden:',
    previewSection: 'Transkript-Arbeitsbereich',
    savedBtn: 'Gespeichert',
    followBtn: 'Folgen',
    notesBtn: 'Notizen',
    showAll: 'Alle anzeigen',
    searchPlaceholder: 'Transkript durchsuchen... [/]',
    copyTime: 'Kopieren (+ Zeit)',
    copyText: 'Text kopieren',
    markBtn: 'Markieren',
    aiBtn: 'KI',
    summarizeSelected: 'Auswahl zusammenfassen',
    explainSelected: 'Auswahl erklären',
    actionItems: 'Aktionspunkte',
    translateSelected: 'Übersetzen',
    clearBtn: 'Löschen',
    previewPlaceholder: 'Klicken Sie auf Kopieren für eine Vorschau',
    copyBtnText: 'Transkript kopieren',
    copyBtn: 'Kopieren',
    moments: 'Momente',
    synthesize: 'Zusammenfassen:',
    savedModalTitle: 'Gespeicherte Arbeitsbereiche',
    savedSearchPlaceholder: 'Gespeicherte Transkripte durchsuchen...',
    savedEmptyPlaceholder: 'Noch keine Transkripte gespeichert.\nKlicken Sie auf "Speichern", um sie lokal abzuspeichern.',
    clipNotesTitle: 'Clip-Notizen',
    clipNotesPlaceholder: 'Noch keine Momente markiert. Markieren Sie Momente für Notizen.',
    ratingTitle: 'Gefällt Ihnen Transcript Copier?',
    ratingText: 'Wenn diese Erweiterung Ihnen Zeit spart, hinterlassen Sie bitte eine kurze Bewertung im Chrome Web Store! Es hilft uns bei Verbesserungen.',
    ratingBtnYes: 'Ja, gerne bewerten',
    ratingBtnNo: 'Nein danke',
    ratingBtnNever: 'Nicht mehr anzeigen',
    aiTokenTitle: 'Warnung: Großes Transkript',
    aiTokenMsg: 'Das kombinierte Transkript überschreitet ~100.000 Zeichen. Es könnte von der KI gekürzt werden.',
    cancelBtn: 'Abbrechen',
    sendAnywayBtn: 'Trotzdem senden',
    feedbackBtn: 'Feedback & Fehler',
    collabBtn: 'Zusammenarbeiten',
    copiedSuccess: (count) => `${count} Segment${count !== 1 ? 'e' : ''} in die Zwischenablage kopiert!`,
    errors: {
      'not-youtube': 'Bitte zuerst zu einem YouTube-Video navigieren.',
      'no-active-tab': 'Kein aktiver YouTube-Tab gefunden.',
      'tab-query-failed': 'Fehler beim Abfragen der Tabs.',
      'restricted-page': 'Auf dieser Seite nicht verfügbar.',
      'no-button': 'Transkript-Schaltfläche nicht gefunden.',
      'no-transcript': 'Keine Transkript-Segmente gefunden.',
      'empty-transcript': 'Transkript-Bereich ist leer.',
      'panel-timeout': 'Transkript-Bereich öffnete nicht rechtzeitig.',
      'injection-failed': 'Zugriff auf die Seite fehlgeschlagen.',
      'script-error': 'Ein interner Fehler ist aufgetreten.',
      'attestation-required': 'YouTube erfordert eine Verifizierung für dieses Video. Öffnen Sie das Video direkt im aktiven Tab und versuchen Sie es erneut.',
      'video-unavailable': 'Dieses Video ist privat, entfernt oder nicht verfügbar.',
      'age-restricted': 'Dieses Video ist altersbeschränkt. Melden Sie sich bei YouTube an, um das Transkript anzuzeigen.',
      'no-captions-available': 'Für dieses Video existieren keine Untertitel oder Transkripte.',
    }
  },
  ar: {
    appTitle: 'نسخ نص الفيديو',
    tabSingle: 'فيديو فردي',
    tabBatch: 'الوضع المتعدد',
    batchNoVideos: 'لم يتم العثور على مقاطع',
    batchScanBtn: 'فحص الصفحة',
    batchOverlayBtn: 'تراكب الصفحة',
    batchSelectAll: 'تحديد الكل',
    batchSelected: 'محدد',
    batchPlaceholder: 'انقر على "فحص الصفحة" لاكتشاف الفيديوهات على هذه الصفحة.',
    batchFormatOptions: 'التنسيق والخيارات',
    outputStyle: 'نمط الإخراج',
    btnLines: 'أسطر',
    btnParagraph: 'فقرة',
    btnBlocks: 'كتل',
    toggleTimestamps: 'تضمين الطوابع الزمنية',
    toggleTitle: 'تضمين عنوان الفيديو',
    toggleUrl: 'تضمين رابط الفيديو',
    toggleDuplicates: 'إزالة التكرار',
    batchExtracting: 'جاري استخراج النصوص...',
    batchPauseBtn: 'إيقاف',
    batchResumeBtn: 'استئناف',
    batchFinishBtn: 'إنهاء وتصدير',
    batchExportAs: 'تصدير كـ:',
    batchSingleMerged: 'ملف مدمج واحد',
    batchSeparateZip: 'ملفات منفصلة (ZIP)',
    batchFileType: 'نوع الملف:',
    batchStartExtract: 'بدء الاستخراج',
    batchPlaylistGroup: 'قائمة التشغيل:',
    batchOtherGroup: 'مقاطع فيديو أخرى (المقترحات)',
    batchVideos: 'فيديوهات',
    batchScanning: 'جاري فحص صفحة YouTube...',
    batchProgressProcessing: 'جاري معالجة الفيديو',
    batchNavToYouTube: 'يرجى الانتقال إلى قناة أو قائمة تشغيل أو فيديو YouTube أولاً.',
    batchNoVideosFound: 'لم يتم العثور على أي مقاطع. قم بالتمرير لأسفل لتحميل المزيد.',
    batchScanFailed: 'تعذر فحص الصفحة. حاول تحديث صفحة YouTube.',
    batchOverlayInjected: 'تم تفعيل تراكب الصفحة! اختر الفيديوهات مباشرة من الصفحة.',
    idleHint: 'افتح أي فيديو على YouTube وانقر على الزر أدناه لنسخ نص الفيديو.',
    loadingText: 'جاري فتح النص واستخراجه…',
    formatSection: 'التنسيق',
    toggleAutoCopy: 'نسخ تلقائي عند تشغيل الفيديو',
    togglePrompt: 'بادئة التوجيه (Prompt)',
    promptNoneCustom: 'لا يوجد / مخصص...',
    presetSummarize: 'تلخيص (5 نقاط)',
    presetTakeaways: 'أهم النقاط والفوائد',
    presetOutline: 'مخطط الفصول',
    presetTldr: 'ملخص سريع وموجز',
    promptPlaceholder: 'مثال: لخص هذا النص في 5 نقاط:',
    saveBtn: 'حفظ',
    deleteBtn: 'حذف',
    aiBridgeLabel: 'إرسال التوجيه والنص إلى الذكاء الاصطناعي:',
    previewSection: 'مساحة عمل النص',
    savedBtn: 'المحفوظات',
    followBtn: 'متابعة',
    notesBtn: 'ملاحظات',
    showAll: 'عرض الكل',
    searchPlaceholder: 'البحث في النص... [/]',
    copyTime: 'نسخ (+ الوقت)',
    copyText: 'نسخ النص',
    markBtn: 'تمييز',
    aiBtn: 'ذكاء اصطناعي',
    summarizeSelected: 'تلخيص المحدد',
    explainSelected: 'شرح المحدد',
    actionItems: 'نقاط العمل',
    translateSelected: 'ترجمة',
    clearBtn: 'مسح',
    previewPlaceholder: 'انقر على نسخ لرؤية المعاينة هنا',
    copyBtnText: 'نسخ نص الفيديو',
    copyBtn: 'نسخ',
    moments: 'لحظات',
    synthesize: 'تجميع وتلخيص:',
    savedModalTitle: 'مساحات العمل المحفوظة',
    savedSearchPlaceholder: 'البحث في النصوص المحفوظة...',
    savedEmptyPlaceholder: 'لا توجد نصوص محفوظة حتى الآن.\nانقر على "حفظ" لتخزين أي نص محلياً.',
    clipNotesTitle: 'ملاحظات المقاطع',
    clipNotesPlaceholder: 'لا توجد لحظات مميزة حتى الآن. قم بتمييز اللحظات لتجميع الملاحظات.',
    ratingTitle: 'هل يعجبك ناسخ النصوص؟',
    ratingText: 'إذا وفرت لك هذه الإضافة الوقت، يُرجى تقييمنا على سوق Chrome الإلكتروني! تقييمك يساعدنا على التطوير وإضافة ميزات جديدة.',
    ratingBtnYes: 'نعم، بكل سرور',
    ratingBtnNo: 'ليس الآن',
    ratingBtnNever: 'عدم الإظهار مجدداً',
    aiTokenTitle: 'تحذير: نص كبير الحجم',
    aiTokenMsg: 'يتجاوز النص المجمع 100,000 حرف. قد يقوم نموذج الذكاء الاصطناعي باقتطاعه.',
    cancelBtn: 'إلغاء',
    sendAnywayBtn: 'إرسال على أي حال',
    feedbackBtn: 'آراء وبلاغ عن خطأ',
    collabBtn: 'التعاون معنا',
    copiedSuccess: (count) => `تم نسخ ${count} مقطع بنجاح إلى الحافظة!`,
    errors: {
      'not-youtube': 'يرجى الانتقال إلى فيديو YouTube أولاً.',
      'no-active-tab': 'لم يتم العثور على تبويب YouTube نشط.',
      'tab-query-failed': 'تعذر الاستعلام عن تبويبات المتصفح.',
      'restricted-page': 'لا يمكن التشغيل على هذه الصفحة.',
      'no-button': 'لم يتم العثور على زر التفرغ النصي.',
      'no-transcript': 'لم يتم العثور على أي مقاطع نصية.',
      'empty-transcript': 'لوحة النص فارغة.',
      'panel-timeout': 'لم تفتح لوحة النص في الوقت المحدد.',
      'injection-failed': 'تعذر الوصول إلى الصفحة.',
      'script-error': 'حدث خطأ داخلي. حاول تحديث الصفحة.',
      'attestation-required': 'يتطلب YouTube التحقق من هذا الفيديو. افتح الفيديو مباشرة في علامة التبويب النشطة وحاول مرة أخرى.',
      'video-unavailable': 'هذا الفيديو خاص أو تم حذفه أو غير متوفر.',
      'age-restricted': 'هذا الفيديو يخضع لقيود العمر. سجّل الدخول إلى YouTube لعرض النص.',
      'no-captions-available': 'لا توجد ترجمات أو نصوص متاحة لهذا الفيديو.',
    }
  }
};

let currentLang = 'en';

function getTranslation(key, placeholders = []) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  const val = dict[key];
  if (typeof val === 'function') {
    return val(...placeholders);
  }
  if (val) return val;

  // Fallback to chrome.i18n.getMessage
  if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
    const msg = chrome.i18n.getMessage(key, placeholders);
    if (msg) return msg;
  }

  return TRANSLATIONS.en[key] || '';
}

function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) lang = 'en';
  currentLang = lang;
  localStorage.setItem('appLang', lang);

  // Update HTML text elements
  $$('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    const txt = getTranslation(key);
    if (txt && typeof txt === 'string') {
      el.textContent = txt;
    }
  });

  // Update placeholders
  $$('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    const txt = getTranslation(key);
    if (txt && typeof txt === 'string') {
      el.placeholder = txt;
    }
  });

  // Update titles/tooltips
  $$('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    const txt = getTranslation(key);
    if (txt && typeof txt === 'string') {
      el.title = txt;
    }
  });

  // Handle RTL for Arabic
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Update dynamic batch counters & video list if active
  if (typeof updateBatchSelectedCount === 'function') {
    updateBatchSelectedCount();
  }
  if (typeof updateSelectionBar === 'function') {
    updateSelectionBar();
  }
  if (typeof renderBatchVideoList === 'function' && Array.isArray(batchVideos) && batchVideos.length > 0) {
    renderBatchVideoList();
  }

  // Update preview placeholder if box is empty
  updatePreview();
}

// Auto-detect browser language or load saved setting
function initLanguage() {
  const saved = localStorage.getItem('appLang');
  if (saved && TRANSLATIONS[saved]) {
    currentLang = saved;
  } else {
    const uiLang = (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function')
      ? chrome.i18n.getUILanguage()
      : (navigator.language || '');
    const browserLang = (uiLang || '').slice(0, 2).toLowerCase();
    if (TRANSLATIONS[browserLang]) {
      currentLang = browserLang;
    }
  }

  const langSelect = $('#lang-select');
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener('change', (e) => setLanguage(e.target.value));
  }

  setLanguage(currentLang);
}

// Initialize i18n on DOM load
document.addEventListener('DOMContentLoaded', initLanguage);

// ---- Feedback / Collaborate links ----
function buildMailtoLink(subject) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(
    `\n\n---\nExtension: YouTube Transcript Copier v${EXT_VERSION}\nBrowser: ${navigator.userAgent}\n`
  );
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${FEEDBACK_EMAIL}&su=${s}&body=${b}`;
}

const feedbackLink = $('#feedback-link');
if (feedbackLink) {
  feedbackLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: buildMailtoLink('Bug Report / Feedback — YT Transcript Copier') });
  });
}

const collabLink = $('#collab-link');
if (collabLink) {
  collabLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: buildMailtoLink('Collaboration Inquiry — YT Transcript Copier') });
  });
}

// ---- Helpers: Shorts detection & tab navigation ----

/** Extract video ID from a YouTube Shorts URL. Returns null if not a Shorts URL. */
function getShortsVideoId(url) {
  if (!url) return null;
  const match = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Extract video ID from a standard YouTube watch URL. Returns null if not found. */
function getWatchVideoId(url) {
  if (!url) return null;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Extract any video ID (watch or shorts) from URL. */
function getVideoIdFromUrl(url) {
  return getWatchVideoId(url) || getShortsVideoId(url) || null;
}

/** Check if a URL is any supported YouTube video page. */
function isYouTubeVideo(url) {
  if (!url) return false;
  return url.includes('youtube.com/watch') || url.includes('youtube.com/shorts/');
}

/** Wait for a tab to finish loading after navigation. */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab-load-timeout'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---- Content script injection ----
async function extractTranscript(requestedLang) {
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs?.[0];
  } catch (err) {
    return { success: false, error: 'tab-query-failed', detail: String(err) };
  }

  if (!tab) {
    return { success: false, error: 'no-active-tab' };
  }

  if (!isYouTubeVideo(tab.url)) {
    return { success: false, error: 'not-youtube' };
  }

  const activeTabId = tab.id;

  // ---- Shorts redirect: navigate to /watch?v= equivalent ----
  const shortsId = getShortsVideoId(tab.url);
  const originalShortsUrl = shortsId ? `https://www.youtube.com/shorts/${shortsId}` : null;

  if (shortsId) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${shortsId}`;
      await chrome.tabs.update(activeTabId, { url: watchUrl });
      await waitForTabLoad(activeTabId, 15000);
      // Wait 15 seconds when opening new links for page and player to settle
      showState('loading');
      const loadingText = document.querySelector('.loading-text');
      if (loadingText) loadingText.textContent = 'Opened video link... Waiting 15s for YouTube to settle...';
      await new Promise((r) => setTimeout(r, 15000));
    } catch (err) {
      return { success: false, error: 'shorts-redirect-failed', detail: String(err) };
    }
  }

  try {
    // 1. Ensure content.js is loaded into the tab (registers window.__ytcExtractTranscript & listeners)
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js'],
    });

    // 2. Invoke extraction via func so Chrome's engine awaits the returned Promise
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: async (lang) => {
        if (typeof window.__ytcExtractTranscript === 'function') {
          return await window.__ytcExtractTranscript(lang);
        }
        return null;
      },
      args: [requestedLang || null],
    });

    let result = results?.[0]?.result;
    if (!result || !result.success) {
      // Strategy 4: Background Service Worker Fetch Fallback
      const match = tab.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            action: 'fetch-single-transcript',
            videoId: match[1],
          });
          if (bgRes && bgRes.success && bgRes.lines?.length) {
            result = {
              success: true,
              strategyUsed: 'background-fetch',
              videoTitle: bgRes.videoTitle,
              videoUrl: bgRes.videoUrl,
              lines: bgRes.lines,
              captionLanguage: bgRes.captionLanguage,
              availableLanguages: bgRes.availableLanguages || [],
              allTracks: bgRes.allTracks || [],
            };
          }
        } catch { /* ignore background fallback error */ }
      }
    }

    // Fallback: If still no result, ensure Strategy 4 background fetch was attempted
    if (!result || !result.success) {
      const match = tab.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            action: 'fetch-single-transcript',
            videoId: match[1],
          });
          if (bgRes && bgRes.success && bgRes.lines?.length) {
            result = {
              success: true,
              strategyUsed: 'background-fetch',
              videoTitle: bgRes.videoTitle,
              videoUrl: bgRes.videoUrl,
              lines: bgRes.lines,
              captionLanguage: bgRes.captionLanguage,
              availableLanguages: bgRes.availableLanguages || [],
              allTracks: bgRes.allTracks || [],
            };
          }
        } catch { /* ignore */ }
      }
    }

    if (!result) {
      return { success: false, error: 'injection-failed' };
    }

    if (result.success) {
      result.videoId = result.videoId || getVideoIdFromUrl(tab.url) || '';
      if (originalShortsUrl) {
        result.originalShortsUrl = originalShortsUrl;
        result.activeTabId = activeTabId;
      }
    }

    return result;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Cannot access') || msg.includes('chrome://')) {
      return { success: false, error: 'restricted-page' };
    }
    return { success: false, error: 'injection-failed', detail: msg };
  }
}

// ---- Deduplication ----
function deduplicateLines(lines) {
  const result = [];
  let prevText = '';
  for (const line of lines) {
    const normalized = line.text.trim().toLowerCase();
    if (normalized !== prevText) {
      result.push(line);
      prevText = normalized;
    }
  }
  return result;
}

// ---- Formatting ----
function formatTranscript(data, settings) {
  let lines = [...data.lines];

  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  let output = '';

  // Prompt prepend
  if (settings.promptPrepend && settings.promptPrepend.trim()) {
    output += settings.promptPrepend.trim() + '\n\n';
  }

  // Header
  if (settings.title) {
    output += `📺 ${data.videoTitle}\n${'─'.repeat(40)}\n`;
  }
  if (settings.url && data.videoUrl) {
    output += `🔗 ${data.videoUrl}\n`;
  }
  if (settings.title || (settings.url && data.videoUrl)) {
    output += '\n';
  }

  // Body
  switch (settings.format) {
    case 'paragraph': {
      const texts = lines.map((l) => l.text.trim());
      output += texts.join(' ') + '\n';
      break;
    }
    case 'compact': {
      const blockSize = 5;
      for (let i = 0; i < lines.length; i += blockSize) {
        const block = lines.slice(i, i + blockSize);
        if (settings.timestamps && block[0]) {
          output += `[${block[0].timestamp}]\n`;
        }
        output += block.map((l) => l.text.trim()).join(' ') + '\n\n';
      }
      break;
    }
    case 'lines':
    default: {
      output += lines
        .map((line) =>
          settings.timestamps
            ? `[${line.timestamp}]  ${line.text}`
            : line.text
        )
        .join('\n');
      output += '\n';
      break;
    }
  }

  return output;
}

// ---- Interactive Preview ----
// ==================================================================
// v2.4 — TRANSCRIPT SEARCH & NAVIGATION WORKSPACE
// ==================================================================

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseTimestampToSeconds(ts) {
  if (!ts) return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// ---- Caption XML & JSON Parser for Language Switching ----
function parseCaptionTrackXmlOrJson(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = [];

  // Try JSON3 format
  try {
    const json = JSON.parse(text);
    if (json.events && Array.isArray(json.events)) {
      for (const event of json.events) {
        if (!event.segs) continue;
        const lineText = event.segs
          .map((s) => s.utf8 || '')
          .join('')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/<[^>]+>/g, '')
          .trim();
        if (!lineText) continue;
        const startMs = event.tStartMs || 0;
        const totalSec = Math.floor(startMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const timestamp = hours > 0
          ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${mins}:${String(secs).padStart(2, '0')}`;
        lines.push({ timestamp, startSeconds: totalSec, text: lineText });
      }
      if (lines.length > 0) return lines;
    }
  } catch {}

  // Fallback to XML timedtext
  const regex = /<text\s+start="([\d.]+)"[^>]*>(.*?)<\/text>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const startSec = parseFloat(match[1]) || 0;
    const rawText = (match[2] || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!rawText) continue;
    const totalSec = Math.floor(startSec);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const timestamp = hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
    lines.push({ timestamp, startSeconds: totalSec, text: rawText });
  }

  return lines;
}

// ---- Search Normalization (diacritics, unicode, Arabic, Turkish, punctuation) ----
function normalizeForSearch(text) {
  if (!text) return '';
  return text
    .replace(/\u0130/g, 'i') // Dotted capital I -> i
    .replace(/\u0131/g, 'i') // Dotless lowercase i -> i
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u064B-\u065F]/g, '');
}

function stripPunctuation(text) {
  if (!text) return '';
  return text.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]\\]/g, ' ').replace(/\s{2,}/g, ' ');
}

function highlightText(text, query, isActiveMatch = false) {
  if (!query || !text) return escapeHtml(text);
  const rawText = String(text);
  const q = String(query).trim();
  if (!q) return escapeHtml(rawText);

  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'gi');
  const cls = isActiveMatch ? 'search-highlight active-match' : 'search-highlight';

  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    const matchIndex = match.index;
    const matchStr = match[0];
    if (matchStr.length === 0) {
      regex.lastIndex++;
      continue;
    }
    result += escapeHtml(rawText.slice(lastIndex, matchIndex));
    result += `<span class="${cls}">${escapeHtml(matchStr)}</span>`;
    lastIndex = matchIndex + matchStr.length;
  }
  result += escapeHtml(rawText.slice(lastIndex));
  return result;
}


// ==================================================================
// WORKSPACE STATE MACHINE & STORAGE SCALING (v2.5.1)
// ==================================================================

const VIEW_MODE = Object.freeze({
  ALL: 'ALL',
  SEARCH: 'SEARCH',
  BOOKMARKS: 'BOOKMARKS',
});

const PLAYBACK_MODE = Object.freeze({
  FOLLOW: 'FOLLOW',
  FREE: 'FREE',
});

const SELECTION_MODE = Object.freeze({
  NONE: 'NONE',
  ACTIVE: 'ACTIVE',
});

// Formal State Manager
const workspaceState = {
  viewMode: VIEW_MODE.ALL,
  playbackMode: PLAYBACK_MODE.FREE,
  selectionMode: SELECTION_MODE.NONE,
  activeFullSegmentIdx: -1,
  activePlaybackTimestamp: '',
  isPlayingHidden: false,
};

const selectedSegmentIndices = new Set();
const markedSegmentIndices = new Set();
let filterOnlyMarked = false;
let followPlayback = false;
let activePlaybackSegmentIdx = -1; // legacy alias
let playbackSyncTimer = null;
let lastCheckedIndex = null;
let activeSearchMatchIdx = 0;
let currentSearchMatches = [];
var searchMatchedIndices = currentSearchMatches; // Safety alias for legacy/cached callers
if (typeof window !== 'undefined') window.searchMatchedIndices = currentSearchMatches;
let searchDebounceTimer = null;

let currentDisplayItems = []; // Array of { seg, origIdx }
let currentRenderedChunkCount = 100;
const CHUNK_SIZE = 100;

// Storage Quota Configuration
const MAX_SAVED_WORKSPACES = 30;
const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // 4MB

function updateSearchCounter(count, activeIdx = 0) {
  const countEl = $('#search-count');
  const clearBtn = $('#search-clear');
  const navGroup = $('#search-nav-group');
  if (!countEl || !clearBtn) return;

  if (count < 0) {
    countEl.classList.add('hidden');
    clearBtn.classList.add('hidden');
    if (navGroup) navGroup.classList.add('hidden');
  } else {
    countEl.textContent = count > 0 ? `${activeIdx + 1}/${count}` : '0 matches';
    countEl.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
    if (navGroup) {
      if (count > 0) navGroup.classList.remove('hidden');
      else navGroup.classList.add('hidden');
    }
  }
}

function updateSelectionBar() {
  const bar = $('#selection-bar');
  const countEl = $('#selection-count');
  if (!bar || !countEl) return;

  const count = selectedSegmentIndices.size;
  workspaceState.selectionMode = count > 0 ? SELECTION_MODE.ACTIVE : SELECTION_MODE.NONE;

  if (count === 0) {
    bar.classList.add('hidden');
  } else {
    const selWord = getTranslation('batchSelected') || 'selected';
    countEl.textContent = `${count} ${selWord}`;
    bar.classList.remove('hidden');
  }
}

function updateMarksBadge() {
  const badge = $('#marked-count-badge');
  const notesBadge = $('#notes-count-badge');
  const btn = $('#filter-marked-btn');
  const count = markedSegmentIndices.size;
  if (badge) badge.textContent = count;
  if (notesBadge) {
    notesBadge.textContent = count;
    notesBadge.classList.toggle('hidden', count === 0);
  }
  if (btn) btn.classList.toggle('active', filterOnlyMarked);
}

function updateHiddenPlaybackPill() {
  const pill = $('#playback-hidden-indicator');
  const timeEl = $('#playback-hidden-time');
  if (!pill) return;

  if (workspaceState.activeFullSegmentIdx === -1) {
    pill.classList.add('hidden');
    return;
  }

  const isVisible = currentDisplayItems.some((item) => item.origIdx === workspaceState.activeFullSegmentIdx);
  if (!isVisible) {
    pill.classList.remove('hidden');
    if (timeEl) timeEl.textContent = workspaceState.activePlaybackTimestamp || 'active';
  } else {
    pill.classList.add('hidden');
  }
}

function renderSegmentRow(item, rawQuery, isMatched, isActiveMatch, isSelected, settings) {
  const { seg, origIdx } = item;
  const seconds = parseTimestampToSeconds(seg.timestamp);
  const textHtml = highlightText(seg.text, rawQuery, isActiveMatch);
  const isMarked = markedSegmentIndices.has(origIdx);
  const isCurrentPlayback = workspaceState.activeFullSegmentIdx === origIdx;

  const rowCls = ['seg-row'];
  if (isSelected) rowCls.push('selected');
  if (isActiveMatch) rowCls.push('active-match-row');
  if (isMarked) rowCls.push('marked');
  if (isCurrentPlayback) rowCls.push('current-playback-row');

  const starSvg = isMarked
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

  const clockSvg = '<svg class="seg-ts-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const aiSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';
  const copySvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const fromHereSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>';

  return `
    <div class="${rowCls.join(' ')}" data-index="${origIdx}" id="seg-row-${origIdx}">
      <input type="checkbox" class="seg-checkbox" data-index="${origIdx}" ${isSelected ? 'checked' : ''} title="Select segment" />
      <div class="seg-content">
        <div class="seg-header">
          <div style="display:flex; align-items:center; gap:5px;">
            ${
              settings.timestamps && seg.timestamp
                ? `<span class="ts-badge" dir="ltr" data-seconds="${seconds}" title="Click to jump video to ${escapeHtml(seg.timestamp)}">${clockSvg}${escapeHtml(seg.timestamp)}</span>`
                : `<span class="ts-badge" dir="ltr" data-seconds="${seconds}" title="Click to jump video">#${origIdx + 1}</span>`
            }
            <button class="act-mark-btn ${isMarked ? 'active' : ''}" data-index="${origIdx}" title="Bookmark this moment">${starSvg}</button>
          </div>
          <div class="row-actions">
            <button class="row-act-btn act-ai-seg" data-index="${origIdx}" title="Ask AI about this moment">${aiSvg} <span>AI</span></button>
            <button class="row-act-btn act-copy-seg" data-index="${origIdx}" title="Copy this segment">${copySvg} <span>Copy</span></button>
            <button class="row-act-btn act-copy-from" data-index="${origIdx}" title="Copy from here to end">${fromHereSvg} <span>From here</span></button>
          </div>
        </div>
        <div class="seg-text" dir="auto">${textHtml}</div>
      </div>
    </div>
  `;
}

function ensureSegmentRendered(targetDisplayIdx) {
  if (targetDisplayIdx < currentRenderedChunkCount) return;
  const container = $('#workspace-rows');
  if (!container || !currentDisplayItems.length) return;
  const settings = getSettings();
  const rawQuery = ($('#search-input')?.value || '').trim();

  const end = Math.min(currentDisplayItems.length, targetDisplayIdx + CHUNK_SIZE);
  let fragment = '';
  for (let i = currentRenderedChunkCount; i < end; i++) {
    const item = currentDisplayItems[i];
    const isMatched = currentSearchMatches.includes(i);
    const isActiveMatch = rawQuery && isMatched && currentSearchMatches[activeSearchMatchIdx] === i;
    const isSelected = selectedSegmentIndices.has(item.origIdx);
    fragment += renderSegmentRow(item, rawQuery, isMatched, isActiveMatch, isSelected, settings);
  }
  currentRenderedChunkCount = end;
  const sentinel = $('#render-sentinel');
  if (sentinel) {
    sentinel.insertAdjacentHTML('beforebegin', fragment);
    if (currentRenderedChunkCount >= currentDisplayItems.length) {
      sentinel.classList.add('hidden');
    }
  }
}

function renderNextChunk() {
  if (!currentDisplayItems.length || currentRenderedChunkCount >= currentDisplayItems.length) return;
  ensureSegmentRendered(currentRenderedChunkCount + CHUNK_SIZE);
}

function getValidTranscriptLanguages(data) {
  const invalidNames = /^(top|newest|top comments|newest first|más recientes|principales|populari|populaires|recents)$/i;
  return (data?.availableLanguages || []).filter((l) => !invalidNames.test((l.name || '').trim()));
}

function updateTranscriptLanguagePicker() {
  const container = $('#transcript-lang-container');
  const select = $('#transcript-lang-select');
  if (!container || !select) return;

  const invalidNames = /^(top|newest|top comments|newest first|más recientes|principales|populari|populaires|recents)$/i;
  const langs = getValidTranscriptLanguages(cachedData);
  if (cachedData && invalidNames.test((cachedData.captionLanguage || '').trim())) {
    cachedData.captionLanguage = langs[0]?.name || 'Default';
  }

  if (!cachedData || !cachedData.lines || langs.length === 0) {
    container.classList.add('hidden');
    select.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');

  // Check if select options already match langs to avoid re-rendering DOM on every keypress
  const currentOptions = Array.from(select.options).map((o) => o.textContent);
  const newOptions = langs.map((l, idx) => l.name || l.code || `Track ${idx + 1}`);
  const match = currentOptions.length === newOptions.length &&
    currentOptions.every((val, i) => val === newOptions[i]);

  if (!match) {
    select.innerHTML = langs.map((l, idx) => {
      const isSel = l.isSelected || (cachedData.captionLanguage && (l.name === cachedData.captionLanguage || l.code === cachedData.captionLanguage));
      const label = escapeHtml(l.name || l.code || `Track ${idx + 1}`);
      return `<option value="${idx}" ${isSel ? 'selected' : ''}>${label}</option>`;
    }).join('');
  } else {
    // Sync selected index if needed
    const activeIdx = langs.findIndex((l) => l.isSelected || (cachedData.captionLanguage && (l.name === cachedData.captionLanguage || l.code === cachedData.captionLanguage)));
    if (activeIdx !== -1 && select.selectedIndex !== activeIdx) {
      select.selectedIndex = activeIdx;
    }
  }
}

function updatePreview() {
  const box = $('#preview-box');
  if (!box) return;

  if (!cachedData || !cachedData.lines || cachedData.lines.length === 0) {
    box.innerHTML = '<p class="preview-placeholder">Click copy to see a preview here</p>';
    updateSearchCounter(-1);
    updateSelectionBar();
    updateMarksBadge();
    updateHiddenPlaybackPill();
    updateTranscriptLanguagePicker();
    return;
  }

  updateTranscriptLanguagePicker();

  const settings = getSettings();
  const rawQuery = ($('#search-input')?.value || '').trim();

  // Determine current VIEW_MODE
  if (rawQuery) {
    workspaceState.viewMode = VIEW_MODE.SEARCH;
  } else if (filterOnlyMarked) {
    workspaceState.viewMode = VIEW_MODE.BOOKMARKS;
  } else {
    workspaceState.viewMode = VIEW_MODE.ALL;
  }

  let lines = [...cachedData.lines];
  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  // Create unified indexed items
  let items = lines.map((seg, origIdx) => ({ seg, origIdx }));

  // Filter if Bookmarks mode is active
  if (workspaceState.viewMode === VIEW_MODE.BOOKMARKS) {
    items = items.filter((item) => markedSegmentIndices.has(item.origIdx));
  }
  currentDisplayItems = items;

  // Search matching
  currentSearchMatches = [];
  if (rawQuery) {
    const normQ = normalizeForSearch(rawQuery);
    const puncQ = stripPunctuation(normQ).trim();

    items.forEach((item, dispIdx) => {
      const normText = normalizeForSearch(item.seg.text);
      const puncText = stripPunctuation(normText);
      if (normText.includes(normQ) || (puncQ.length > 1 && puncText.includes(puncQ))) {
        currentSearchMatches.push(dispIdx);
      }
    });

    if (activeSearchMatchIdx >= currentSearchMatches.length) {
      activeSearchMatchIdx = Math.max(0, currentSearchMatches.length - 1);
    }
    updateSearchCounter(currentSearchMatches.length, activeSearchMatchIdx);
  } else {
    updateSearchCounter(-1);
  }

  updateSelectionBar();
  updateMarksBadge();
  updateHiddenPlaybackPill();

  // Reset chunk rendering
  let initialLimit = CHUNK_SIZE;
  if (rawQuery && currentSearchMatches.length > 0) {
    initialLimit = Math.max(CHUNK_SIZE, currentSearchMatches[activeSearchMatchIdx] + 20);
  }
  currentRenderedChunkCount = Math.min(items.length, initialLimit);

  // Render workspace container
  let html = '';

  if (settings.title && cachedData.videoTitle) {
    html += `<div style="margin-bottom:6px;font-weight:600;font-size:11.5px;color:var(--text);display:flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff4e50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>${escapeHtml(cachedData.videoTitle)}</span></div>`;
  }
  if (settings.url && cachedData.videoUrl) {
    html += `<div style="margin-bottom:6px;font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>${escapeHtml(cachedData.videoUrl)}</span></div>`;
  }

  html += `<div id="workspace-rows" class="workspace-rows">`;
  for (let idx = 0; idx < currentRenderedChunkCount; idx++) {
    const item = items[idx];
    const isMatched = currentSearchMatches.includes(idx);
    const isActiveMatch = rawQuery && isMatched && currentSearchMatches[activeSearchMatchIdx] === idx;
    const isSelected = selectedSegmentIndices.has(item.origIdx);
    html += renderSegmentRow(item, rawQuery, isMatched, isActiveMatch, isSelected, settings);
  }

  const hasMore = currentRenderedChunkCount < items.length;
  html += `<div id="render-sentinel" class="render-sentinel ${hasMore ? '' : 'hidden'}" style="text-align:center;padding:8px;font-size:11px;color:var(--text-muted)">Loading more segments...</div>`;
  html += `</div>`;

  if (rawQuery && currentSearchMatches.length === 0) {
    html += `<p class="preview-placeholder">No matches found for "${escapeHtml(rawQuery)}"</p>`;
  } else if (workspaceState.viewMode === VIEW_MODE.BOOKMARKS && items.length === 0) {
    html += `<p class="preview-placeholder">No bookmarked moments yet. Click ⭐ on any row to mark it.</p>`;
  }

  box.innerHTML = html;

  // Scroll active match into view if navigating
  if (rawQuery && currentSearchMatches.length > 0) {
    const targetDispIdx = currentSearchMatches[activeSearchMatchIdx];
    ensureSegmentRendered(targetDispIdx);
    const targetItem = currentDisplayItems[targetDispIdx];
    if (targetItem) {
      const targetRow = $(`#seg-row-${targetItem.origIdx}`);
      if (targetRow) {
        targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
}

// ---- Search Navigation Controls ----
function navigateMatch(direction) {
  if (currentSearchMatches.length === 0) return;
  const prevDispIdx = currentSearchMatches[activeSearchMatchIdx];
  if (direction === 'next') {
    activeSearchMatchIdx = (activeSearchMatchIdx + 1) % currentSearchMatches.length;
  } else {
    activeSearchMatchIdx = (activeSearchMatchIdx - 1 + currentSearchMatches.length) % currentSearchMatches.length;
  }
  const newDispIdx = currentSearchMatches[activeSearchMatchIdx];
  updateSearchCounter(currentSearchMatches.length, activeSearchMatchIdx);

  // Un-highlight previous
  if (prevDispIdx !== undefined && currentDisplayItems[prevDispIdx]) {
    const prevOrigIdx = currentDisplayItems[prevDispIdx].origIdx;
    const prevRow = $(`#seg-row-${prevOrigIdx}`);
    if (prevRow) {
      prevRow.classList.remove('active-match-row');
      prevRow.querySelectorAll('.active-match').forEach((el) => el.classList.remove('active-match'));
    }
  }

  // Highlight new and scroll into view
  if (newDispIdx !== undefined && currentDisplayItems[newDispIdx]) {
    ensureSegmentRendered(newDispIdx);
    const newOrigIdx = currentDisplayItems[newDispIdx].origIdx;
    const newRow = $(`#seg-row-${newOrigIdx}`);
    if (newRow) {
      newRow.classList.add('active-match-row');
      newRow.querySelectorAll('.search-highlight').forEach((el) => el.classList.add('active-match'));
      newRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function goToNextMatch() {
  navigateMatch('next');
}

function goToPrevMatch() {
  navigateMatch('prev');
}

// Search listeners with 120ms debounce
const searchInput = $('#search-input');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      activeSearchMatchIdx = 0;
      updatePreview();
    }, 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchDebounceTimer);
      if (e.shiftKey) goToPrevMatch();
      else goToNextMatch();
    } else if (e.key === 'Escape') {
      clearTimeout(searchDebounceTimer);
      searchInput.value = '';
      activeSearchMatchIdx = 0;
      updatePreview();
    }
  });
}

$('#search-prev-btn')?.addEventListener('click', goToPrevMatch);
$('#search-next-btn')?.addEventListener('click', goToNextMatch);

$('#search-clear')?.addEventListener('click', () => {
  clearTimeout(searchDebounceTimer);
  if (searchInput) searchInput.value = '';
  activeSearchMatchIdx = 0;
  updatePreview();
});

// Scroll listener on preview-box for progressive chunk loading
const previewBoxEl = $('#preview-box');
if (previewBoxEl) {
  previewBoxEl.addEventListener('scroll', () => {
    if (previewBoxEl.scrollTop + previewBoxEl.clientHeight >= previewBoxEl.scrollHeight - 250) {
      renderNextChunk();
    }
  });
}

// Hidden playback indicator click action
$('#playback-hidden-indicator')?.addEventListener('click', () => {
  filterOnlyMarked = false;
  if (searchInput) searchInput.value = '';
  activeSearchMatchIdx = 0;
  updatePreview();
  if (workspaceState.activeFullSegmentIdx !== -1) {
    const dispIdx = currentDisplayItems.findIndex((item) => item.origIdx === workspaceState.activeFullSegmentIdx);
    if (dispIdx !== -1) {
      ensureSegmentRendered(dispIdx);
      const row = $(`#seg-row-${workspaceState.activeFullSegmentIdx}`);
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});


// ==================================================================
// LIVE PLAYBACK SYNCHRONIZATION & SPA WATCHDOG
// ==================================================================

function startPlaybackSync() {
  if (playbackSyncTimer) clearInterval(playbackSyncTimer);
  playbackSyncTimer = setInterval(pollPlaybackState, 400);
}

function stopPlaybackSync() {
  if (playbackSyncTimer) {
    clearInterval(playbackSyncTimer);
    playbackSyncTimer = null;
  }
}

function pollPlaybackState() {
  if (!cachedData || !cachedData.lines || cachedData.lines.length === 0) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url || !isYouTubeVideo(tab.url)) return;


    // Safely query player timestamp (resilient to tab reloads or missing video)
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
          return v ? { currentTime: v.currentTime, paused: v.paused, duration: v.duration } : null;
        } catch {
          return null;
        }
      },
    }).then((res) => {
      const state = res?.[0]?.result;
      if (!state) return;
      updatePlaybackActiveSegment(state.currentTime);
    }).catch(() => {});
  });
}

function updatePlaybackActiveSegment(currentSec) {
  if (!cachedData || !cachedData.lines || cachedData.lines.length === 0) return;

  // 1. Locate active segment in the FULL transcript
  let foundFullIdx = -1;
  for (let i = 0; i < cachedData.lines.length; i++) {
    const sec = parseTimestampToSeconds(cachedData.lines[i].timestamp);
    if (sec <= currentSec) {
      foundFullIdx = i;
    } else {
      break;
    }
  }

  if (foundFullIdx === workspaceState.activeFullSegmentIdx) return;

  // Un-highlight previous row
  if (workspaceState.activeFullSegmentIdx !== -1) {
    const prevRow = $(`#seg-row-${workspaceState.activeFullSegmentIdx}`);
    if (prevRow) prevRow.classList.remove('current-playback-row');
  }

  workspaceState.activeFullSegmentIdx = foundFullIdx;
  activePlaybackSegmentIdx = foundFullIdx; // legacy alias sync
  workspaceState.activePlaybackTimestamp = foundFullIdx !== -1 ? (cachedData.lines[foundFullIdx].timestamp || '') : '';

  // 2. Check visibility against current view mode
  const dispIdx = currentDisplayItems.findIndex((item) => item.origIdx === foundFullIdx);

  if (dispIdx !== -1) {
    // Playing segment is VISIBLE
    ensureSegmentRendered(dispIdx);
    const newRow = $(`#seg-row-${foundFullIdx}`);
    if (newRow) {
      newRow.classList.add('current-playback-row');
      if (workspaceState.playbackMode === PLAYBACK_MODE.FOLLOW && document.activeElement !== searchInput) {
        newRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    const pill = $('#playback-hidden-indicator');
    if (pill) pill.classList.add('hidden');
  } else {
    // Playing segment is FILTERED OUT (Search or Bookmarks view)
    updateHiddenPlaybackPill();
  }
}

$('#toggle-follow-playback')?.addEventListener('click', () => {
  followPlayback = !followPlayback;
  workspaceState.playbackMode = followPlayback ? PLAYBACK_MODE.FOLLOW : PLAYBACK_MODE.FREE;
  const btn = $('#toggle-follow-playback');
  if (btn) btn.classList.toggle('active', followPlayback);
  chrome.storage.local.set({ followPlaybackSetting: followPlayback });

  if (followPlayback && workspaceState.activeFullSegmentIdx !== -1) {
    const dispIdx = currentDisplayItems.findIndex((item) => item.origIdx === workspaceState.activeFullSegmentIdx);
    if (dispIdx !== -1) {
      ensureSegmentRendered(dispIdx);
      const row = $(`#seg-row-${workspaceState.activeFullSegmentIdx}`);
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// Restore follow playback preference
chrome.storage.local.get('followPlaybackSetting').then((res) => {
  if (res.followPlaybackSetting !== undefined) {
    followPlayback = Boolean(res.followPlaybackSetting);
    workspaceState.playbackMode = followPlayback ? PLAYBACK_MODE.FOLLOW : PLAYBACK_MODE.FREE;
    $('#toggle-follow-playback')?.classList.toggle('active', followPlayback);
  }
}).catch(() => {});

// Filter to Bookmarked Moments
$('#filter-marked-btn')?.addEventListener('click', () => {
  filterOnlyMarked = !filterOnlyMarked;
  updatePreview();
});

// ---- Transcript Language Switcher Handler ----
const langSelect = $('#transcript-lang-select');
if (langSelect) {
  langSelect.addEventListener('change', async (e) => {
    const chosenIdx = parseInt(e.target.value, 10);
    const langs = getValidTranscriptLanguages(cachedData);
    const targetTrack = langs[chosenIdx];
    if (!targetTrack || !cachedData) return;

    // If already active on this language, copy and update preview directly
    if (cachedData.captionLanguage && (cachedData.captionLanguage === targetTrack.name || cachedData.captionLanguage === targetTrack.code)) {
      const settings = getSettings();
      const text = formatTranscript(cachedData, settings);
      await copyToClipboard(text);
      updatePreview();
      const count = cachedData.lines?.length || 0;
      const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      const copyMsg = dict.copiedSuccess ? dict.copiedSuccess(count) : TRANSLATIONS.en.copiedSuccess(count);
      showState('success', `[${cachedData.captionLanguage}] ${copyMsg}`);
      setTimeout(() => showState('idle'), 2500);
      return;
    }

    langSelect.disabled = true;
    showState('loading');

    try {
      let switchSuccess = false;
      let newLines = null;
      let newLangName = targetTrack.name;

      // Method 1: Ask content script to switch language directly in YouTube DOM
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs?.[0];
        if (activeTab && activeTab.id) {
          let resp = null;
          try {
            resp = await chrome.tabs.sendMessage(activeTab.id, {
              action: 'switch-transcript-language',
              trackIndex: targetTrack.trackIndex !== undefined ? targetTrack.trackIndex : chosenIdx,
              baseUrl: targetTrack.baseUrl,
              languageName: targetTrack.name,
            });
          } catch {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ['content.js'],
              });
              resp = await chrome.tabs.sendMessage(activeTab.id, {
                action: 'switch-transcript-language',
                trackIndex: targetTrack.trackIndex !== undefined ? targetTrack.trackIndex : chosenIdx,
                baseUrl: targetTrack.baseUrl,
                languageName: targetTrack.name,
              });
            } catch {}
          }

          if (resp && resp.success && resp.lines?.length) {
            newLines = resp.lines;
            newLangName = resp.captionLanguage || targetTrack.name;
            switchSuccess = true;
          }
        }
      } catch (msgErr) {
        console.warn('[YT Transcript Copier] Content script switch failed:', msgErr);
      }

      // Method 2: Fallback — call extractTranscript with the requested language name
      if (!switchSuccess) {
        try {
          const fullResult = await extractTranscript(targetTrack.name);
          if (fullResult && fullResult.success && fullResult.lines?.length) {
            newLines = fullResult.lines;
            newLangName = fullResult.captionLanguage || targetTrack.name;
            switchSuccess = true;
          }
        } catch (extErr) {
          console.warn('[YT Transcript Copier] Re-extraction safety net failed:', extErr);
        }
      }

      // Method 3: Direct fetch via baseUrl ONLY IF authentic separate track (never forged tlang)
      if (!switchSuccess && targetTrack.baseUrl && !targetTrack.baseUrl.includes('&tlang=')) {
        try {
          const res = await fetch(targetTrack.baseUrl);
          if (res.ok) {
            const text = await res.text();
            newLines = parseCaptionTrackXmlOrJson(text);
            if (newLines && newLines.length > 0) {
              switchSuccess = true;
            }
          }
        } catch (fetchErr) {
          console.warn('[YT Transcript Copier] Direct track fetch failed, falling back:', fetchErr);
        }
      }

      // Method 4: Fallback via background service worker
      if (!switchSuccess && cachedData.videoId && targetTrack.trackIndex !== undefined) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            action: 'fetch-single-transcript',
            videoId: cachedData.videoId,
            trackIndex: targetTrack.trackIndex,
          });
          if (bgRes && bgRes.success && bgRes.lines?.length) {
            newLines = bgRes.lines;
            newLangName = bgRes.captionLanguage || targetTrack.name;
            switchSuccess = true;
          }
        } catch (bgErr) {
          console.warn('[YT Transcript Copier] Background switch failed:', bgErr);
        }
      }

      if (switchSuccess && newLines && newLines.length > 0) {
        (cachedData.availableLanguages || []).forEach((l) => {
          l.isSelected = (l.name === newLangName || l.code === targetTrack.code);
        });
        langs.forEach((l, i) => { l.isSelected = (i === chosenIdx); });
        cachedData.lines = newLines;
        cachedData.captionLanguage = newLangName;

        // Reset search & selection state for the new language so all segments are visible
        const searchInput = $('#search-input');
        if (searchInput) searchInput.value = '';
        selectedSegmentIndices.clear();
        currentSearchMatches = [];
        searchMatchedIndices = currentSearchMatches;
        if (typeof window !== 'undefined') window.searchMatchedIndices = currentSearchMatches;
        activeSearchMatchIdx = 0;


        // Update preview directly with the newly selected language transcript
        updatePreview();

        // Automatically format and copy to clipboard directly
        const settings = getSettings();
        const text = formatTranscript(cachedData, settings);
        const ok = await copyToClipboard(text);

        const count = newLines.length;
        const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
        const copyMsg = dict.copiedSuccess
          ? dict.copiedSuccess(count)
          : TRANSLATIONS.en.copiedSuccess(count);

        if (ok) {
          showState('success', `[${newLangName}] ${copyMsg}`);
        } else {
          showState('success', `Switched transcript to ${newLangName}`);
        }
        setTimeout(() => showState('idle'), 2500);
      } else {
        showState('error', 'Could not load transcript for selected language.');
        setTimeout(() => showState('idle'), 3000);
        updateTranscriptLanguagePicker();
      }
    } catch (err) {
      console.error('[YT Transcript Copier] Language switch error:', err);
      showState('error', `Error switching transcript language: ${err?.message || err}`);
      setTimeout(() => showState('idle'), 3500);
      updateTranscriptLanguagePicker();
    } finally {
      langSelect.disabled = false;
    }
  });
}

// Start live sync
startPlaybackSync();

// ==================================================================
// SAVED TRANSCRIPTS WORKSPACE STORAGE & QUOTA POLICY
// ==================================================================

function sanitizeWorkspaces(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.id !== 'string' || !item.id.trim()) return false;
    if (!Array.isArray(item.lines) || item.lines.length === 0) return false;
    item.videoTitle = typeof item.videoTitle === 'string' ? item.videoTitle.trim() : 'Untitled Transcript';
    item.videoUrl = typeof item.videoUrl === 'string' ? item.videoUrl.trim() : '';
    item.savedAt = typeof item.savedAt === 'number' ? item.savedAt : Date.now();
    item.marks = Array.isArray(item.marks) ? item.marks.filter((n) => typeof n === 'number') : [];
    item.selectedIndices = Array.isArray(item.selectedIndices) ? item.selectedIndices.filter((n) => typeof n === 'number') : [];
    return true;
  });
}

function pruneWorkspaces(list, maxLimit = MAX_SAVED_WORKSPACES) {
  const sanitized = sanitizeWorkspaces(list);
  if (sanitized.length <= maxLimit) return sanitized;
  let items = [...sanitized];
  while (items.length > maxLimit) {
    const unstarredIdx = items.findIndex((w) => !w.marks || w.marks.length === 0);
    if (unstarredIdx !== -1) {
      items.splice(unstarredIdx, 1);
    } else {
      items.shift();
    }
  }
  return items;
}

function estimateStorageBytes(data) {
  try {
    return new Blob([JSON.stringify(data)]).size;
  } catch {
    return 0;
  }
}

async function getSavedWorkspaces() {
  try {
    if (window.StorageVault) {
      return await window.StorageVault.getWorkspaceIndex(chrome.storage.local);
    }
    const res = await chrome.storage.local.get('saved_workspaces');
    return sanitizeWorkspaces(res.saved_workspaces);
  } catch (err) {
    console.warn('[YT Transcript Copier] Error getting saved workspaces:', err);
    return [];
  }
}

async function updateSavedBadgeCount() {
  const list = await getSavedWorkspaces();
  const badge = $('#saved-count-badge');
  if (badge) {
    badge.textContent = list.length;
    badge.classList.toggle('hidden', list.length === 0);
  }
}
updateSavedBadgeCount();

async function saveCurrentWorkspace() {
  if (!cachedData || !cachedData.lines || cachedData.lines.length === 0) return;
  const id = cachedData.videoId || 'ws_' + Date.now();

  try {
    if (window.StorageVault) {
      await window.StorageVault.saveWorkspace(chrome.storage.local, {
        id,
        videoId: cachedData.videoId || '',
        videoTitle: cachedData.videoTitle || 'Untitled Transcript',
        videoUrl: cachedData.videoUrl || '',
        lines: cachedData.lines,
        marks: Array.from(markedSegmentIndices),
        selectedIndices: Array.from(selectedSegmentIndices),
        captionLanguage: cachedData.captionLanguage || '',
        availableLanguages: cachedData.availableLanguages || [],
      });
    } else {
      const list = await getSavedWorkspaces();
      const existingIdx = list.findIndex((item) => item.id === id || (cachedData.videoId && item.videoId === cachedData.videoId));
      const entry = {
        id,
        videoId: cachedData.videoId || '',
        videoTitle: cachedData.videoTitle || 'Untitled Transcript',
        videoUrl: cachedData.videoUrl || '',
        savedAt: Date.now(),
        lines: cachedData.lines,
        marks: Array.from(markedSegmentIndices),
        selectedIndices: Array.from(selectedSegmentIndices),
        captionLanguage: cachedData.captionLanguage || '',
        availableLanguages: cachedData.availableLanguages || [],
      };
      if (existingIdx !== -1) list[existingIdx] = entry;
      else list.unshift(entry);
      const prunedList = pruneWorkspaces(list, MAX_SAVED_WORKSPACES);
      await chrome.storage.local.set({ saved_workspaces: prunedList });
    }

    updateSavedBadgeCount();

    const saveBtn = $('#save-workspace-btn');
    if (saveBtn) {
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Saved!</span>';
      setTimeout(() => { saveBtn.innerHTML = originalText; }, 1500);
    }
  } catch (err) {
    console.error('[YT Transcript Copier] Storage quota exceeded or write failed:', err);
    showState('error', 'Storage full! Delete some saved workspaces to free space.');
    setTimeout(() => showState('idle'), 3500);
  }
}

$('#save-workspace-btn')?.addEventListener('click', saveCurrentWorkspace);

// Saved Modal Management
const savedModal = $('#saved-modal');
$('#btn-saved-drawer')?.addEventListener('click', async () => {
  if (savedModal) {
    savedModal.classList.remove('hidden');
    await renderSavedModalList();
  }
});

$('#saved-modal-close')?.addEventListener('click', () => {
  if (savedModal) savedModal.classList.add('hidden');
});

$('#saved-search-input')?.addEventListener('input', () => {
  renderSavedModalList();
});

async function renderSavedModalList() {
  const container = $('#saved-list');
  if (!container) return;

  const list = await getSavedWorkspaces();
  const q = ($('#saved-search-input')?.value || '').trim().toLowerCase();
  const filtered = q ? list.filter((item) => (item.videoTitle || '').toLowerCase().includes(q)) : list;

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-saved-placeholder">${q ? 'No saved workspaces match your search.' : 'No saved transcripts yet.<br>Click "Save" on any transcript to store it locally.'}</p>`;
    return;
  }

  let html = '';
  filtered.forEach((item) => {
    const d = new Date(item.savedAt).toLocaleDateString();
    const starCount = item.markCount !== undefined ? item.markCount : (item.marks?.length || 0);
    const calSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const starMiniSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const editSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    const trashSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    html += `
      <div class="saved-item" data-id="${item.id}">
        <div class="saved-item-info act-restore-ws" data-id="${item.id}">
          <div class="saved-item-title" title="${escapeHtml(item.videoTitle)}">${escapeHtml(item.videoTitle)}</div>
          <div class="saved-item-meta">${calSvg} <span>${d}</span> · <span>${item.segmentCount !== undefined ? item.segmentCount : (item.lines?.length || 0)} segs</span> ${starCount > 0 ? `· ${starMiniSvg} <span>${starCount}</span>` : ''}</div>
        </div>
        <div class="saved-item-actions">
          <button class="saved-act-btn act-rename-ws" data-id="${item.id}" title="Rename">${editSvg}</button>
          <button class="saved-act-btn delete act-delete-ws" data-id="${item.id}" title="Delete">${trashSvg}</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

$('#saved-list')?.addEventListener('click', async (e) => {
  const target = e.target;
  const itemEl = target.closest('.saved-item');
  if (!itemEl) return;
  const id = itemEl.dataset.id;
  const list = await getSavedWorkspaces();
  const item = list.find((w) => w.id === id);
  if (!item) return;

  // Restore
  if (target.closest('.act-restore-ws')) {
    let lines = item.lines;
    let marks = item.marks || [];
    let selectedIndices = item.selectedIndices || [];
    let captionLanguage = item.captionLanguage || '';
    let availableLanguages = item.availableLanguages || [];

    if (!lines && window.StorageVault) {
      const payload = await window.StorageVault.getWorkspacePayload(chrome.storage.local, id);
      if (payload) {
        lines = payload.lines;
        marks = payload.marks || [];
        selectedIndices = payload.selectedIndices || [];
        captionLanguage = payload.captionLanguage || captionLanguage;
        availableLanguages = payload.availableLanguages || availableLanguages;
      }
    }

    if (lines) {
      cachedData = {
        lines,
        videoTitle: item.videoTitle,
        videoUrl: item.videoUrl,
        videoId: item.videoId,
        captionLanguage,
        availableLanguages,
      };
      markedSegmentIndices.clear();
      marks.forEach((m) => markedSegmentIndices.add(m));
      selectedSegmentIndices.clear();
      selectedIndices.forEach((s) => selectedSegmentIndices.add(s));
      savedModal?.classList.add('hidden');
      updatePreview();
    }
    return;
  }

  // Rename with input sanitization
  if (target.closest('.act-rename-ws')) {
    const newName = prompt('Enter a new title for this workspace:', item.videoTitle);
    if (newName && newName.trim()) {
      if (window.StorageVault) {
        await window.StorageVault.renameWorkspace(chrome.storage.local, id, newName.trim());
      } else {
        item.videoTitle = newName.trim();
        await chrome.storage.local.set({ saved_workspaces: list });
      }
      renderSavedModalList();
    }
    return;
  }

  // Delete
  if (target.closest('.act-delete-ws')) {
    if (confirm(`Delete "${item.videoTitle}" from saved workspaces?`)) {
      if (window.StorageVault) {
        await window.StorageVault.deleteWorkspace(chrome.storage.local, id);
      } else {
        const remaining = list.filter((w) => w.id !== id);
        await chrome.storage.local.set({ saved_workspaces: remaining });
      }
      updateSavedBadgeCount();
      renderSavedModalList();
    }
    return;
  }
});

// ==================================================================
// KEYBOARD SHORTCUTS & DELEGATED EVENTS
// ==================================================================

window.addEventListener('keydown', async (e) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  // / -> Search
  if (!isTyping && e.key === '/') {
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  // Space -> Play/Pause video
  if (!isTyping && e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs?.[0]?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
          if (v) v.paused ? v.play() : v.pause();
        },
      }).catch(() => {});
    });
    return;
  }

  // m -> Bookmark currently active playback segment or highlighted match
  if (!isTyping && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    const targetIdx = activePlaybackSegmentIdx !== -1 ? activePlaybackSegmentIdx : (currentSearchMatches[activeSearchMatchIdx] !== undefined ? currentSearchMatches[activeSearchMatchIdx] : 0);
    if (targetIdx >= 0 && cachedData?.lines?.[targetIdx]) {
      if (markedSegmentIndices.has(targetIdx)) markedSegmentIndices.delete(targetIdx);
      else markedSegmentIndices.add(targetIdx);
      updatePreview();
    }
    return;
  }

  // Ctrl/Cmd + F
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  // Ctrl/Cmd + C with active selection
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !isTyping && selectedSegmentIndices.size > 0) {
    const sorted = Array.from(selectedSegmentIndices).sort((a, b) => a - b);
    const textToCopy = sorted
      .map((i) => {
        const seg = cachedData.lines[i];
        return seg.timestamp ? `[${seg.timestamp}] ${seg.text}` : seg.text;
      })
      .join('\n');
    await copyToClipboard(textToCopy);
    return;
  }

  // Escape
  if (e.key === 'Escape') {
    clearTimeout(searchDebounceTimer);
    if (savedModal && !savedModal.classList.contains('hidden')) {
      savedModal.classList.add('hidden');
    } else if (searchInput && searchInput.value) {
      searchInput.value = '';
      activeSearchMatchIdx = 0;
      updatePreview();
    } else if (selectedSegmentIndices.size > 0) {
      selectedSegmentIndices.clear();
      lastCheckedIndex = null;
      updatePreview();
    }
  }
});

// Delegated Click Handlers on Workspace Container
$('#preview-box')?.addEventListener('click', async (e) => {
  // 1. Click-to-seek: Jump YouTube video to timestamp
  const tsBadge = e.target.closest('.ts-badge');
  if (tsBadge) {
    const seconds = parseInt(tsBadge.dataset.seconds, 10);
    if (!isNaN(seconds)) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs?.[0]?.id) return;
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (sec) => {
            const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
            if (!video) return;
            try {
              const targetTime = Number.isFinite(video.duration) && video.duration > 0
                ? Math.min(Math.max(0, sec), Math.max(0, video.duration - 0.5))
                : Math.max(0, sec);
              video.currentTime = targetTime;
              if (video.paused) {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                  playPromise.catch(() => {});
                }
              }
            } catch (err) {
              console.warn('[YT Transcript Copier] Seek error:', err);
            }
          },
          args: [seconds],
        }).catch(() => {});
      });
    }
    return;
  }

  // 2. Bookmark toggle button (⭐)
  const markBtn = e.target.closest('.act-mark-btn');
  if (markBtn) {
    const idx = parseInt(markBtn.dataset.index, 10);
    if (!isNaN(idx)) {
      if (markedSegmentIndices.has(idx)) {
        markedSegmentIndices.delete(idx);
      } else {
        markedSegmentIndices.add(idx);
      }
      updatePreview();
    }
    return;
  }

  // 3. Selection checkbox toggle with Bi-Directional Shift+Click support
  const checkbox = e.target.closest('.seg-checkbox');
  if (checkbox) {
    const idx = parseInt(checkbox.dataset.index, 10);
    if (!isNaN(idx)) {
      const isChecked = checkbox.checked;
      if (e.shiftKey && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, idx);
        const end = Math.max(lastCheckedIndex, idx);
        for (let i = start; i <= end; i++) {
          if (isChecked) {
            selectedSegmentIndices.add(i);
            $(`#seg-row-${i}`)?.classList.add('selected');
            const cb = $(`#seg-row-${i} .seg-checkbox`);
            if (cb) cb.checked = true;
          } else {
            selectedSegmentIndices.delete(i);
            $(`#seg-row-${i}`)?.classList.remove('selected');
            const cb = $(`#seg-row-${i} .seg-checkbox`);
            if (cb) cb.checked = false;
          }
        }
      } else {
        if (isChecked) {
          selectedSegmentIndices.add(idx);
          $(`#seg-row-${idx}`)?.classList.add('selected');
        } else {
          selectedSegmentIndices.delete(idx);
          $(`#seg-row-${idx}`)?.classList.remove('selected');
        }
        lastCheckedIndex = idx;
      }
      updateSelectionBar();
    }
    return;
  }

  // 4. Row Action: Copy Single Segment
  const copySegBtn = e.target.closest('.act-copy-seg');
  if (copySegBtn) {
    const idx = parseInt(copySegBtn.dataset.index, 10);
    if (!isNaN(idx) && cachedData?.lines?.[idx]) {
      const seg = cachedData.lines[idx];
      const settings = getSettings();
      const textToCopy = settings.timestamps && seg.timestamp ? `[${seg.timestamp}] ${seg.text}` : seg.text;
      await copyToClipboard(textToCopy);
      copySegBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
      setTimeout(() => {
        copySegBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> <span>Copy</span>';
      }, 1500);
    }
    return;
  }

  // 5. Row Action: Copy from here to end
  const copyFromBtn = e.target.closest('.act-copy-from');
  if (copyFromBtn) {
    const idx = parseInt(copyFromBtn.dataset.index, 10);
    if (!isNaN(idx) && cachedData?.lines) {
      const slice = cachedData.lines.slice(idx);
      const settings = getSettings();
      const textToCopy = slice
        .map((s) => (settings.timestamps && s.timestamp ? `[${s.timestamp}] ${s.text}` : s.text))
        .join('\n');
      await copyToClipboard(textToCopy);
      copyFromBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
      setTimeout(() => {
        copyFromBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg> <span>From here</span>';
      }, 1500);
    }
    return;
  }

  // 6. Row Action: Quick Ask AI about single segment (v2.6.0)
  const aiSegBtn = e.target.closest('.act-ai-seg');
  if (aiSegBtn) {
    const idx = parseInt(aiSegBtn.dataset.index, 10);
    if (!isNaN(idx) && cachedData?.lines?.[idx]) {
      const payload = buildAiPayload({
        title: cachedData.videoTitle,
        url: cachedData.videoUrl,
        segments: cachedData.lines,
        scope: 'segment',
        singleIndex: idx,
        actionKey: 'explain',
      });
      await dispatchToAI(payload.text, 'chatgpt');
    }
    return;
  }
});

// Selection Bar Actions
$('#copy-selection-ts-btn')?.addEventListener('click', async () => {
  if (selectedSegmentIndices.size === 0 || !cachedData?.lines) return;
  const sorted = Array.from(selectedSegmentIndices).sort((a, b) => a - b);
  const textToCopy = sorted
    .map((i) => {
      const seg = cachedData.lines[i];
      return seg.timestamp ? `[${seg.timestamp}] ${seg.text}` : seg.text;
    })
    .join('\n');
  await copyToClipboard(textToCopy);
  const btn = $('#copy-selection-ts-btn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }
});

$('#copy-selection-text-btn')?.addEventListener('click', async () => {
  if (selectedSegmentIndices.size === 0 || !cachedData?.lines) return;
  const sorted = Array.from(selectedSegmentIndices).sort((a, b) => a - b);
  const textToCopy = sorted.map((i) => cachedData.lines[i].text).join('\n');
  await copyToClipboard(textToCopy);
  const btn = $('#copy-selection-text-btn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }
});

$('#mark-selection-btn')?.addEventListener('click', () => {
  if (selectedSegmentIndices.size === 0) return;
  selectedSegmentIndices.forEach((i) => markedSegmentIndices.add(i));
  updatePreview();
});

// Selection AI Action Dropdown (v2.6.0)
$('#ai-selection-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('#selection-ai-menu')?.classList.toggle('hidden');
});

window.addEventListener('click', (e) => {
  if (!e.target.closest('.selection-ai-dropdown')) {
    $('#selection-ai-menu')?.classList.add('hidden');
  }
});

$$('.sel-ai-item').forEach((item) => {
  item.addEventListener('click', async (e) => {
    e.stopPropagation();
    $('#selection-ai-menu')?.classList.add('hidden');
    if (selectedSegmentIndices.size === 0 || !cachedData?.lines) return;

    const action = item.dataset.action || 'summarize';
    const payload = buildAiPayload({
      title: cachedData.videoTitle,
      url: cachedData.videoUrl,
      segments: cachedData.lines,
      scope: 'selection',
      selectedIndices: Array.from(selectedSegmentIndices),
      actionKey: action,
    });

    await dispatchToAI(payload.text, 'chatgpt');
  });
});

// Clip Notes Modal Management (v2.6.0)
function openClipNotesModal() {
  const modal = $('#clip-notes-modal');
  const textarea = $('#clip-notes-text');
  const badge = $('#clip-notes-badge');
  if (!modal || !textarea) return;

  if (window.AiWorkspaceEngine && typeof window.AiWorkspaceEngine.generateStructuredClipNote === 'function') {
    const structured = window.AiWorkspaceEngine.generateStructuredClipNote(
      cachedData?.lines || [],
      markedSegmentIndices,
      {
        title: cachedData?.videoTitle || 'Untitled Video',
        url: cachedData?.videoUrl || '',
        videoId: cachedData?.videoId || '',
      }
    );
    textarea.value = structured.markdown;
    if (badge) {
      badge.textContent = `${structured.momentCount} moment${structured.momentCount !== 1 ? 's' : ''} (~${structured.estimatedTokens} tokens)`;
    }
  } else {
    const notes = generateClipNotes(
      cachedData?.lines || [],
      markedSegmentIndices,
      {
        title: cachedData?.videoTitle || 'Untitled Video',
        url: cachedData?.videoUrl || '',
      }
    );
    textarea.value = notes;
    if (badge) badge.textContent = `${markedSegmentIndices.size} moment${markedSegmentIndices.size !== 1 ? 's' : ''}`;
  }
  modal.classList.remove('hidden');
}

$('#btn-clip-notes')?.addEventListener('click', openClipNotesModal);
$('#clip-notes-close')?.addEventListener('click', () => {
  $('#clip-notes-modal')?.classList.add('hidden');
});

$('#clip-notes-copy-btn')?.addEventListener('click', async () => {
  const text = $('#clip-notes-text')?.value;
  if (!text) return;
  await copyToClipboard(text);
  const btn = $('#clip-notes-copy-btn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }
});

$('#clip-notes-download-btn')?.addEventListener('click', () => {
  const text = $('#clip-notes-text')?.value;
  if (!text) return;
  const id = cachedData?.videoId || 'notes';
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `clip_notes_${id}.md`);
});

['chatgpt', 'claude', 'gemini'].forEach((svc) => {
  $(`#clip-ai-${svc}`)?.addEventListener('click', async () => {
    if (!cachedData?.lines || markedSegmentIndices.size === 0) {
      showState('error', 'No marked moments to synthesize.');
      setTimeout(() => showState('idle'), 2500);
      return;
    }
    const payload = buildAiPayload({
      title: cachedData.videoTitle,
      url: cachedData.videoUrl,
      segments: cachedData.lines,
      scope: 'marks',
      markedIndices: Array.from(markedSegmentIndices),
      actionKey: 'clip_notes_synthesis',
    });
    $('#clip-notes-modal')?.classList.add('hidden');
    await dispatchToAI(payload.text, svc);
  });
});

$('#clear-selection-btn')?.addEventListener('click', () => {
  selectedSegmentIndices.clear();
  lastCheckedIndex = null;
  updatePreview();
});

// ---- Clipboard ----
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) return true;
    } catch {}

    // Fallback: request active tab content script to copy to clipboard
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs?.[0]?.id) {
        const resp = await chrome.tabs.sendMessage(tabs[0].id, {
          action: 'copy-to-clipboard',
          text,
        });
        if (resp && resp.success) return true;
      }
    } catch {}

    return false;
  }
}

// ---- Multi-Format Exporters ----
// (parseTimestampToSeconds is defined above in the interactive preview section)

function formatSecondsToSRT(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

function formatSecondsToVTT(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}.000`;
}

function exportToFormat(data, format, settings) {
  let lines = [...data.lines];
  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  switch (format) {
    case 'srt': {
      let output = '';
      lines.forEach((line, idx) => {
        const startSec = parseTimestampToSeconds(line.timestamp);
        const nextSec = lines[idx + 1] ? parseTimestampToSeconds(lines[idx + 1].timestamp) : startSec + 4;
        output += `${idx + 1}\n${formatSecondsToSRT(startSec)} --> ${formatSecondsToSRT(nextSec)}\n${line.text.trim()}\n\n`;
      });
      return output.trim();
    }
    case 'vtt': {
      let output = 'WEBVTT\n\n';
      lines.forEach((line, idx) => {
        const startSec = parseTimestampToSeconds(line.timestamp);
        const nextSec = lines[idx + 1] ? parseTimestampToSeconds(lines[idx + 1].timestamp) : startSec + 4;
        output += `${formatSecondsToVTT(startSec)} --> ${formatSecondsToVTT(nextSec)}\n${line.text.trim()}\n\n`;
      });
      return output.trim();
    }
    case 'md': {
      let output = `# ${data.videoTitle || 'YouTube Transcript'}\n\n`;
      if (data.videoUrl) output += `> **Source:** [YouTube Video](${data.videoUrl})\n\n`;
      output += `## Transcript\n\n`;
      lines.forEach((line) => {
        output += settings.timestamps ? `- **\`[${line.timestamp}]\`** ${line.text.trim()}\n` : `- ${line.text.trim()}\n`;
      });
      return output;
    }
    case 'json': {
      return JSON.stringify({ title: data.videoTitle, url: data.videoUrl, transcript: lines }, null, 2);
    }
    case 'csv': {
      let output = 'Timestamp,Text\n';
      lines.forEach((line) => {
        const textEscaped = `"${line.text.replace(/"/g, '""').trim()}"`;
        output += `"${line.timestamp}",${textEscaped}\n`;
      });
      return output;
    }
    case 'txt':
    default:
      return formatTranscript(data, settings);
  }
}

// ---- Error & Success Message Helper ----
function getErrorMessage(code) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  return dict.errors?.[code] || TRANSLATIONS.en.errors[code] || `Something went wrong (${code}).`;
}

// ---- Main copy handler ----
async function handleCopy() {
  const copyBtn = $('#copy-btn');
  if (copyBtn) copyBtn.disabled = true;
  showState('loading');

  try {
    const langSelect = $('#transcript-lang-select');
    const selectedLangName = (langSelect && !langSelect.closest('.hidden') && langSelect.options[langSelect.selectedIndex]?.text) || cachedData?.captionLanguage || null;
    const data = await extractTranscript(selectedLangName);

    if (!data || !data.success) {
      const code = data?.error || 'unknown';
      const msg = getErrorMessage(code);
      showState('error', msg);
      return;
    }

    cachedData = data;

    const settings = getSettings();
    const text = formatTranscript(data, settings);
    const ok = await copyToClipboard(text);

    if (ok) {
      const count = data.lines.length;
      const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      const msg = dict.copiedSuccess
        ? dict.copiedSuccess(count)
        : TRANSLATIONS.en.copiedSuccess(count);

      showState('success', msg);
      updatePreview();
      recordSuccessfulUsageAndCheckRating();

      // Return to original Shorts page if applicable
      if (data.originalShortsUrl && data.activeTabId) {
        chrome.tabs.update(data.activeTabId, { url: data.originalShortsUrl }).catch(() => {});
      }

      setTimeout(() => showState('idle'), 2500);
    } else {
      showState('error', 'Clipboard write failed.');
    }
  } catch (err) {
    console.error('[YT Transcript Copier]', err);
    showState('error', 'Unexpected error. Try refreshing YouTube.');
  } finally {
    if (copyBtn) copyBtn.disabled = false;
  }
}

// ---- Download handler ----
async function handleDownload() {
  if (!cachedData) {
    // No cached data — extract first
    await handleCopy();
  }
  if (!cachedData) return; // extraction failed

  const format = $('#export-format')?.value || 'txt';
  const settings = getSettings();
  const text = exportToFormat(cachedData, format, settings);

  const extension = `.${format}`;
  const filename = (cachedData.videoTitle || 'transcript')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) + extension;

  const mimeTypes = {
    txt: 'text/plain;charset=utf-8',
    srt: 'text/plain;charset=utf-8',
    vtt: 'text/vtt;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
  };

  const blob = new Blob([text], { type: mimeTypes[format] || 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}

// ==================================================================
// v2.6.0 AI WORKSPACE ENGINE & CLIP NOTES
// ==================================================================

const AI_ACTION_PRESETS = Object.freeze({
  summarize: 'Summarize the following transcript excerpt in concise, high-impact bullet points:',
  explain: 'Explain the key concepts and arguments discussed in this excerpt in clear, simple terms with examples:',
  action_items: 'Extract all actionable steps, recommendations, and key takeaways from this excerpt:',
  translate: 'Translate the following transcript excerpt accurately into English, preserving tone and terminology:',
  clip_notes_synthesis: 'Synthesize these key marked moments from the video into an organized, cohesive study guide / executive summary:',
});

function buildTimestampUrl(baseUrl, seconds) {
  if (!baseUrl) return '';
  const cleanSec = Math.max(0, Math.floor(seconds || 0));
  const stripped = baseUrl.replace(/[?&]t=\d+s?/, '');
  const joiner = stripped.includes('?') ? '&' : '?';
  return `${stripped}${joiner}t=${cleanSec}s`;
}

function generateClipNotes(segments, markedIndices, metadata = {}) {
  if (!Array.isArray(segments)) return '';
  const markSet = markedIndices instanceof Set ? markedIndices : new Set(markedIndices || []);
  const markedList = segments
    .map((seg, idx) => ({ seg, idx }))
    .filter((item) => markSet.has(item.idx))
    .sort((a, b) => a.idx - b.idx);

  if (markedList.length === 0) return '';

  const title = metadata.title || 'Untitled Video';
  const url = metadata.url || '';

  let out = `# 📝 Clip Notes: ${title}\n`;
  if (url) {
    out += `> **Source:** [${title}](${url})\n`;
  }
  out += `> **Marked Moments:** ${markedList.length}\n\n`;
  out += `## Key Moments\n\n`;

  markedList.forEach(({ seg }) => {
    const sec = seg.startSeconds !== undefined ? seg.startSeconds : parseTimestampToSeconds(seg.timestamp);
    const tsLink = url ? buildTimestampUrl(url, sec) : '';
    const tsText = seg.timestamp ? `[${seg.timestamp}]` : '';
    const linkFormatted = tsLink ? `[⏱️ ${seg.timestamp}](${tsLink})` : `⏱️ ${tsText}`;
    out += `- ${linkFormatted} ${seg.text.trim()}\n`;
  });

  return out;
}

function buildAiPayload({
  title = '',
  url = '',
  segments = [],
  scope = 'full',
  selectedIndices = [],
  markedIndices = [],
  singleIndex = -1,
  actionKey = 'summarize',
  customPrompt = '',
  includeTimestamps = true,
} = {}) {
  let targetSegments = [];

  switch (scope) {
    case 'selection': {
      const set = new Set(selectedIndices || []);
      targetSegments = segments.filter((_, idx) => set.has(idx));
      break;
    }
    case 'marks': {
      const set = new Set(markedIndices || []);
      targetSegments = segments.filter((_, idx) => set.has(idx));
      break;
    }
    case 'segment': {
      if (singleIndex >= 0 && singleIndex < segments.length) {
        targetSegments = [segments[singleIndex]];
      }
      break;
    }
    case 'full':
    default: {
      targetSegments = [...segments];
      break;
    }
  }

  if (targetSegments.length === 0) {
    targetSegments = [...segments];
  }

  const directive = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : (actionKey && AI_ACTION_PRESETS[actionKey] ? AI_ACTION_PRESETS[actionKey] : '');

  let body = '';
  targetSegments.forEach((seg) => {
    if (includeTimestamps && seg.timestamp) {
      body += `[${seg.timestamp}] ${seg.text.trim()}\n`;
    } else {
      body += `${seg.text.trim()}\n`;
    }
  });

  let payload = '';
  if (directive) {
    payload += `${directive}\n\n`;
  }
  payload += `---\n`;
  if (title) payload += `Video: ${title}\n`;
  if (url) payload += `URL: ${url}\n`;
  if (scope !== 'full') payload += `Scope: ${scope.toUpperCase()} (${targetSegments.length} segments)\n`;
  payload += `---\n\n`;
  payload += body.trim();

  return {
    directive,
    scope,
    segmentCount: targetSegments.length,
    characterCount: payload.length,
    text: payload,
  };
}

async function dispatchToAI(text, service = 'chatgpt') {
  const serviceNames = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
  };
  const displayName = serviceNames[service] || service;

  try {
    await copyToClipboard(text);
    await chrome.storage.local.set({
      pending_ai_prompt: {
        text,
        timestamp: Date.now(),
        service,
      },
    });

    const aiUrls = {
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/new',
      gemini: 'https://gemini.google.com/app',
    };
    const url = aiUrls[service] || aiUrls.chatgpt;
    await chrome.tabs.create({ url, active: true });

    showState('success', `Copied & opening ${displayName}! Auto-pasting...`);
    setTimeout(() => showState('idle'), 3000);
  } catch (err) {
    console.error('[YT Transcript Copier AI Bridge]', err);
    showState('error', `Failed to open ${displayName}.`);
  }
}

// ---- Main AI Web Bridge Handler ----
async function sendToAI(service) {
  showState('loading');

  try {
    if (!cachedData) {
      const data = await extractTranscript();
      if (!data || !data.success) {
        const code = data?.error || 'unknown';
        const msg = getErrorMessage(code);
        showState('error', msg);
        return;
      }
      cachedData = data;
      updatePreview();
    }

    const settings = getSettings();
    let textToSend = '';

    // Context-aware: If user has selections active, prioritize selection!
    if (selectedSegmentIndices.size > 0) {
      const payload = buildAiPayload({
        title: cachedData.videoTitle,
        url: cachedData.videoUrl,
        segments: cachedData.lines,
        scope: 'selection',
        selectedIndices: Array.from(selectedSegmentIndices),
        customPrompt: settings.promptPrepend,
        includeTimestamps: settings.timestamps,
      });
      textToSend = payload.text;
    } else {
      textToSend = formatTranscript(cachedData, settings);
    }

    checkAndSendToAI(service, textToSend);
  } catch (err) {
    console.error('[YT Transcript Copier AI Bridge]', err);
    showState('error', 'Failed to prepare transcript for AI.');
  }
}

// ---- Bind events ----
const copyBtn = $('#copy-btn');
if (copyBtn) copyBtn.addEventListener('click', handleCopy);

const dlBtn = $('#download-btn');
if (dlBtn) dlBtn.addEventListener('click', handleDownload);

// AI Bridge Buttons
function dispatchSendToAI(service) {
  if ($('#tab-batch')?.classList.contains('active') && batchResults.length > 0) {
    const settings = getBatchSettings();
    const successResults = batchResults.filter((r) => r.success);
    let merged = '';
    successResults.forEach((r, idx) => {
      if (settings.title) {
        merged += `📺 ${r.videoTitle}\n`;
      }
      if (settings.url && r.videoUrl) {
        merged += `🔗 ${r.videoUrl}\n`;
      }
      if (settings.title || (settings.url && r.videoUrl)) {
        merged += `${'─'.repeat(40)}\n\n`;
      }
      merged += formatTranscript(r, settings);
      if (idx < successResults.length - 1) merged += '\n\n';
    });
    checkAndSendToAI(service, merged);
  } else {
    sendToAI(service);
  }
}

$('#ai-chatgpt')?.addEventListener('click', () => dispatchSendToAI('chatgpt'));
$('#ai-claude')?.addEventListener('click', () => dispatchSendToAI('claude'));
$('#ai-gemini')?.addEventListener('click', () => dispatchSendToAI('gemini'));


// ==================================================================
// RATING & SUPPORT PROMPT ENGINE (v2.7.1)
// ==================================================================

const RATING_STORAGE_KEY = 'ytc_rating_prompt_state';
const RATING_THRESHOLD_COUNT = 3; // Trigger gently after 3 successful copies or exports

async function getRatingPromptState() {
  try {
    const res = await chrome.storage.local.get(RATING_STORAGE_KEY);
    return res[RATING_STORAGE_KEY] || {
      usageCount: 0,
      dismissed: false,
      snoozedUntil: 0,
    };
  } catch {
    return { usageCount: 0, dismissed: false, snoozedUntil: 0 };
  }
}

async function saveRatingPromptState(state) {
  try {
    await chrome.storage.local.set({ [RATING_STORAGE_KEY]: state });
  } catch (err) {
    console.warn('[YT Transcript Copier] Could not save rating state:', err);
  }
}

async function recordSuccessfulUsageAndCheckRating() {
  try {
    const state = await getRatingPromptState();
    if (state.dismissed) return;

    state.usageCount = (state.usageCount || 0) + 1;
    await saveRatingPromptState(state);

    const now = Date.now();
    if (state.usageCount >= RATING_THRESHOLD_COUNT && (!state.snoozedUntil || now >= state.snoozedUntil)) {
      showRatingPrompt();
    }
  } catch {}
}

function showRatingPrompt() {
  const overlay = $('#rating-prompt-overlay') || $('#rating-prompt-card');
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function hideRatingPrompt() {
  const overlay = $('#rating-prompt-overlay') || $('#rating-prompt-card');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function initRatingPrompt() {
  const overlay = $('#rating-prompt-overlay');
  const card = $('#rating-prompt-card');
  if (!overlay && !card) return;

  const btnYes = $('#rating-btn-yes');
  const btnNo = $('#rating-btn-no');
  const btnNever = $('#rating-btn-never');
  const btnClose = $('#rating-btn-close');

  if (btnYes) {
    btnYes.addEventListener('click', async () => {
      hideRatingPrompt();
      const state = await getRatingPromptState();
      state.dismissed = true;
      await saveRatingPromptState(state);

      // Open Chrome Web Store review tab
      const reviewUrl = 'https://chromewebstore.google.com/detail/youtube-transcript-copier/khbenieolkkkjjokcfklaokfpdblkgbn/reviews';
      chrome.tabs.create({ url: reviewUrl }).catch(() => {
        window.open(reviewUrl, '_blank');
      });
    });
  }

  if (btnNo) {
    btnNo.addEventListener('click', async () => {
      hideRatingPrompt();
      const state = await getRatingPromptState();
      // Snooze for 5 days
      state.snoozedUntil = Date.now() + (5 * 24 * 60 * 60 * 1000);
      await saveRatingPromptState(state);
    });
  }

  if (btnNever) {
    btnNever.addEventListener('click', async () => {
      hideRatingPrompt();
      const state = await getRatingPromptState();
      state.dismissed = true;
      await saveRatingPromptState(state);
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', async () => {
      hideRatingPrompt();
      const state = await getRatingPromptState();
      // Snooze for 3 days
      state.snoozedUntil = Date.now() + (3 * 24 * 60 * 60 * 1000);
      await saveRatingPromptState(state);
    });
  }

  // Dismiss when clicking the blurred background overlay
  if (overlay) {
    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) {
        hideRatingPrompt();
        const state = await getRatingPromptState();
        state.snoozedUntil = Date.now() + (3 * 24 * 60 * 60 * 1000);
        await saveRatingPromptState(state);
      }
    });
  }



  // Check on startup
  getRatingPromptState().then((state) => {
    const now = Date.now();
    if (!state.dismissed && state.usageCount >= RATING_THRESHOLD_COUNT && (!state.snoozedUntil || now >= state.snoozedUntil)) {
      showRatingPrompt();
    }
  }).catch(() => {});
}

// ---- Load persisted settings & Auto-copy on open ----
loadSettings().then(async () => {
  initRatingPrompt();
  const s = getSettings();
  if (s.autoCopy) {
    // Trigger copy automatically on open
    await handleCopy();
  }
});

// ==================================================================
// BATCH MODE — Multi-Video Transcript Extraction
// ==================================================================

const BATCH_TOKEN_WARN_LIMIT = 100000; // ~100k characters
let batchVideos = [];          // All scanned videos from the page
let batchPlaylistVideos = [];  // Playlist group videos
let batchOtherVideos = [];     // Recommended / other / bottom videos
let batchHasPlaylist = false;  // Whether page has an active playlist
let batchPlaylistInfo = null;  // Playlist metadata
let batchSelectedIds = new Set();
let batchResults = [];         // Transcript results
let batchCancelled = false;

// ---- Single/Batch panel references ----
const singlePanel = $('#single-panel');
const batchPanel = $('#batch-panel');

// ---- Batch-Specific Settings ----
function getBatchSettings() {
  const activeBtn = document.querySelector('#batch-format-control .seg-btn.active');
  return {
    format: activeBtn?.dataset?.value || 'lines',
    timestamps: $('#batch-include-timestamps')?.checked ?? true,
    title: $('#batch-include-title')?.checked ?? true,
    url: $('#batch-include-url')?.checked ?? true,
    cleanDuplicates: $('#batch-clean-duplicates')?.checked ?? false,
    promptPrepend: '',
    autoCopy: false,
  };
}

// ---- Batch Format Section Toggle (Collapsible) ----
$('#batch-format-toggle')?.addEventListener('click', () => {
  const section = document.querySelector('.batch-format-section');
  if (section) section.classList.toggle('collapsed');
});

// ---- Batch Segmented Control ----
$$('#batch-format-control .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#batch-format-control .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ---- Mode Tab Switching ----
$$('.mode-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.mode-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const mode = tab.dataset.mode;
    if (mode === 'batch') {
      // Hide single panel, show batch panel
      if (singlePanel) singlePanel.classList.add('hidden');
      if (batchPanel) batchPanel.classList.remove('hidden');
      // Auto-scan if no videos scanned yet
      if (!batchVideos || !batchVideos.length) {
        $('#batch-scan-btn')?.click();
      }
    } else {
      // Show single panel, hide batch panel
      if (singlePanel) singlePanel.classList.remove('hidden');
      if (batchPanel) batchPanel.classList.add('hidden');
      showState('idle');
    }
  });
});

// ---- Scan Page for Videos (Option B) ----
$('#batch-scan-btn')?.addEventListener('click', async () => {
  try {
    const countEl = $('#batch-video-count');
    const list = $('#batch-video-list');

    if (countEl) {
      countEl.textContent = getTranslation('batchScanning') || 'Scanning YouTube page...';
      countEl.style.color = '';
    }
    if (list && (!batchVideos || !batchVideos.length)) {
      list.innerHTML = `<p class="batch-placeholder">${getTranslation('batchScanning') || 'Scanning for videos...'}</p>`;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url?.includes('youtube.com')) {
      showBatchError(getTranslation('batchNavToYouTube') || 'Navigate to a YouTube channel, playlist, or video first.');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['batch_content.js'],
    });

    const data = results?.[0]?.result;
    if (!data?.success || !data.videos?.length) {
      showBatchError(getTranslation('batchNoVideosFound') || 'No videos found on this page. Try scrolling down to load more.');
      return;
    }

    batchVideos = data.videos || [];
    batchPlaylistVideos = data.playlistVideos || [];
    batchOtherVideos = data.otherVideos || [];
    batchHasPlaylist = Boolean(data.hasPlaylist && batchPlaylistVideos.length > 0);
    batchPlaylistInfo = data.playlistInfo || null;
    batchSelectedIds.clear();

    // Update UI
    const pageTypeEl = $('#batch-page-type');
    if (pageTypeEl) {
      pageTypeEl.textContent = batchHasPlaylist
        ? 'playlist'
        : (data.pageType || 'page');
    }
    if (countEl) {
      const vWord = getTranslation('batchVideos') || 'videos';
      if (batchHasPlaylist) {
        countEl.textContent = `${batchPlaylistVideos.length} playlist + ${batchOtherVideos.length} other`;
      } else {
        countEl.textContent = `${data.videoCount} ${vWord}`;
      }
      countEl.style.color = '';
    }

    renderBatchVideoList();
  } catch (err) {
    showBatchError(getTranslation('batchScanFailed') || 'Failed to scan page. Try refreshing YouTube.');
  }
});

// ---- Page Overlay (Option A) ----
$('#batch-overlay-btn')?.addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url?.includes('youtube.com')) {
      showBatchError(getTranslation('batchNavToYouTube') || 'Navigate to a YouTube page first.');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['batch_overlay.js'],
    });

    showBatchSuccess(getTranslation('batchOverlayInjected') || 'Overlay injected! Select videos on the YouTube page.');
  } catch (err) {
    showBatchError(getTranslation('batchScanFailed') || 'Failed to inject overlay.');
  }
});

// ---- Helper: Render Video Item HTML ----
function renderBatchItemHtml(v, group) {
  return `
    <div class="batch-video-item" data-video-id="${v.videoId}" data-group="${group || 'other'}">
      <input type="checkbox" class="batch-video-check" data-video-id="${v.videoId}" data-group="${group || 'other'}"
        ${batchSelectedIds.has(v.videoId) ? 'checked' : ''} />
      ${v.thumbnail ? `<img class="batch-video-thumb" src="${v.thumbnail}" alt="" />` : ''}
      <div class="batch-video-info">
        <div class="batch-video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</div>
        <div class="batch-video-meta">${v.isShort ? 'Short' : 'Video'}${v.duration ? ' · ' + v.duration : ''}</div>
      </div>
      <div class="batch-video-status batch-status-pending" id="batch-status-${v.videoId}"></div>
    </div>
  `;
}

// ---- Render Video List ----
function renderBatchVideoList() {
  const list = $('#batch-video-list');
  if (!list) return;

  if (!batchVideos.length) {
    const noVideosText = getTranslation('batchNoVideos') || 'No videos detected yet.';
    list.innerHTML = `<p class="batch-placeholder">${escapeHtml(noVideosText)}</p>`;
    return;
  }

  if (batchHasPlaylist && batchPlaylistVideos.length > 0) {
    const plTitle = batchPlaylistInfo?.title || 'Playlist';
    const plCountText = batchPlaylistInfo?.countText ? ` (${batchPlaylistInfo.countText})` : '';
    const plGroupLabel = getTranslation('batchPlaylistGroup') || 'Playlist:';
    const otherGroupLabel = getTranslation('batchOtherGroup') || 'Other Videos (Bottom / Recommendations)';
    const videosLabel = getTranslation('batchVideos') || 'videos';

    let html = `
      <div class="batch-group-box playlist-box">
        <div class="batch-group-header">
          <div class="batch-group-header-left">
            <input type="checkbox" id="batch-select-playlist" class="batch-group-master-check" title="Select all in playlist" />
            <div class="batch-group-title" title="${escapeHtml(plTitle)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15V6M18.5 18a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12 12H3M16 6H3M12 18H3"/>
              </svg>
              <span>${escapeHtml(plGroupLabel)} <strong>${escapeHtml(plTitle)}</strong>${escapeHtml(plCountText)}</span>
            </div>
          </div>
          <span class="batch-group-badge">${batchPlaylistVideos.length} ${escapeHtml(videosLabel)}</span>
        </div>
        <div class="batch-group-items">
          ${batchPlaylistVideos.map((v) => renderBatchItemHtml(v, 'playlist')).join('')}
        </div>
      </div>
    `;

    if (batchOtherVideos.length > 0) {
      html += `
        <div class="batch-group-box other-box">
          <div class="batch-group-header">
            <div class="batch-group-header-left">
              <input type="checkbox" id="batch-select-other" class="batch-group-master-check" title="Select all other videos" />
              <div class="batch-group-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <polygon points="10 8 16 11 10 14 10 8"/>
                </svg>
                <span>${escapeHtml(otherGroupLabel)}</span>
              </div>
            </div>
            <span class="batch-group-badge">${batchOtherVideos.length} ${escapeHtml(videosLabel)}</span>
          </div>
          <div class="batch-group-items">
            ${batchOtherVideos.map((v) => renderBatchItemHtml(v, 'other')).join('')}
          </div>
        </div>
      `;
    }

    list.innerHTML = html;

    // Playlist Group Master Checkbox
    $('#batch-select-playlist')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      batchPlaylistVideos.forEach((v) => {
        if (checked) batchSelectedIds.add(v.videoId);
        else batchSelectedIds.delete(v.videoId);
      });
      list.querySelectorAll('.batch-video-check[data-group="playlist"]').forEach((cb) => {
        cb.checked = checked;
      });
      updateBatchSelectedCount();
    });

    // Other Group Master Checkbox
    $('#batch-select-other')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      batchOtherVideos.forEach((v) => {
        if (checked) batchSelectedIds.add(v.videoId);
        else batchSelectedIds.delete(v.videoId);
      });
      list.querySelectorAll('.batch-video-check[data-group="other"]').forEach((cb) => {
        cb.checked = checked;
      });
      updateBatchSelectedCount();
    });
  } else {
    // Non-playlist flat list
    list.innerHTML = batchVideos.map((v) => renderBatchItemHtml(v, 'other')).join('');
  }

  // Individual checkbox click handlers
  list.querySelectorAll('.batch-video-check').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const vid = e.target.dataset.videoId;
      if (e.target.checked) batchSelectedIds.add(vid);
      else batchSelectedIds.delete(vid);
      updateBatchSelectedCount();
    });
  });

  // Click row to toggle
  list.querySelectorAll('.batch-video-item').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      const cb = row.querySelector('.batch-video-check');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
    });
  });

  updateBatchSelectedCount();
}

// ---- Master Select All ----
$('#batch-select-all')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  batchVideos.forEach((v) => {
    if (checked) batchSelectedIds.add(v.videoId);
    else batchSelectedIds.delete(v.videoId);
  });
  $$('.batch-video-check').forEach((cb) => { cb.checked = checked; });
  const plCheck = $('#batch-select-playlist');
  if (plCheck) { plCheck.checked = checked; plCheck.indeterminate = false; }
  const otherCheck = $('#batch-select-other');
  if (otherCheck) { otherCheck.checked = checked; otherCheck.indeterminate = false; }
  updateBatchSelectedCount();
});

function updateBatchSelectedCount() {
  const count = batchSelectedIds.size;
  const countEl = $('#batch-selected-count');
  const extractBtn = $('#batch-extract-btn');
  const selectedWord = getTranslation('batchSelected') || 'selected';
  const startText = getTranslation('batchStartExtract') || 'Start Extraction';
  if (countEl) countEl.textContent = `${count} ${selectedWord}`;
  if (extractBtn) {
    extractBtn.textContent = `${startText} (${count})`;
    extractBtn.disabled = count === 0;
  }

  // Synchronize Playlist group checkbox
  if (batchHasPlaylist && batchPlaylistVideos.length > 0) {
    const plCb = $('#batch-select-playlist');
    if (plCb) {
      const plCount = batchPlaylistVideos.filter((v) => batchSelectedIds.has(v.videoId)).length;
      plCb.checked = plCount === batchPlaylistVideos.length;
      plCb.indeterminate = plCount > 0 && plCount < batchPlaylistVideos.length;
    }
  }

  // Synchronize Other group checkbox
  if (batchHasPlaylist && batchOtherVideos.length > 0) {
    const otherCb = $('#batch-select-other');
    if (otherCb) {
      const otherCount = batchOtherVideos.filter((v) => batchSelectedIds.has(v.videoId)).length;
      otherCb.checked = otherCount === batchOtherVideos.length;
      otherCb.indeterminate = otherCount > 0 && otherCount < batchOtherVideos.length;
    }
  }

  // Synchronize Master Select All checkbox
  const masterCb = $('#batch-select-all');
  if (masterCb && batchVideos.length > 0) {
    masterCb.checked = count === batchVideos.length;
    masterCb.indeterminate = count > 0 && count < batchVideos.length;
  }

  // Sync selection to the page overlay (if active)
  syncSelectionToOverlay();
}

/** Push the popup's current selection to the page overlay checkboxes */
async function syncSelectionToOverlay() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, {
      action: 'sync-selection-to-overlay',
      videoIds: Array.from(batchSelectedIds),
    }).catch(() => {});
  } catch { /* overlay may not be injected */ }
}

let batchIsPaused = false;

function resetBatchButtons() {
  const pauseBtn = $('#batch-pause-btn');
  const resumeBtn = $('#batch-resume-btn');
  const extractBtn = $('#batch-extract-btn');
  if (pauseBtn) pauseBtn.classList.remove('hidden');
  if (resumeBtn) resumeBtn.classList.add('hidden');
  if (extractBtn) {
    const count = batchSelectedIds.size;
    const startText = getTranslation('batchStartExtract') || 'Start Extraction';
    extractBtn.textContent = `${startText} (${count})`;
    extractBtn.disabled = count === 0;
  }
  batchIsPaused = false;
}

// ---- Batch Extract ----
$('#batch-extract-btn')?.addEventListener('click', () => {
  if (batchSelectedIds.size === 0) return;

  const videoIds = Array.from(batchSelectedIds);
  batchResults = [];
  batchCancelled = false;
  batchIsPaused = false;

  // Show progress and reset control buttons
  const progressEl = $('#batch-progress');
  if (progressEl) progressEl.classList.remove('hidden');
  const pauseBtn = $('#batch-pause-btn');
  const resumeBtn = $('#batch-resume-btn');
  if (pauseBtn) pauseBtn.classList.remove('hidden');
  if (resumeBtn) resumeBtn.classList.add('hidden');

  const extractBtn = $('#batch-extract-btn');
  if (extractBtn) {
    extractBtn.textContent = getTranslation('batchExtractionInProgress') || 'Extraction in Progress...';
    extractBtn.disabled = true;
  }

  updateBatchProgress(0, videoIds.length);

  // Send to background for processing (query active tab to pass tabId)
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTabId = tabs?.[0]?.id;
    chrome.runtime.sendMessage({
      action: 'batch-extract-start',
      videoIds,
      tabId: activeTabId,
      overrideLimit: false,
    }, (response) => {
      if (response?.overLimit) {
        showBatchSuccess(`Limited to 25 videos. Processing ${response.count}...`);
      }
    });
  });
});

// ---- Pause / Stop ----
$('#batch-pause-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'batch-pause' }, (res) => {
    batchIsPaused = true;
    $('#batch-pause-btn')?.classList.add('hidden');
    $('#batch-resume-btn')?.classList.remove('hidden');
    const text = $('#batch-progress-text');
    if (text) text.textContent = 'Extraction paused. Click Continue to proceed.';
  });
});

// ---- Continue / Resume ----
$('#batch-resume-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'batch-resume' }, (res) => {
    batchIsPaused = false;
    $('#batch-resume-btn')?.classList.add('hidden');
    $('#batch-pause-btn')?.classList.remove('hidden');
    const text = $('#batch-progress-text');
    if (text) text.textContent = 'Resuming extraction...';
  });
});

// ---- Finish & Export Early ----
$('#batch-stop-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'batch-stop' }, (res) => {
    const progressEl = $('#batch-progress');
    if (progressEl) progressEl.classList.add('hidden');
    resetBatchButtons();
    if (batchResults.length > 0) {
      showBatchSuccess(`Stopped early. Processing ${batchResults.length} extracted transcript(s)...`);
      handleBatchExport();
    } else {
      showBatchSuccess('Batch extraction stopped.');
    }
  });
});

// ---- Cancel ----
$('#batch-cancel-btn')?.addEventListener('click', () => {
  batchCancelled = true;
  chrome.runtime.sendMessage({ action: 'batch-stop' }).catch(() => {});
  const progressEl = $('#batch-progress');
  if (progressEl) progressEl.classList.add('hidden');
  resetBatchButtons();
  showBatchSuccess('Batch extraction cancelled.');
});

// ---- Listen for progress messages from background & overlay sync ----
chrome.runtime.onMessage.addListener((msg) => {
  // Handle overlay selection changes (sync overlay → popup)
  if (msg.action === 'overlay-selection-changed') {
    const overlayIds = new Set(msg.videoIds || []);
    batchSelectedIds = overlayIds;
    // Update popup checkboxes to match
    $$('.batch-video-check').forEach((cb) => {
      cb.checked = overlayIds.has(cb.dataset.videoId);
    });
    // Update count without re-syncing back to overlay
    const count = batchSelectedIds.size;
    const countEl = $('#batch-selected-count');
    const extractBtn = $('#batch-extract-btn');
    const selectedWord = getTranslation('batchSelected') || 'selected';
    const startText = getTranslation('batchStartExtract') || 'Start Extraction';
    if (countEl) countEl.textContent = `${count} ${selectedWord}`;
    if (extractBtn) {
      extractBtn.textContent = `${startText} (${count})`;
      extractBtn.disabled = count === 0;
    }
    // Update Select All checkbox state
    const selectAllCb = $('#batch-select-all');
    if (selectAllCb && batchVideos.length > 0) {
      selectAllCb.checked = count === batchVideos.length;
      selectAllCb.indeterminate = count > 0 && count < batchVideos.length;
    }
    // Update group checkboxes
    if (batchHasPlaylist && batchPlaylistVideos.length > 0) {
      const plCb = $('#batch-select-playlist');
      if (plCb) {
        const plCount = batchPlaylistVideos.filter((v) => overlayIds.has(v.videoId)).length;
        plCb.checked = plCount === batchPlaylistVideos.length;
        plCb.indeterminate = plCount > 0 && plCount < batchPlaylistVideos.length;
      }
    }
    if (batchHasPlaylist && batchOtherVideos.length > 0) {
      const otherCb = $('#batch-select-other');
      if (otherCb) {
        const otherCount = batchOtherVideos.filter((v) => overlayIds.has(v.videoId)).length;
        otherCb.checked = otherCount === batchOtherVideos.length;
        otherCb.indeterminate = otherCount > 0 && otherCount < batchOtherVideos.length;
      }
    }
    return;
  }

  if (batchCancelled) return;

  if (msg.action === 'batch-progress') {
    updateBatchProgress(msg.current, msg.total, msg.videoId, msg.statusText);
  }

  if (msg.action === 'batch-paused') {
    batchIsPaused = true;
    $('#batch-pause-btn')?.classList.add('hidden');
    $('#batch-resume-btn')?.classList.remove('hidden');
    const text = $('#batch-progress-text');
    if (text) text.textContent = msg.statusText || 'Extraction paused.';
  }

  if (msg.action === 'batch-resumed') {
    batchIsPaused = false;
    $('#batch-resume-btn')?.classList.add('hidden');
    $('#batch-pause-btn')?.classList.remove('hidden');
    const text = $('#batch-progress-text');
    if (text) text.textContent = msg.statusText || 'Resuming extraction...';
  }

  if (msg.action === 'batch-video-result') {
    batchResults.push(msg.result);
    // Update status icon on the video item
    const statusEl = $(`#batch-status-${msg.result.videoId}`);
    if (statusEl) {
      if (msg.result.success) {
        statusEl.className = 'batch-video-status batch-status-ok';
        statusEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else {
        statusEl.className = 'batch-video-status batch-status-fail';
        statusEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      }
    }
    updateBatchProgress(msg.current, msg.total);
  }

  if (msg.action === 'batch-stopped') {
    const progressEl = $('#batch-progress');
    if (progressEl) progressEl.classList.add('hidden');
    resetBatchButtons();
    batchResults = msg.results || batchResults;
    const ok = msg.successCount || batchResults.filter((r) => r.success).length;
    showBatchSuccess(`Stopped! ${ok} transcripts extracted.`);
    if (ok > 0) {
      handleBatchExport();
    }
  }

  if (msg.action === 'batch-complete') {
    const progressEl = $('#batch-progress');
    if (progressEl) progressEl.classList.add('hidden');
    resetBatchButtons();
    batchResults = msg.results || batchResults;
    const ok = msg.successCount || 0;
    const fail = msg.failCount || 0;
    showBatchSuccess(`Done! ${ok} extracted, ${fail} failed.`);
    handleBatchExport();
  }

  if (msg.action === 'batch-error') {
    const progressEl = $('#batch-progress');
    if (progressEl) progressEl.classList.add('hidden');
    resetBatchButtons();
    showBatchError(msg.error || 'Batch extraction failed.');
  }
});

function updateBatchProgress(current, total, videoId, statusText) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = $('#batch-progress-bar');
  const text = $('#batch-progress-text');
  const detail = $('#batch-progress-detail');
  if (bar) bar.style.width = `${pct}%`;
  if (text) {
    if (statusText) {
      text.textContent = statusText;
    } else {
      const proc = getTranslation('batchProgressProcessing') || 'Processing video';
      text.textContent = `${proc} ${current} / ${total}...`;
    }
  }
  if (detail) detail.textContent = `${current} / ${total}`;
}

// ---- Batch Export ----
function handleBatchExport() {
  const successResults = batchResults.filter((r) => r.success);
  if (!successResults.length) {
    showBatchError('Extraction failed: No transcripts could be retrieved for selected videos.');
    return;
  }

  const exportMode = $('#batch-export-mode')?.value || 'single';
  const fileFormat = $('#batch-file-format')?.value || 'txt';
  const settings = getBatchSettings();

  const mimeTypes = {
    txt: 'text/plain;charset=utf-8',
    srt: 'text/plain;charset=utf-8',
    vtt: 'text/vtt;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
  };

  if (exportMode === 'single') {
    // Single merged file
    if (fileFormat === 'json') {
      // Special JSON merged output
      const jsonData = successResults.map((r) => ({
        title: r.videoTitle,
        url: r.videoUrl,
        transcript: settings.cleanDuplicates ? deduplicateLines([...r.lines]) : r.lines,
      }));
      const text = JSON.stringify(jsonData, null, 2);
      const blob = new Blob([text], { type: mimeTypes.json });
      downloadBlob(blob, `batch_transcripts_${successResults.length}_videos.json`);
    } else if (fileFormat === 'csv') {
      // Merged CSV with video title column
      let csv = 'Video,Timestamp,Text\n';
      successResults.forEach((r) => {
        let lines = [...r.lines];
        if (settings.cleanDuplicates) lines = deduplicateLines(lines);
        lines.forEach((line) => {
          const titleEsc = `"${(r.videoTitle || '').replace(/"/g, '""')}"`;
          const textEsc = `"${line.text.replace(/"/g, '""').trim()}"`;
          csv += `${titleEsc},"${line.timestamp}",${textEsc}\n`;
        });
      });
      const blob = new Blob([csv], { type: mimeTypes.csv });
      downloadBlob(blob, `batch_transcripts_${successResults.length}_videos.csv`);
    } else {
      // txt, srt, vtt, md — merge with per-video headers
      let merged = '';
      successResults.forEach((r, idx) => {
        if (settings.title) {
          merged += `${'═'.repeat(50)}\n`;
          merged += `📺 ${r.videoTitle}\n`;
        }
        if (settings.url && r.videoUrl) {
          merged += `🔗 ${r.videoUrl}\n`;
        }
        if (settings.title || (settings.url && r.videoUrl)) {
          merged += `${'─'.repeat(50)}\n\n`;
        }
        merged += exportToFormat(r, fileFormat, settings);
        if (idx < successResults.length - 1) merged += '\n\n';
      });

      const blob = new Blob([merged], { type: mimeTypes[fileFormat] || mimeTypes.txt });
      downloadBlob(blob, `batch_transcripts_${successResults.length}_videos.${fileFormat}`);
    }
  } else {
    // Separate files as ZIP
    generateZip(successResults, settings, fileFormat);
  }
}

function downloadBlob(blob, filename) {
  recordSuccessfulUsageAndCheckRating();
  const objectUrl = URL.createObjectURL(blob);
  if (chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: objectUrl,
      filename: filename,
      saveAs: true,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        // Fallback to traditional anchor click if chrome.downloads fails
        fallbackAnchorDownload(objectUrl, filename);
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    });
  } else {
    fallbackAnchorDownload(objectUrl, filename);
  }
}

function fallbackAnchorDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

function sanitizeZipFilename(rawTitle, defaultName, extension, usedNames) {
  let clean = (rawTitle || '')
    .normalize('NFC')
    .replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');

  if (!clean) {
    clean = (defaultName || 'transcript')
      .replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/^[._]+|[._]+$/g, '') || 'transcript';
  }

  clean = clean.slice(0, 60).replace(/[._]+$/, '');

  let finalName = `${clean}.${extension}`;
  let counter = 2;
  while (usedNames.has(finalName.toLowerCase())) {
    finalName = `${clean}_${counter}.${extension}`;
    counter++;
  }
  usedNames.add(finalName.toLowerCase());
  return finalName;
}

async function generateZip(results, settings, fileFormat = 'txt') {
  // Robust UTF-8 uncompressed ZIP creation
  const usedNames = new Set();
  const files = results.map((r) => {
    const name = sanitizeZipFilename(r.videoTitle, r.videoId, fileFormat, usedNames);
    const text = exportToFormat(r, fileFormat, settings);
    const content = new TextEncoder().encode(text);
    return { name, content };
  });

  const zipParts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    // Local file header
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(4, 20, true); // version needed to extract (2.0)
    view.setUint16(6, 0x0800, true); // flags: UTF-8 encoding flag (bit 11)
    view.setUint16(8, 0, true); // compression (none)
    view.setUint16(10, 0, true); // mod time
    view.setUint16(12, 0, true); // mod date
    view.setUint32(14, crc32(file.content), true); // crc
    view.setUint32(18, file.content.length, true); // compressed size
    view.setUint32(22, file.content.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true); // name length
    view.setUint16(28, 0, true); // extra length
    header.set(nameBytes, 30);

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdEntry.buffer);
    cdView.setUint32(0, 0x02014b50, true); // central directory signature
    cdView.setUint16(4, 20, true); // version made by (2.0)
    cdView.setUint16(6, 20, true); // version needed to extract (2.0)
    cdView.setUint16(8, 0x0800, true); // general purpose bit flag: UTF-8 encoding flag (bit 11)
    cdView.setUint16(10, 0, true); // compression method (none)
    cdView.setUint16(12, 0, true); // mod time
    cdView.setUint16(14, 0, true); // mod date
    cdView.setUint32(16, crc32(file.content), true);
    cdView.setUint32(20, file.content.length, true);
    cdView.setUint32(24, file.content.length, true);
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint16(30, 0, true);
    cdView.setUint16(32, 0, true);
    cdView.setUint16(34, 0, true);
    cdView.setUint16(36, 0, true);
    cdView.setUint32(38, 0x20, true);
    cdView.setUint32(42, offset, true);
    cdEntry.set(nameBytes, 46);

    zipParts.push(header, file.content);
    centralDir.push(cdEntry);
    offset += header.length + file.content.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  centralDir.forEach((cd) => { cdSize += cd.length; });

  // End of central directory
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  eocdView.setUint16(20, 0, true);

  const blob = new Blob([...zipParts, ...centralDir, eocd], { type: 'application/zip' });
  downloadBlob(blob, `batch_transcripts_${files.length}_videos.zip`);
}

// CRC32 table
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---- AI Token Warning for Batch ----
const AI_TOKEN_MODAL = $('#ai-token-modal');
let pendingAiService = null;
let pendingAiText = null;

function checkAndSendToAI(service, text) {
  const estTokens = window.AiWorkspaceEngine ? window.AiWorkspaceEngine.estimateTokens(text) : Math.ceil(text.length / 4.0);
  if (text.length > BATCH_TOKEN_WARN_LIMIT || estTokens > 25000) {
    pendingAiService = service;
    pendingAiText = text;
    const charCount = text.length.toLocaleString();
    const tokenCount = estTokens.toLocaleString();
    const msg = `The transcript is ~${tokenCount} tokens (${charCount} characters). This large context may exceed the AI model's limit or freeze the chat tab. Would you like to proceed or select specific key moments?`;
    const msgEl = $('#ai-token-msg');
    if (msgEl) msgEl.textContent = msg;
    if (AI_TOKEN_MODAL) AI_TOKEN_MODAL.classList.remove('hidden');
  } else {
    executeSendToAI(service, text);
  }
}

$('#ai-token-cancel')?.addEventListener('click', () => {
  if (AI_TOKEN_MODAL) AI_TOKEN_MODAL.classList.add('hidden');
  pendingAiService = null;
  pendingAiText = null;
});

$('#ai-token-send')?.addEventListener('click', () => {
  if (AI_TOKEN_MODAL) AI_TOKEN_MODAL.classList.add('hidden');
  if (pendingAiService && pendingAiText) {
    executeSendToAI(pendingAiService, pendingAiText);
  }
  pendingAiService = null;
  pendingAiText = null;
});

async function executeSendToAI(service, text) {
  await copyToClipboard(text);
  await chrome.storage.local.set({
    pending_ai_prompt: { text, timestamp: Date.now(), service },
  });
  const aiUrls = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app' };
  await chrome.tabs.create({ url: aiUrls[service] || aiUrls.chatgpt, active: true });
  showBatchSuccess(`Copied & opening ${service}!`);
}


// ---- Batch status helpers ----
function showBatchError(msg) {
  const countEl = $('#batch-video-count');
  if (countEl) {
    countEl.textContent = msg;
    countEl.style.color = '#ef4444';
  }
  const list = $('#batch-video-list');
  if (list && (!batchVideos || !batchVideos.length)) {
    list.innerHTML = `<p class="batch-placeholder" style="color: #ef4444;">${escapeHtml(msg)}</p>`;
  }
}

function showBatchSuccess(msg) {
  const countEl = $('#batch-video-count');
  if (countEl) {
    countEl.textContent = msg;
    countEl.style.color = 'var(--accent, #10b981)';
  }
}

