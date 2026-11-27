import React, { useEffect, useState } from 'react';
import './annotations.css';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Highlighter,
  Layers,
  MousePointer2,
  Pen,
  Pencil,
  Plus,
  Redo2,
  Shapes,
  Stamp,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import type { AnnotationLayer, AppLanguage, ShapeType } from '../../types';
import {
  HIGHLIGHTER_COLOR_PRESETS,
  PEN_COLOR_PRESETS,
  STAMP_COLOR_PRESETS,
  type AnnotationToolState,
} from './geometry';
import {
  getAnnotationTranslations,
  type AnnotationTool,
  type StrokeSizePreset,
} from './i18n';
import { StampGlyph } from './StampPalette';

export interface AnnotationToolbarProps {
  language: AppLanguage;
  toolState: AnnotationToolState;
  onToolStateChange: (next: AnnotationToolState) => void;
  layers: AnnotationLayer[];
  activeLayerId: string;
  onSelectLayer: (layerId: string) => void;
  onAddLayer: (name?: string) => void;
  onToggleLayerVisibility: (layerId: string) => void;
  onRenameLayer?: (layerId: string, name: string) => void;
  onDeleteLayer?: (layerId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showAllAnnotations: boolean;
  onToggleShowAllAnnotations: () => void;
  onClearPage?: () => void;
  onOpenStampPalette: () => void;
  onExportPdf?: () => void;
  isExportingPdf?: boolean;
  onDone: () => void;
  dockPosition?: 'top' | 'bottom';
  onDockPositionChange?: (pos: 'top' | 'bottom') => void;
}

const SIZE_PRESETS: readonly StrokeSizePreset[] = ['s', 'm', 'l'] as const;
const SHAPE_TYPES: readonly ShapeType[] = [
  'line',
  'bracket',
  'circle',
  'oval',
  'slur',
] as const;

const ShapePreviewIcon: React.FC<{ shapeType: ShapeType }> = ({ shapeType }) => {
  switch (shapeType) {
    case 'line':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <line
            x1="4"
            y1="19"
            x2="20"
            y2="5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'bracket':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M 15 4 L 8 4 L 8 20 L 15 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'circle':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
          />
        </svg>
      );
    case 'oval':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
          />
        </svg>
      );
    case 'slur':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M 3 16 Q 12 4 21 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
  }
};

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  language,
  toolState,
  onToolStateChange,
  layers,
  activeLayerId,
  onSelectLayer,
  onAddLayer,
  onToggleLayerVisibility,
  onRenameLayer,
  onDeleteLayer,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showAllAnnotations,
  onToggleShowAllAnnotations,
  onClearPage,
  onOpenStampPalette,
  onExportPdf,
  isExportingPdf = false,
  onDone,
  dockPosition: controlledDockPosition,
  onDockPositionChange,
}) => {
  const t = getAnnotationTranslations(language);
  const [internalDock, setInternalDock] = useState<'top' | 'bottom'>('top');
  const [collapsed, setCollapsed] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerName, setEditingLayerName] = useState('');

  const dockPosition = controlledDockPosition ?? internalDock;
  const setDockPosition = (pos: 'top' | 'bottom') => {
    setInternalDock(pos);
    onDockPositionChange?.(pos);
  };

  useEffect(() => {
    if (toolState.tool !== 'eraser') {
      setConfirmClear(false);
    }
  }, [toolState.tool]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          onUndo();
        }
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
        if (canRedo) {
          e.preventDefault();
          onRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo]);

  const selectTool = (tool: AnnotationTool) => {
    onToolStateChange({ ...toolState, tool });
    if (collapsed) {
      setCollapsed(false);
    }
  };

  const renderSizeButtons = (
    activeSize: StrokeSizePreset,
    onSelect: (size: StrokeSizePreset) => void
  ) => (
    <div className="notl-sare-ann-group">
      {SIZE_PRESETS.map((sz) => (
        <button
          key={sz}
          type="button"
          className={`notl-sare-size-btn ${activeSize === sz ? 'notl-sare-size-btn--active' : ''}`}
          onClick={() => onSelect(sz)}
          aria-pressed={activeSize === sz}
          aria-label={t.sizes[sz]}
        >
          {t.sizes[sz]}
        </button>
      ))}
    </div>
  );

  const renderColorSwatches = (
    presets: ReadonlyArray<{ id: string; color: string }>,
    labels: Record<string, string>,
    activeColor: string,
    onSelect: (color: string) => void
  ) => (
    <div className="notl-sare-ann-group">
      {presets.map((preset) => {
        const isActive = activeColor.toLowerCase() === preset.color.toLowerCase();
        const label = labels[preset.id] ?? preset.color;
        return (
          <button
            key={preset.id}
            type="button"
            className={`notl-sare-swatch-btn ${isActive ? 'notl-sare-swatch-btn--active' : ''}`}
            onClick={() => onSelect(preset.color)}
            aria-pressed={isActive}
            aria-label={label}
            title={label}
          >
            <span
              className="notl-sare-swatch-dot"
              style={{ backgroundColor: preset.color }}
            />
          </button>
        );
      })}
    </div>
  );

  const renderSubRow = () => {
    switch (toolState.tool) {
      case 'highlighter':
        return (
          <div className="notl-sare-ann-subrow">
            {renderColorSwatches(
              HIGHLIGHTER_COLOR_PRESETS,
              t.highlighterColors,
              toolState.highlighterColor,
              (color) =>
                onToolStateChange({ ...toolState, highlighterColor: color })
            )}
            <div className="notl-sare-ann-divider" />
            {renderSizeButtons(toolState.highlighterSize, (sz) =>
              onToolStateChange({ ...toolState, highlighterSize: sz })
            )}
          </div>
        );

      case 'pen':
        return (
          <div className="notl-sare-ann-subrow">
            {renderColorSwatches(
              PEN_COLOR_PRESETS,
              t.penColors,
              toolState.penColor,
              (color) => onToolStateChange({ ...toolState, penColor: color })
            )}
            <div className="notl-sare-ann-divider" />
            {renderSizeButtons(toolState.penSize, (sz) =>
              onToolStateChange({ ...toolState, penSize: sz })
            )}
          </div>
        );

      case 'shape':
        return (
          <div className="notl-sare-ann-subrow">
            <div className="notl-sare-ann-group">
              {SHAPE_TYPES.map((st) => {
                const isActive = toolState.shapeType === st;
                return (
                  <button
                    key={st}
                    type="button"
                    className={`notl-sare-tool-btn ${isActive ? 'notl-sare-tool-btn--active' : ''}`}
                    onClick={() =>
                      onToolStateChange({ ...toolState, shapeType: st })
                    }
                    aria-pressed={isActive}
                    aria-label={t.shapes[st]}
                    title={t.shapes[st]}
                  >
                    <ShapePreviewIcon shapeType={st} />
                    <span className="notl-sare-tool-label">{t.shapes[st]}</span>
                  </button>
                );
              })}
            </div>
            <div className="notl-sare-ann-divider" />
            {renderColorSwatches(
              PEN_COLOR_PRESETS,
              t.penColors,
              toolState.shapeColor,
              (color) => onToolStateChange({ ...toolState, shapeColor: color })
            )}
            <div className="notl-sare-ann-divider" />
            {renderSizeButtons(toolState.shapeSize, (sz) =>
              onToolStateChange({ ...toolState, shapeSize: sz })
            )}
          </div>
        );

      case 'stamp':
        return (
          <div className="notl-sare-ann-subrow">
            <button
              type="button"
              className="notl-sare-tool-btn notl-sare-tool-btn--subtle"
              onClick={onOpenStampPalette}
              aria-label={t.actions.chooseStamp}
            >
              <span style={{ width: 22, height: 22, display: 'inline-flex' }}>
                <StampGlyph stampType={toolState.stampType} />
              </span>
              <span>{t.stamps[toolState.stampType]}</span>
            </button>
            <div className="notl-sare-ann-divider" />
            {renderColorSwatches(
              STAMP_COLOR_PRESETS,
              t.stampColors,
              toolState.stampColor,
              (color) => onToolStateChange({ ...toolState, stampColor: color })
            )}
            <div className="notl-sare-ann-divider" />
            {renderSizeButtons(toolState.stampSize, (sz) =>
              onToolStateChange({ ...toolState, stampSize: sz })
            )}
          </div>
        );

      case 'text':
        return (
          <div className="notl-sare-ann-subrow">
            <span className="notl-sare-ann-hint">{t.hints.text}</span>
            <div className="notl-sare-ann-group">
              {renderColorSwatches(
                PEN_COLOR_PRESETS,
                t.penColors,
                toolState.textColor,
                (color) => onToolStateChange({ ...toolState, textColor: color })
              )}
              <div className="notl-sare-ann-divider" />
              {renderSizeButtons(toolState.textSize, (sz) =>
                onToolStateChange({ ...toolState, textSize: sz })
              )}
            </div>
          </div>
        );

      case 'eraser':
        return (
          <div className="notl-sare-ann-subrow">
            <span className="notl-sare-ann-hint">{t.hints.eraser}</span>
            {onClearPage && (
              <div className="notl-sare-ann-group">
                {!confirmClear ? (
                  <button
                    type="button"
                    className="notl-sare-btn-danger"
                    onClick={() => setConfirmClear(true)}
                  >
                    <Trash2 size={18} />
                    <span>{t.actions.clearPage}</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="notl-sare-btn-danger"
                      onClick={() => {
                        setConfirmClear(false);
                        onClearPage();
                      }}
                    >
                      <Check size={18} />
                      <span>{t.actions.confirmClearPage}</span>
                    </button>
                    <button
                      type="button"
                      className="notl-sare-btn-secondary"
                      onClick={() => setConfirmClear(false)}
                      aria-label={t.actions.cancel}
                    >
                      <X size={18} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );

      case 'select':
        return (
          <div className="notl-sare-ann-subrow">
            <span className="notl-sare-ann-hint">{t.hints.select}</span>
          </div>
        );
    }
  };

  if (collapsed) {
    return (
      <div
        className={`notl-sare-ann-toolbar notl-sare-ann-toolbar--${dockPosition} notl-sare-ann-toolbar--collapsed`}
        role="toolbar"
        aria-label={t.tools[toolState.tool]}
      >
        <div className="notl-sare-ann-row">
          <button
            type="button"
            className="notl-sare-tool-btn notl-sare-tool-btn--active"
            onClick={() => setCollapsed(false)}
            aria-label={t.actions.expandToolbar}
            title={t.actions.expandToolbar}
          >
            {dockPosition === 'top' ? (
              <ChevronDown size={20} />
            ) : (
              <ChevronUp size={20} />
            )}
            <span>{t.tools[toolState.tool]}</span>
          </button>
          <button
            type="button"
            className="notl-sare-tool-btn"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label={t.actions.undo}
            title={t.actions.undo}
          >
            <Undo2 size={20} />
          </button>
          <button
            type="button"
            className="notl-sare-tool-btn notl-sare-tool-btn--accent"
            onClick={onDone}
          >
            <Check size={18} />
            <span>{t.actions.done}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`notl-sare-ann-toolbar notl-sare-ann-toolbar--${dockPosition}`}
        role="toolbar"
        aria-label={t.layers.defaultName}
      >
        <div className="notl-sare-ann-row">
          <div className="notl-sare-ann-group">
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'select' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('select')}
              aria-pressed={toolState.tool === 'select'}
              aria-label={t.tools.select}
              title={t.tools.select}
            >
              <MousePointer2 size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'highlighter' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('highlighter')}
              aria-pressed={toolState.tool === 'highlighter'}
              aria-label={t.tools.highlighter}
              title={t.tools.highlighter}
            >
              <Highlighter size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'pen' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('pen')}
              aria-pressed={toolState.tool === 'pen'}
              aria-label={t.tools.pen}
              title={t.tools.pen}
            >
              <Pen size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'eraser' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('eraser')}
              aria-pressed={toolState.tool === 'eraser'}
              aria-label={t.tools.eraser}
              title={t.tools.eraser}
            >
              <Eraser size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'shape' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('shape')}
              aria-pressed={toolState.tool === 'shape'}
              aria-label={t.tools.shape}
              title={t.tools.shape}
            >
              <Shapes size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'stamp' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => {
                if (toolState.tool === 'stamp') {
                  onOpenStampPalette();
                } else {
                  selectTool('stamp');
                  onOpenStampPalette();
                }
              }}
              aria-pressed={toolState.tool === 'stamp'}
              aria-label={t.tools.stamp}
              title={t.tools.stamp}
            >
              <Stamp size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${toolState.tool === 'text' ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => selectTool('text')}
              aria-pressed={toolState.tool === 'text'}
              aria-label={t.tools.text}
              title={t.tools.text}
            >
              <Type size={20} />
            </button>
          </div>

          <div className="notl-sare-ann-divider" />

          <div className="notl-sare-ann-group">
            <button
              type="button"
              className="notl-sare-tool-btn"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label={t.actions.undo}
              title={t.actions.undo}
            >
              <Undo2 size={20} />
            </button>
            <button
              type="button"
              className="notl-sare-tool-btn"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label={t.actions.redo}
              title={t.actions.redo}
            >
              <Redo2 size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${layersOpen ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={() => setLayersOpen((prev) => !prev)}
              aria-expanded={layersOpen}
              aria-label={t.actions.layers}
              title={t.actions.layers}
            >
              <Layers size={20} />
            </button>
            <button
              type="button"
              className={`notl-sare-tool-btn ${!showAllAnnotations ? 'notl-sare-tool-btn--active' : ''}`}
              onClick={onToggleShowAllAnnotations}
              aria-pressed={showAllAnnotations}
              aria-label={
                showAllAnnotations ? t.actions.hideAll : t.actions.showAll
              }
              title={showAllAnnotations ? t.actions.hideAll : t.actions.showAll}
            >
              {showAllAnnotations ? <Eye size={20} /> : <EyeOff size={20} />}
            </button>
            {onExportPdf && (
              <button
                type="button"
                className="notl-sare-tool-btn"
                disabled={isExportingPdf}
                onClick={onExportPdf}
                aria-label={
                  isExportingPdf ? t.actions.exportingPdf : t.actions.exportPdf
                }
                title={
                  isExportingPdf ? t.actions.exportingPdf : t.actions.exportPdf
                }
              >
                <Download size={20} />
              </button>
            )}
            <button
              type="button"
              className="notl-sare-tool-btn"
              onClick={() =>
                setDockPosition(dockPosition === 'top' ? 'bottom' : 'top')
              }
              aria-label={
                dockPosition === 'top' ? t.actions.dockBottom : t.actions.dockTop
              }
              title={
                dockPosition === 'top' ? t.actions.dockBottom : t.actions.dockTop
              }
            >
              {dockPosition === 'top' ? (
                <ArrowDownToLine size={18} />
              ) : (
                <ArrowUpToLine size={18} />
              )}
            </button>
            <button
              type="button"
              className="notl-sare-tool-btn"
              onClick={() => {
                setLayersOpen(false);
                setCollapsed(true);
              }}
              aria-label={t.actions.collapseToolbar}
              title={t.actions.collapseToolbar}
            >
              {dockPosition === 'top' ? (
                <ChevronUp size={18} />
              ) : (
                <ChevronDown size={18} />
              )}
            </button>
          </div>

          <button
            type="button"
            className="notl-sare-tool-btn notl-sare-tool-btn--accent"
            onClick={() => {
              setLayersOpen(false);
              onDone();
            }}
          >
            <Check size={18} />
            <span>{t.actions.done}</span>
          </button>
        </div>

        {renderSubRow()}
      </div>

      {layersOpen && (
        <div
          className={`notl-sare-layers-popover notl-sare-layers-popover--${dockPosition}`}
          role="dialog"
          aria-label={t.layers.title}
        >
          <div className="notl-sare-layers-header">
            <h3 className="notl-sare-layers-title">{t.layers.title}</h3>
            <button
              type="button"
              className="notl-sare-tool-btn"
              onClick={() => setLayersOpen(false)}
              aria-label={t.actions.close}
            >
              <X size={18} />
            </button>
          </div>

          {layers.map((layer) => {
            const isActive = layer.id === activeLayerId;
            const isEditing = editingLayerId === layer.id;
            return (
              <div
                key={layer.id}
                className={`notl-sare-layer-row ${isActive ? 'notl-sare-layer-row--active' : ''}`}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editingLayerName}
                    onChange={(e) => setEditingLayerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const trimmed = editingLayerName.trim();
                        if (trimmed && onRenameLayer) {
                          onRenameLayer(layer.id, trimmed);
                        }
                        setEditingLayerId(null);
                      } else if (e.key === 'Escape') {
                        setEditingLayerId(null);
                      }
                    }}
                    onBlur={() => {
                      const trimmed = editingLayerName.trim();
                      if (trimmed && onRenameLayer) {
                        onRenameLayer(layer.id, trimmed);
                      }
                      setEditingLayerId(null);
                    }}
                    autoFocus
                    aria-label={t.layers.renameLayer}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                ) : (
                  <button
                    type="button"
                    className="notl-sare-layer-select-btn"
                    onClick={() => onSelectLayer(layer.id)}
                  >
                    <span>{layer.name}</span>
                    {isActive && (
                      <span className="notl-sare-layer-active-tag">
                        {t.layers.activeBadge}
                      </span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  className="notl-sare-tool-btn"
                  onClick={() => onToggleLayerVisibility(layer.id)}
                  aria-label={
                    layer.visible ? t.layers.hideLayer : t.layers.showLayer
                  }
                  title={
                    layer.visible ? t.layers.hideLayer : t.layers.showLayer
                  }
                >
                  {layer.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>

                {onRenameLayer && !isEditing && (
                  <button
                    type="button"
                    className="notl-sare-tool-btn"
                    onClick={() => {
                      setEditingLayerId(layer.id);
                      setEditingLayerName(layer.name);
                    }}
                    aria-label={t.layers.renameLayer}
                    title={t.layers.renameLayer}
                  >
                    <Pencil size={16} />
                  </button>
                )}

                {onDeleteLayer && layers.length > 1 && layer.id !== 'default' && (
                  <button
                    type="button"
                    className="notl-sare-tool-btn"
                    onClick={() => onDeleteLayer(layer.id)}
                    aria-label={t.layers.deleteLayer}
                    title={t.layers.deleteLayer}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="notl-sare-btn-primary"
            onClick={() => onAddLayer()}
          >
            <Plus size={18} />
            <span>{t.layers.addLayer.replace(/^\+\s*/, '')}</span>
          </button>
        </div>
      )}
    </>
  );
};
