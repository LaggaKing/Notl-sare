export interface TranslationDict {
  appName: string;
  common: {
    back: string;
    close: string;
    cancel: string;
    save: string;
    delete: string;
    confirmDelete: string;
    rename: string;
    add: string;
    edit: string;
    done: string;
    reset: string;
    apply: string;
    loading: string;
    error: string;
    pageOf: string;
    pageShort: string;
    pagesCount: string;
    piecesCount: string;
    bpmSuffix: string;
  };
  library: {
    title: string;
    setlistsTab: string;
    resumeReading: string;
    lastOpenedPage: string;
    folders: string;
    manageFolders: string;
    addFolder: string;
    removeFolder: string;
    noFolders: string;
    openPdf: string;
    refresh: string;
    scanning: string;
    scanSummary: string;
    settings: string;
    searchPlaceholder: string;
    clearSearch: string;
    filterAll: string;
    filterFavorites: string;
    filterRecent: string;
    emptyTitle: string;
    emptyDescription: string;
    noMatches: string;
    favoriteAdd: string;
    favoriteRemove: string;
    editTags: string;
    scoreTitleLabel: string;
    tagsLabel: string;
    tagPlaceholder: string;
    addTag: string;
    suggestedTagsLabel: string;
    suggestedTags: {
      bass: string;
      alto: string;
      soprano: string;
      tenor: string;
      choir: string;
      christmas: string;
      sacred: string;
    };
    removeScoreRecord: string;
    deleteConfirmHint: string;
  };
  setlists: {
    title: string;
    newSetlist: string;
    setlistNamePlaceholder: string;
    create: string;
    renameTitle: string;
    emptyList: string;
    emptyListDescription: string;
    emptyItems: string;
    addScore: string;
    chooseScore: string;
    allScoresAdded: string;
    moveUp: string;
    moveDown: string;
    removeItem: string;
    openInReader: string;
    nextPiece: string;
    previousPiece: string;
    pieceProgress: string;
  };
  reader: {
    backToLibrary: string;
    halfPageTurn: string;
    halfPageTopNext: string;
    halfPageBottomCurrent: string;
    cropMargins: string;
    cropAuto: string;
    cropManual: string;
    cropNone: string;
    cropAdjust: string;
    cropInstructions: string;
    cropReset: string;
    bookmarks: string;
    addBookmark: string;
    bookmarkPlaceholder: string;
    noBookmarks: string;
    annotate: string;
    showAnnotations: string;
    hideAnnotations: string;
    metronome: string;
    piano: string;
    playStartPitch: string;
    settings: string;
    resetZoom: string;
    zoomPercent: string;
    loadingScore: string;
    loadError: string;
    previousPage: string;
    nextPage: string;
    toggleHudHint: string;
    pageScrubber: string;
    noFileError: string;
    exportFilenameSuffix: string;
  };
  crop: {
    handleNw: string;
    handleNe: string;
    handleSw: string;
    handleSe: string;
  };
  annotations: {
    defaultLayerName: string;
  };
  settings: {
    title: string;
    language: string;
    swedish: string;
    english: string;
    noteNaming: string;
    noteNamingAuto: string;
    noteNamingSv: string;
    noteNamingEn: string;
    referencePitch: string;
    referencePitchDecrease: string;
    referencePitchIncrease: string;
    hzUnit: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    paperTint: string;
    paperNormal: string;
    paperWarm: string;
    paperNight: string;
    navigationSection: string;
    swipeToTurn: string;
    tapZones: string;
    halfPageDefault: string;
    autoCropDefault: string;
    wakeLock: string;
    wakeLockHint: string;
    backupSection: string;
    backupExport: string;
    backupRestore: string;
    backupExportSuccess: string;
    backupRestoreSuccess: string;
    backupError: string;
  };
  errors: {
    saveAnnotationsFailed: string;
    saveMetadataFailed: string;
    exportPdfFailed: string;
    exportPdfEncrypted: string;
    exportPdfSuccess: string;
    importPdfFailed: string;
    folderActionFailed: string;
    deleteScoreFailed: string;
    bookmarkActionFailed: string;
    setlistActionFailed: string;
    emptyPdf: string;
    renderFailed: string;
    unexpectedCrashTitle: string;
    unexpectedCrashBody: string;
    reloadApp: string;
    backToLibrary: string;
  };
}

export const sv: TranslationDict = {
  appName: 'Notl-sare',
  common: {
    back: 'Tillbaka',
    close: 'Stäng',
    cancel: 'Avbryt',
    save: 'Spara',
    delete: 'Ta bort',
    confirmDelete: 'Bekräfta borttagning',
    rename: 'Byt namn',
    add: 'Lägg till',
    edit: 'Redigera',
    done: 'Klar',
    reset: 'Återställ',
    apply: 'Använd',
    loading: 'Laddar...',
    error: 'Ett fel uppstod',
    pageOf: 'Sida {page} av {total}',
    pageShort: 's. {page}/{total}',
    pagesCount: '{count} sidor',
    piecesCount: '{count} stycken',
    bpmSuffix: 'BPM',
  },
  library: {
    title: 'Bibliotek',
    setlistsTab: 'Spellistor',
    resumeReading: 'Fortsätt läsa',
    lastOpenedPage: 'Senast på sida {page} av {total}',
    folders: 'Mappar',
    manageFolders: 'Hantera notmappar',
    addFolder: 'Lägg till mapp',
    removeFolder: 'Ta bort mapp',
    noFolders: 'Inga länkade mappar ännu. Lägg till en mapp med PDF-noter eller öppna en enskild fil.',
    openPdf: 'Öppna PDF',
    refresh: 'Uppdatera',
    scanning: 'Skannar...',
    scanSummary: '{added} nya, {updated} uppdaterade, {missing} saknas',
    settings: 'Inställningar',
    searchPlaceholder: 'Sök noter eller stämma...',
    clearSearch: 'Rensa sökning',
    filterAll: 'Alla noter',
    filterFavorites: 'Favoriter',
    filterRecent: 'Senaste',
    emptyTitle: 'Inga noter i biblioteket ännu',
    emptyDescription: 'Lägg till en notmapp eller öppna en PDF-fil för att komma igång.',
    noMatches: 'Inga noter matchar filtret.',
    favoriteAdd: 'Markera som favorit',
    favoriteRemove: 'Ta bort favoritmarkering',
    editTags: 'Redigera titel & etiketter',
    scoreTitleLabel: 'Titel',
    tagsLabel: 'Etiketter / stämmor',
    tagPlaceholder: 'Ny etikett (t.ex. Bas, Jul)...',
    addTag: 'Lägg till',
    suggestedTagsLabel: 'Förslag',
    suggestedTags: {
      bass: 'Bas',
      alto: 'Alt',
      soprano: 'Sopran',
      tenor: 'Tenor',
      choir: 'Kör',
      christmas: 'Jul',
      sacred: 'Sakral',
    },
    removeScoreRecord: 'Ta bort från biblioteket',
    deleteConfirmHint: 'Tar endast bort posten och anteckningar i appen; PDF-filen på datorn sparas.',
  },
  setlists: {
    title: 'Spellistor',
    newSetlist: 'Ny spellista',
    setlistNamePlaceholder: 'Namn på spellista (t.ex. Julkonsert)...',
    create: 'Skapa',
    renameTitle: 'Byt namn på spellista',
    emptyList: 'Inga spellistor ännu',
    emptyListDescription: 'Skapa en spellista för konsert eller repetition och bläddra smidigt mellan stycken.',
    emptyItems: 'Spellistan är tom. Lägg till noter nedan.',
    addScore: 'Lägg till not',
    chooseScore: 'Välj not att lägga till',
    allScoresAdded: 'Alla noter i biblioteket finns redan i spellistan.',
    moveUp: 'Flytta upp',
    moveDown: 'Flytta ner',
    removeItem: 'Ta bort från spellista',
    openInReader: 'Öppna spellista',
    nextPiece: 'Nästa stycke',
    previousPiece: 'Föregående stycke',
    pieceProgress: 'Stycke {index} av {total}',
  },
  reader: {
    backToLibrary: 'Bibliotek',
    halfPageTurn: 'Halvsidesskift',
    halfPageTopNext: 'Nästa sida (s. {page}) ↑',
    halfPageBottomCurrent: 'Aktuell sida (s. {page}) ↓',
    cropMargins: 'Beskär marginaler',
    cropAuto: 'Automatisk beskärning',
    cropManual: 'Manuell beskärning',
    cropNone: 'Hela sidan',
    cropAdjust: 'Justera beskärning',
    cropInstructions: 'Dra handtagen i kanterna och hörnen för att beskära vita marginaler.',
    cropReset: 'Återställ ram',
    bookmarks: 'Bokmärken',
    addBookmark: 'Lägg till bokmärke',
    bookmarkPlaceholder: 'Namn (t.ex. Repris, Vers 3)...',
    noBookmarks: 'Inga bokmärken på detta stycke ännu.',
    annotate: 'Anteckna',
    showAnnotations: 'Visa anteckningar',
    hideAnnotations: 'Dölj anteckningar',
    metronome: 'Metronom',
    piano: 'Startton / Piano',
    playStartPitch: 'Spela startton',
    settings: 'Inställningar',
    resetZoom: 'Återställ zoom',
    zoomPercent: '{percent}%',
    loadingScore: 'Laddar notblad...',
    loadError: 'Kunde inte öppna PDF-filen.',
    previousPage: 'Föregående sida',
    nextPage: 'Nästa sida',
    toggleHudHint: 'Tryck i mitten för verktyg',
    pageScrubber: 'Sidväljare',
    noFileError: 'Filen kunde inte läsas från disk.',
    exportFilenameSuffix: '-noter',
  },
  crop: {
    handleNw: 'Justera övre vänstra hörnet',
    handleNe: 'Justera övre högra hörnet',
    handleSw: 'Justera nedre vänstra hörnet',
    handleSe: 'Justera nedre högra hörnet',
  },
  annotations: {
    defaultLayerName: 'Anteckningar',
  },
  settings: {
    title: 'Inställningar',
    language: 'Språk',
    swedish: 'Svenska',
    english: 'Engelska',
    noteNaming: 'Tonnamn',
    noteNamingAuto: 'Automatisk (följer språk)',
    noteNamingSv: 'Svenska (H / B)',
    noteNamingEn: 'Engelska (B / B♭)',
    referencePitch: 'Referenston (A4)',
    referencePitchDecrease: 'Sänk referenston',
    referencePitchIncrease: 'Höj referenston',
    hzUnit: '{hz} Hz',
    theme: 'Tema',
    themeDark: 'Mörkt (scen)',
    themeLight: 'Ljust',
    paperTint: 'Papperston',
    paperNormal: 'Normal',
    paperWarm: 'Varmt papper',
    paperNight: 'Nattläge',
    navigationSection: 'Bläddring & visning',
    swipeToTurn: 'Svep för att bläddra',
    tapZones: 'Tryckzoner (vänster / mitten / höger)',
    halfPageDefault: 'Halvsidesskift som standard',
    autoCropDefault: 'Automatisk beskärning som standard',
    wakeLock: 'Skärmlås (håll vaken)',
    wakeLockHint: 'Hindrar skärmen från att slockna när du läser noter.',
    backupSection: 'Säkerhetskopia',
    backupExport: 'Säkerhetskopiera anteckningar',
    backupRestore: 'Återställ anteckningar',
    backupExportSuccess: 'Säkerhetskopia sparad.',
    backupRestoreSuccess: 'Återställde {scores} stycken och {annotations} anteckningssidor.',
    backupError: 'Kunde inte slutföra säkerhetskopieringen.',
  },
  errors: {
    saveAnnotationsFailed: 'Kunde inte spara anteckningar.',
    saveMetadataFailed: 'Kunde inte spara ändringar.',
    exportPdfFailed: 'Kunde inte exportera PDF-filen.',
    exportPdfEncrypted: 'Denna PDF är krypterad och kan inte exporteras med inbäddade anteckningar.',
    exportPdfSuccess: 'PDF med anteckningar exporterad.',
    importPdfFailed: 'Kunde inte öppna vald PDF-fil.',
    folderActionFailed: 'Kunde inte uppdatera notmappar.',
    deleteScoreFailed: 'Kunde inte ta bort noten från biblioteket.',
    bookmarkActionFailed: 'Kunde inte uppdatera bokmärken.',
    setlistActionFailed: 'Kunde inte uppdatera spellistan.',
    emptyPdf: 'PDF-filen innehåller inga sidor.',
    renderFailed: 'Kunde inte rita ut sidan.',
    unexpectedCrashTitle: 'Något gick fel',
    unexpectedCrashBody: 'Ett oväntat fel inträffade i gränssnittet. Dina sparade noter och anteckningar är intakta.',
    reloadApp: 'Ladda om appen',
    backToLibrary: 'Tillbaka till biblioteket',
  },
};
