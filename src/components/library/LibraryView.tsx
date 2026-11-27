import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  FileMusic,
  FilePlus,
  Folder,
  FolderPlus,
  ListMusic,
  Music,
  Play,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  LibraryFolder,
  ScoreMetadataPatch,
  ScoreRecord,
  Setlist,
} from '../../types';
import { formatMessage, formatPitchLabel, useI18n } from '../../i18n';
import { SetlistView } from './SetlistView';
import './library.css';

export type LibraryFilterMode = 'all' | 'favorites' | 'recent';
export type LibraryTabMode = 'scores' | 'setlists';

export interface LibraryViewProps {
  scores: ScoreRecord[];
  folders: LibraryFolder[];
  setlists: Setlist[];
  settings: AppSettings;
  isScanning?: boolean;
  statusMessage?: string | null;
  onDismissStatus?: () => void;
  onOpenScore: (score: ScoreRecord) => void;
  onOpenSetlist: (setlist: Setlist, startIndex?: number) => void;
  onAddFolder: () => void | Promise<void>;
  onRemoveFolder: (folderId: string) => void | Promise<void>;
  onScanLibrary: (folderId?: string) => void | Promise<void>;
  onOpenPdfFiles: () => void | Promise<void>;
  onUpdateScore: (scoreId: string, patch: ScoreMetadataPatch) => void | Promise<void>;
  onDeleteScore: (scoreId: string) => void | Promise<void>;
  onSetlistsChange: (nextSetlists: Setlist[]) => void;
  onOpenSettings: () => void;
}

export function LibraryView({
  scores,
  folders,
  setlists,
  settings,
  isScanning = false,
  statusMessage,
  onDismissStatus,
  onOpenScore,
  onOpenSetlist,
  onAddFolder,
  onRemoveFolder,
  onScanLibrary,
  onOpenPdfFiles,
  onUpdateScore,
  onDeleteScore,
  onSetlistsChange,
  onOpenSettings,
}: LibraryViewProps) {
  const { language, t } = useI18n();
  const [activeTab, setActiveTab] = useState<LibraryTabMode>('scores');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<LibraryFilterMode>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);

  // Tag & title editor modal state
  const [editingScore, setEditingScore] = useState<ScoreRecord | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [newTagDraft, setNewTagDraft] = useState('');
  const [confirmDeleteScore, setConfirmDeleteScore] = useState(false);

  useEffect(() => {
    if (!foldersOpen && !editingScore) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (editingScore) {
          setEditingScore(null);
        } else if (foldersOpen) {
          setFoldersOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [foldersOpen, editingScore]);

  const suggestedChoirTags = useMemo(
    () => [
      t.library.suggestedTags.bass,
      t.library.suggestedTags.tenor,
      t.library.suggestedTags.alto,
      t.library.suggestedTags.soprano,
      t.library.suggestedTags.choir,
      t.library.suggestedTags.christmas,
      t.library.suggestedTags.sacred,
      'A cappella',
    ],
    [t.library.suggestedTags],
  );

  const resumeScore = useMemo(() => {
    const opened = scores.filter((s) => s.lastOpenedAt !== null);
    if (opened.length === 0) return null;
    return opened.sort((a, b) => {
      const ta = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
      const tb = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
      return tb - ta;
    })[0];
  }, [scores]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scores) {
      for (const tag of s.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], language))
      .map(([tag]) => tag);
  }, [scores, language]);

  const filteredScores = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = scores.filter((score) => {
      if (filterMode === 'favorites' && !score.favorite) return false;
      if (filterMode === 'recent' && !score.lastOpenedAt) return false;
      if (activeTag && !score.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        score.title.toLowerCase().includes(q) ||
        score.filename.toLowerCase().includes(q) ||
        score.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });

    if (filterMode === 'recent') {
      list = [...list].sort((a, b) => {
        const ta = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
        const tb = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
        return tb - ta;
      });
    } else {
      list = [...list].sort((a, b) =>
        a.title.localeCompare(b.title, language, { sensitivity: 'base' }),
      );
    }
    return list;
  }, [scores, searchQuery, filterMode, activeTag, language]);

  function openTagEditor(score: ScoreRecord) {
    setEditingScore(score);
    setTitleDraft(score.title);
    setTagsDraft([...score.tags]);
    setNewTagDraft('');
    setConfirmDeleteScore(false);
  }

  function handleAddTag(tagText: string) {
    const clean = tagText.trim();
    if (!clean) return;
    if (!tagsDraft.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      setTagsDraft([...tagsDraft, clean]);
    }
    setNewTagDraft('');
  }

  async function handleSaveScoreEditor(e: FormEvent) {
    e.preventDefault();
    if (!editingScore) return;
    const cleanTitle = titleDraft.trim() || editingScore.title;
    try {
      await onUpdateScore(editingScore.id, {
        title: cleanTitle,
        tags: tagsDraft,
      });
      setEditingScore(null);
    } catch {
      // Error feedback is handled by parent handler
    }
  }

  async function handleConfirmDeleteScore() {
    if (!editingScore) return;
    try {
      await onDeleteScore(editingScore.id);
      setEditingScore(null);
    } catch {
      // Error feedback is handled by parent handler
    }
  }

  const resumePitchLabel = resumeScore?.savedPitch
    ? formatPitchLabel(
        resumeScore.savedPitch.midiNotes,
        language,
        settings.noteNaming,
      )
    : '';

  return (
    <div className="library-shell">
      <header className="library-header">
        <div className="library-brand-row">
          <h1 className="library-brand-title">
            <Music size={22} />
            <span>{t.appName}</span>
          </h1>
          <div className="library-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'scores'}
              className={`library-tab-btn ${activeTab === 'scores' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('scores')}
            >
              {t.library.title} ({scores.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'setlists'}
              className={`library-tab-btn ${activeTab === 'setlists' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('setlists')}
            >
              <ListMusic size={17} />
              <span>
                {t.library.setlistsTab} ({setlists.length})
              </span>
            </button>
          </div>
        </div>

        <div className="library-actions">
          <button
            type="button"
            className="lib-btn"
            onClick={() => void onAddFolder()}
          >
            <FolderPlus size={18} />
            <span>{t.library.addFolder}</span>
          </button>
          <button
            type="button"
            className="lib-btn"
            onClick={() => setFoldersOpen(true)}
          >
            <Folder size={18} />
            <span>
              {t.library.folders} ({folders.length})
            </span>
          </button>
          <button
            type="button"
            className="lib-btn lib-btn-primary"
            onClick={() => void onOpenPdfFiles()}
          >
            <FilePlus size={18} />
            <span>{t.library.openPdf}</span>
          </button>
          <button
            type="button"
            className="lib-btn"
            disabled={isScanning}
            onClick={() => void onScanLibrary()}
            aria-label={t.library.refresh}
          >
            <RefreshCw size={18} className={isScanning ? 'spin-icon' : ''} />
            <span>{isScanning ? t.library.scanning : t.library.refresh}</span>
          </button>
          <button
            type="button"
            className="lib-btn lib-btn-icon"
            onClick={onOpenSettings}
            aria-label={t.library.settings}
            title={t.library.settings}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className="library-status-banner" role="status">
          <span>{statusMessage}</span>
          {onDismissStatus && (
            <button
              type="button"
              className="lib-btn lib-btn-icon"
              onClick={onDismissStatus}
              aria-label={t.common.close}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <div className="library-scroll scroll-area">
        {activeTab === 'setlists' ? (
          <SetlistView
            setlists={setlists}
            scores={scores}
            settings={settings}
            onSetlistsChange={onSetlistsChange}
            onOpenSetlist={onOpenSetlist}
          />
        ) : (
          <>
            {resumeScore && (
              <button
                type="button"
                className="resume-hero"
                onClick={() => onOpenScore(resumeScore)}
              >
                <div className="resume-hero-top">
                  <span className="resume-eyebrow">{t.library.resumeReading}</span>
                  <span className="score-badge score-badge-accent">
                    <Play size={13} />
                    <span>{t.library.resumeReading}</span>
                  </span>
                </div>
                <div className="resume-hero-main">
                  <div className="resume-hero-info">
                    <h2 className="resume-hero-title">{resumeScore.title}</h2>
                    <div className="resume-hero-meta">
                      {formatMessage(t.library.lastOpenedPage, {
                        page: Math.max(1, resumeScore.lastPage),
                        total: Math.max(1, resumeScore.pageCount || 1),
                      })}
                    </div>
                  </div>
                  <div className="score-badges">
                    {resumeScore.savedBpm && (
                      <span className="score-badge">
                        {resumeScore.savedBpm} {t.common.bpmSuffix}
                        {resumeScore.savedTimeSignature
                          ? ` · ${resumeScore.savedTimeSignature}`
                          : ''}
                      </span>
                    )}
                    {resumePitchLabel && (
                      <span className="score-badge score-badge-accent">
                        <Music size={12} />
                        <span>{resumePitchLabel}</span>
                      </span>
                    )}
                    {resumeScore.tags.map((tag) => (
                      <span key={tag} className="score-badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="resume-progress-track">
                  <div
                    className="resume-progress-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          4,
                          (Math.max(1, resumeScore.lastPage) /
                            Math.max(1, resumeScore.pageCount || 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </button>
            )}

            <div className="library-controls">
              <div className="search-box-wrap">
                <Search size={18} className="search-box-icon" />
                <input
                  type="search"
                  className="search-box-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.library.searchPlaceholder}
                  aria-label={t.library.searchPlaceholder}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setSearchQuery('')}
                    aria-label={t.library.clearSearch}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              <div className="filter-chips-row">
                <button
                  type="button"
                  className={`filter-chip ${filterMode === 'all' && !activeTag ? 'is-active' : ''}`}
                  onClick={() => {
                    setFilterMode('all');
                    setActiveTag(null);
                  }}
                >
                  {t.library.filterAll}
                </button>
                <button
                  type="button"
                  className={`filter-chip ${filterMode === 'favorites' ? 'is-active' : ''}`}
                  onClick={() =>
                    setFilterMode((prev) =>
                      prev === 'favorites' ? 'all' : 'favorites',
                    )
                  }
                >
                  <Star size={14} />
                  <span>{t.library.filterFavorites}</span>
                </button>
                <button
                  type="button"
                  className={`filter-chip ${filterMode === 'recent' ? 'is-active' : ''}`}
                  onClick={() =>
                    setFilterMode((prev) => (prev === 'recent' ? 'all' : 'recent'))
                  }
                >
                  {t.library.filterRecent}
                </button>

                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`filter-chip ${activeTag === tag ? 'is-active' : ''}`}
                    onClick={() =>
                      setActiveTag((prev) => (prev === tag ? null : tag))
                    }
                  >
                    <Tag size={13} />
                    <span>{tag}</span>
                  </button>
                ))}
              </div>
            </div>

            {scores.length === 0 ? (
              <div className="library-empty">
                <FileMusic size={36} color="var(--accent)" />
                <h3>{t.library.emptyTitle}</h3>
                <p>{t.library.emptyDescription}</p>
                <div className="library-empty-actions">
                  <button
                    type="button"
                    className="lib-btn"
                    onClick={() => void onAddFolder()}
                  >
                    <FolderPlus size={18} />
                    <span>{t.library.addFolder}</span>
                  </button>
                  <button
                    type="button"
                    className="lib-btn lib-btn-primary"
                    onClick={() => void onOpenPdfFiles()}
                  >
                    <FilePlus size={18} />
                    <span>{t.library.openPdf}</span>
                  </button>
                </div>
              </div>
            ) : filteredScores.length === 0 ? (
              <div className="library-empty">
                <p>{t.library.noMatches}</p>
              </div>
            ) : (
              <div className="score-list">
                {filteredScores.map((score) => {
                  const pitchLabel = score.savedPitch
                    ? formatPitchLabel(
                        score.savedPitch.midiNotes,
                        language,
                        settings.noteNaming,
                      )
                    : '';
                  return (
                    <article key={score.id} className="score-card">
                      <button
                        type="button"
                        className="score-card-open"
                        onClick={() => onOpenScore(score)}
                      >
                        <div className="score-card-icon">
                          <FileMusic size={22} />
                        </div>
                        <div className="score-card-body">
                          <div className="score-card-title">{score.title}</div>
                          <div className="score-card-sub">
                            <span>
                              {formatMessage(t.common.pageShort, {
                                page: Math.max(1, score.lastPage),
                                total: Math.max(1, score.pageCount || 1),
                              })}
                            </span>
                            {score.savedBpm && (
                              <span>
                                · {score.savedBpm} {t.common.bpmSuffix}
                              </span>
                            )}
                          </div>
                          {(pitchLabel || score.tags.length > 0) && (
                            <div className="score-badges">
                              {pitchLabel && (
                                <span className="score-badge score-badge-accent">
                                  {pitchLabel}
                                </span>
                              )}
                              {score.tags.map((tag) => (
                                <span key={tag} className="score-badge">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>

                      <div className="score-card-actions">
                        <button
                          type="button"
                          className="lib-btn lib-btn-icon"
                          aria-label={
                            score.favorite
                              ? t.library.favoriteRemove
                              : t.library.favoriteAdd
                          }
                          title={
                            score.favorite
                              ? t.library.favoriteRemove
                              : t.library.favoriteAdd
                          }
                          onClick={() =>
                            void onUpdateScore(score.id, {
                              favorite: !score.favorite,
                            })
                          }
                        >
                          <Star
                            size={18}
                            className={score.favorite ? 'star-active' : undefined}
                            fill={score.favorite ? 'currentColor' : 'none'}
                          />
                        </button>
                        <button
                          type="button"
                          className="lib-btn lib-btn-icon"
                          aria-label={t.library.editTags}
                          title={t.library.editTags}
                          onClick={() => openTagEditor(score)}
                        >
                          <Tag size={18} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {foldersOpen && (
        <div
          className="lib-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t.library.manageFolders}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFoldersOpen(false);
          }}
        >
          <div className="lib-modal-card">
            <div className="lib-modal-head">
              <h2>{t.library.manageFolders}</h2>
              <button
                type="button"
                className="lib-btn lib-btn-icon"
                aria-label={t.common.close}
                onClick={() => setFoldersOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="lib-modal-body scroll-area">
              {folders.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  {t.library.noFolders}
                </p>
              ) : (
                folders.map((folder) => (
                  <div key={folder.id} className="folder-row">
                    <span className="folder-path">{folder.path}</span>
                    <button
                      type="button"
                      className="lib-btn lib-btn-icon"
                      aria-label={t.library.refresh}
                      title={t.library.refresh}
                      onClick={() => void onScanLibrary(folder.id)}
                    >
                      <RefreshCw size={18} />
                    </button>
                    <button
                      type="button"
                      className="lib-btn lib-btn-icon"
                      aria-label={t.library.removeFolder}
                      title={t.library.removeFolder}
                      onClick={() => void onRemoveFolder(folder.id)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="lib-modal-foot">
              <button
                type="button"
                className="lib-btn"
                onClick={() => void onAddFolder()}
              >
                <FolderPlus size={18} />
                <span>{t.library.addFolder}</span>
              </button>
              <button
                type="button"
                className="lib-btn lib-btn-primary"
                onClick={() => setFoldersOpen(false)}
              >
                {t.common.done}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingScore && (
        <div
          className="lib-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t.library.editTags}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingScore(null);
          }}
        >
          <form className="lib-modal-card" onSubmit={handleSaveScoreEditor}>
            <div className="lib-modal-head">
              <h2>{t.library.editTags}</h2>
              <button
                type="button"
                className="lib-btn lib-btn-icon"
                aria-label={t.common.close}
                onClick={() => setEditingScore(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="lib-modal-body scroll-area">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  {t.library.scoreTitleLabel}
                </span>
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  {t.library.tagsLabel}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {tagsDraft.map((tag) => (
                    <span key={tag} className="tag-chip-editable">
                      <span>{tag}</span>
                      <button
                        type="button"
                        className="tag-chip-remove"
                        aria-label={`${t.common.delete} ${tag}`}
                        onClick={() =>
                          setTagsDraft(tagsDraft.filter((item) => item !== tag))
                        }
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="tag-add-row">
                  <input
                    type="text"
                    value={newTagDraft}
                    onChange={(e) => setNewTagDraft(e.target.value)}
                    placeholder={t.library.tagPlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag(newTagDraft);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="lib-btn"
                    onClick={() => handleAddTag(newTagDraft)}
                  >
                    {t.library.addTag}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {t.library.suggestedTagsLabel}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {suggestedChoirTags.map((preset) => {
                      const already = tagsDraft.some(
                        (item) => item.toLowerCase() === preset.toLowerCase(),
                      );
                      return (
                        <button
                          key={preset}
                          type="button"
                          className={`filter-chip ${already ? 'is-active' : ''}`}
                          onClick={() => {
                            if (already) {
                              setTagsDraft(
                                tagsDraft.filter(
                                  (item) =>
                                    item.toLowerCase() !== preset.toLowerCase(),
                                ),
                              );
                            } else {
                              handleAddTag(preset);
                            }
                          }}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {t.library.deleteConfirmHint}
                </span>
                {confirmDeleteScore ? (
                  <button
                    type="button"
                    className="lib-btn lib-btn-danger"
                    onClick={() => void handleConfirmDeleteScore()}
                  >
                    <Trash2 size={18} />
                    <span>{t.common.confirmDelete}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="lib-btn"
                    onClick={() => setConfirmDeleteScore(true)}
                  >
                    <Trash2 size={18} />
                    <span>{t.library.removeScoreRecord}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="lib-modal-foot">
              <button
                type="button"
                className="lib-btn"
                onClick={() => setEditingScore(null)}
              >
                {t.common.cancel}
              </button>
              <button type="submit" className="lib-btn lib-btn-primary">
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
