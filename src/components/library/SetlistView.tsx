import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { AppSettings, ScoreRecord, Setlist, SetlistItem } from '../../types';
import { formatMessage, formatPitchLabel, useI18n } from '../../i18n';
import {
  createSetlist,
  deleteSetlist,
  renameSetlist,
  setSetlistItems,
} from '../../services/tauriApi';

export interface SetlistViewProps {
  setlists: Setlist[];
  scores: ScoreRecord[];
  settings: AppSettings;
  onSetlistsChange: (nextSetlists: Setlist[]) => void;
  onOpenSetlist: (setlist: Setlist, startIndex?: number) => void;
}

export function SetlistView({
  setlists,
  scores,
  settings,
  onSetlistsChange,
  onOpenSetlist,
}: SetlistViewProps) {
  const { language, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(
    setlists[0]?.id ?? null,
  );
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPickerOpen(false);
        setPickerQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [pickerOpen]);

  useEffect(() => {
    if (setlists.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !setlists.some((s) => s.id === selectedId)) {
      setSelectedId(setlists[0].id);
    }
  }, [setlists, selectedId]);

  const scoreById = useMemo(() => {
    const map = new Map<string, ScoreRecord>();
    for (const s of scores) {
      map.set(s.id, s);
    }
    return map;
  }, [scores]);

  const selectedSetlist = useMemo(
    () => setlists.find((s) => s.id === selectedId) ?? null,
    [setlists, selectedId],
  );

  const sortedItems = useMemo(() => {
    if (!selectedSetlist) return [];
    return [...selectedSetlist.items].sort((a, b) => a.position - b.position);
  }, [selectedSetlist]);

  const resolvedIndexByPos = useMemo(() => {
    let resolvedCount = 0;
    return sortedItems.map((item) => {
      if (!scoreById.has(item.scoreId)) {
        return null;
      }
      const idx = resolvedCount;
      resolvedCount += 1;
      return idx;
    });
  }, [sortedItems, scoreById]);

  const hasAvailableScoresToOpen = resolvedIndexByPos.some((idx) => idx !== null);

  const availableScoresToAdd = useMemo(() => {
    const existingIds = new Set(sortedItems.map((i) => i.scoreId));
    const q = pickerQuery.trim().toLowerCase();
    return scores.filter((score) => {
      if (existingIds.has(score.id)) return false;
      if (!q) return true;
      return (
        score.title.toLowerCase().includes(q) ||
        score.filename.toLowerCase().includes(q) ||
        score.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [scores, sortedItems, pickerQuery]);

  async function handleCreateSetlist(e: FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const created = await createSetlist(trimmed);
      onSetlistsChange([...setlists, created]);
      setSelectedId(created.id);
      setNewName('');
    } catch {
      setErrorMessage(t.errors.setlistActionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedSetlist || busy) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const updated = await renameSetlist(selectedSetlist.id, trimmed);
      onSetlistsChange(
        setlists.map((s) => (s.id === updated.id ? updated : s)),
      );
      setIsRenaming(false);
    } catch {
      setErrorMessage(t.errors.setlistActionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSetlist(id: string) {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      await deleteSetlist(id);
      const next = setlists.filter((s) => s.id !== id);
      onSetlistsChange(next);
      setConfirmDeleteId(null);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
    } catch {
      setErrorMessage(t.errors.setlistActionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function persistItems(nextItems: SetlistItem[]) {
    if (!selectedSetlist || busy) return;
    const normalized = nextItems.map((item, idx) => ({
      scoreId: item.scoreId,
      position: idx,
    }));
    setBusy(true);
    setErrorMessage(null);
    try {
      const updated = await setSetlistItems(selectedSetlist.id, normalized);
      onSetlistsChange(
        setlists.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch {
      setErrorMessage(t.errors.setlistActionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sortedItems.length) return;
    const copy = [...sortedItems];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    await persistItems(copy);
  }

  async function handleRemoveItem(index: number) {
    const copy = sortedItems.filter((_, i) => i !== index);
    await persistItems(copy);
  }

  async function handleAddScore(scoreId: string) {
    const next = [
      ...sortedItems,
      { scoreId, position: sortedItems.length },
    ];
    await persistItems(next);
  }

  return (
    <>
      {errorMessage && (
        <div className="library-status-banner" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="lib-btn lib-btn-icon"
            onClick={() => setErrorMessage(null)}
            aria-label={t.common.close}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="setlists-layout">
      <section className="setlist-sidebar" aria-label={t.setlists.title}>
        <form className="setlist-create-form" onSubmit={handleCreateSetlist}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.setlists.setlistNamePlaceholder}
            aria-label={t.setlists.newSetlist}
          />
          <button
            type="submit"
            className="lib-btn lib-btn-primary"
            disabled={busy || !newName.trim()}
          >
            <Plus size={18} />
            <span>{t.setlists.create}</span>
          </button>
        </form>

        {setlists.length === 0 ? (
          <div className="library-empty" style={{ margin: '8px 0', padding: '18px' }}>
            <ListMusic size={28} color="var(--accent)" />
            <h3>{t.setlists.emptyList}</h3>
            <p>{t.setlists.emptyListDescription}</p>
          </div>
        ) : (
          setlists.map((setlist) => (
            <button
              key={setlist.id}
              type="button"
              className={`setlist-nav-item ${setlist.id === selectedSetlist?.id ? 'is-selected' : ''}`}
              onClick={() => {
                setSelectedId(setlist.id);
                setIsRenaming(false);
                setConfirmDeleteId(null);
              }}
            >
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {setlist.name}
              </span>
              <span className="score-badge">
                {formatMessage(t.common.piecesCount, {
                  count: setlist.items.length,
                })}
              </span>
            </button>
          ))
        )}
      </section>

      <section className="setlist-detail">
        {!selectedSetlist ? (
          <div className="library-empty">
            <ListMusic size={34} color="var(--accent)" />
            <h3>{t.setlists.emptyList}</h3>
            <p>{t.setlists.emptyListDescription}</p>
          </div>
        ) : (
          <>
            <div className="setlist-detail-header">
              {isRenaming ? (
                <form
                  onSubmit={handleRenameSubmit}
                  style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}
                >
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    aria-label={t.setlists.renameTitle}
                    autoFocus
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <button type="submit" className="lib-btn lib-btn-primary" disabled={busy}>
                    <Check size={18} />
                    <span>{t.common.save}</span>
                  </button>
                  <button
                    type="button"
                    className="lib-btn"
                    onClick={() => setIsRenaming(false)}
                  >
                    <X size={18} />
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <h2 className="setlist-detail-title">{selectedSetlist.name}</h2>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                      {formatMessage(t.common.piecesCount, {
                        count: sortedItems.length,
                      })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="lib-btn lib-btn-primary"
                      disabled={sortedItems.length === 0 || !hasAvailableScoresToOpen}
                      onClick={() => onOpenSetlist(selectedSetlist, 0)}
                    >
                      <Play size={18} />
                      <span>{t.setlists.openInReader}</span>
                    </button>
                    <button
                      type="button"
                      className="lib-btn"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Plus size={18} />
                      <span>{t.setlists.addScore}</span>
                    </button>
                    <button
                      type="button"
                      className="lib-btn lib-btn-icon"
                      aria-label={t.common.rename}
                      title={t.common.rename}
                      onClick={() => {
                        setRenameDraft(selectedSetlist.name);
                        setIsRenaming(true);
                      }}
                    >
                      <Pencil size={18} />
                    </button>
                    {confirmDeleteId === selectedSetlist.id ? (
                      <button
                        type="button"
                        className="lib-btn lib-btn-danger"
                        disabled={busy}
                        onClick={() => handleDeleteSetlist(selectedSetlist.id)}
                      >
                        <Trash2 size={18} />
                        <span>{t.common.confirmDelete}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="lib-btn lib-btn-icon"
                        aria-label={t.common.delete}
                        title={t.common.delete}
                        onClick={() => setConfirmDeleteId(selectedSetlist.id)}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {sortedItems.length === 0 ? (
              <div className="library-empty">
                <p>{t.setlists.emptyItems}</p>
                <button
                  type="button"
                  className="lib-btn lib-btn-primary"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus size={18} />
                  <span>{t.setlists.addScore}</span>
                </button>
              </div>
            ) : (
              <div className="setlist-items-list">
                {sortedItems.map((item, idx) => {
                  const score = scoreById.get(item.scoreId);
                  const resolvedIdx = resolvedIndexByPos[idx];
                  const pitchLabel = score?.savedPitch
                    ? formatPitchLabel(
                        score.savedPitch.midiNotes,
                        language,
                        settings.noteNaming,
                      )
                    : '';
                  return (
                    <div key={`${item.scoreId}-${idx}`} className="setlist-item-row">
                      <span className="setlist-item-pos">{idx + 1}</span>
                      <button
                        type="button"
                        className="setlist-item-info"
                        disabled={resolvedIdx === null}
                        style={{
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          padding: '4px 6px',
                        }}
                        onClick={() => {
                          if (resolvedIdx !== null) {
                            onOpenSetlist(selectedSetlist, resolvedIdx);
                          }
                        }}
                      >
                        <div style={{ minWidth: 0, width: '100%' }}>
                          <div className="setlist-item-title">
                            {score ? score.title : item.scoreId}
                          </div>
                          {score && (
                            <div className="setlist-item-meta">
                              {formatMessage(t.common.pagesCount, {
                                count: score.pageCount || 1,
                              })}
                              {score.savedBpm ? ` · ${score.savedBpm} ${t.common.bpmSuffix}` : ''}
                              {pitchLabel ? ` · ${pitchLabel}` : ''}
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="setlist-item-controls">
                        <button
                          type="button"
                          className="lib-btn lib-btn-icon"
                          disabled={idx === 0 || busy}
                          aria-label={t.setlists.moveUp}
                          title={t.setlists.moveUp}
                          onClick={() => handleMoveItem(idx, -1)}
                        >
                          <ArrowUp size={18} />
                        </button>
                        <button
                          type="button"
                          className="lib-btn lib-btn-icon"
                          disabled={idx === sortedItems.length - 1 || busy}
                          aria-label={t.setlists.moveDown}
                          title={t.setlists.moveDown}
                          onClick={() => handleMoveItem(idx, 1)}
                        >
                          <ArrowDown size={18} />
                        </button>
                        <button
                          type="button"
                          className="lib-btn lib-btn-icon"
                          disabled={busy}
                          aria-label={t.setlists.removeItem}
                          title={t.setlists.removeItem}
                          onClick={() => handleRemoveItem(idx)}
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {pickerOpen && selectedSetlist && (
        <div
          className="lib-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t.setlists.chooseScore}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPickerOpen(false);
              setPickerQuery('');
            }
          }}
        >
          <div className="lib-modal-card">
            <div className="lib-modal-head">
              <h2>{t.setlists.chooseScore}</h2>
              <button
                type="button"
                className="lib-btn lib-btn-icon"
                aria-label={t.common.close}
                onClick={() => {
                  setPickerOpen(false);
                  setPickerQuery('');
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="lib-modal-body scroll-area">
              <input
                type="search"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t.library.searchPlaceholder}
                aria-label={t.library.searchPlaceholder}
              />
              {availableScoresToAdd.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  {t.setlists.allScoresAdded}
                </p>
              ) : (
                availableScoresToAdd.map((score) => (
                  <button
                    key={score.id}
                    type="button"
                    className="folder-row"
                    style={{ width: '100%', textAlign: 'left', justifyContent: 'space-between' }}
                    disabled={busy}
                    onClick={() => handleAddScore(score.id)}
                  >
                    <span style={{ fontWeight: 600 }}>{score.title}</span>
                    <Plus size={18} color="var(--accent)" />
                  </button>
                ))
              )}
            </div>
            <div className="lib-modal-foot">
              <button
                type="button"
                className="lib-btn lib-btn-primary"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerQuery('');
                }}
              >
                {t.common.done}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
