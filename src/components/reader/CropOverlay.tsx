import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import type { NormalizedRect } from '../../types';
import { clampNormalizedRect, FULL_PAGE_RECT } from '../../pdf';
import { useI18n } from '../../i18n';

export interface CropControlsBarProps {
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function CropControlsBar({
  onReset,
  onCancel,
  onApply,
}: CropControlsBarProps) {
  const { t } = useI18n();
  return (
    <div
      className="crop-controls-bar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="crop-controls-hint">{t.reader.cropInstructions}</div>
      <div className="crop-controls-actions">
        <button type="button" className="hud-btn" onClick={onReset}>
          <RotateCcw size={16} />
          <span>{t.reader.cropReset}</span>
        </button>
        <button type="button" className="hud-btn" onClick={onCancel}>
          <X size={16} />
          <span>{t.common.cancel}</span>
        </button>
        <button
          type="button"
          className="hud-btn is-active"
          onClick={onApply}
        >
          <Check size={16} />
          <span>{t.common.apply}</span>
        </button>
      </div>
    </div>
  );
}

export interface CropOverlayProps {
  initialRect: NormalizedRect;
  rect?: NormalizedRect;
  onRectChange?: (rect: NormalizedRect) => void;
  showControls?: boolean;
  onApply: (rect: NormalizedRect) => void;
  onCancel: () => void;
}

type DragHandle =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

const MIN_CROP_SIZE = 0.15;

export function CropOverlay({
  initialRect,
  rect: controlledRect,
  onRectChange,
  showControls = true,
  onApply,
  onCancel,
}: CropOverlayProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [internalRect, setInternalRect] = useState<NormalizedRect>(() =>
    clampNormalizedRect(initialRect, MIN_CROP_SIZE),
  );
  const rect = controlledRect ?? internalRect;
  const updateRect = (next: NormalizedRect) => {
    if (onRectChange) {
      onRectChange(next);
    } else {
      setInternalRect(next);
    }
  };

  const dragRef = useRef<{
    handle: DragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    startRect: NormalizedRect;
  } | null>(null);

  function startDrag(
    handle: DragHandle,
    e: ReactPointerEvent<HTMLElement>,
  ) {
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported in test environments.
    }
    dragRef.current = {
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect,
    };
  }

  function moveDrag(e: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const container = rootRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !container) {
      return;
    }
    e.stopPropagation();
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const dx = (e.clientX - drag.startX) / bounds.width;
    const dy = (e.clientY - drag.startY) / bounds.height;
    const s = drag.startRect;

    if (drag.handle === 'move') {
      const nextX = Math.max(0, Math.min(1 - s.width, s.x + dx));
      const nextY = Math.max(0, Math.min(1 - s.height, s.y + dy));
      updateRect({ ...s, x: nextX, y: nextY });
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (drag.handle.includes('w')) {
      left = Math.max(0, Math.min(right - MIN_CROP_SIZE, s.x + dx));
    }
    if (drag.handle.includes('e')) {
      right = Math.min(1, Math.max(left + MIN_CROP_SIZE, s.x + s.width + dx));
    }
    if (drag.handle.includes('n')) {
      top = Math.max(0, Math.min(bottom - MIN_CROP_SIZE, s.y + dy));
    }
    if (drag.handle.includes('s')) {
      bottom = Math.min(1, Math.max(top + MIN_CROP_SIZE, s.y + s.height + dy));
    }

    updateRect(
      clampNormalizedRect(
        {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        },
        MIN_CROP_SIZE,
      ),
    );
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors.
    }
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }

  const cornerLabels: Partial<Record<Exclude<DragHandle, 'move'>, string>> = {
    nw: t.crop.handleNw,
    ne: t.crop.handleNe,
    sw: t.crop.handleSw,
    se: t.crop.handleSe,
  };

  const handles: {
    id: Exclude<DragHandle, 'move'>;
    left: string;
    top: string;
    cursor: string;
  }[] = [
    { id: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
    { id: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
    { id: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
    { id: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
    { id: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
    { id: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
    { id: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
    { id: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
  ];

  return (
    <>
      <div
        ref={rootRef}
        className="crop-overlay-root"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="crop-box"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
          onPointerDown={(e) => startDrag('move', e)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            className="crop-grid-line"
            style={{ left: '33.33%', top: 0, bottom: 0, width: 1 }}
          />
          <div
            className="crop-grid-line"
            style={{ left: '66.66%', top: 0, bottom: 0, width: 1 }}
          />
          <div
            className="crop-grid-line"
            style={{ top: '33.33%', left: 0, right: 0, height: 1 }}
          />
          <div
            className="crop-grid-line"
            style={{ top: '66.66%', left: 0, right: 0, height: 1 }}
          />

          {handles.map((h) => (
            <button
              key={h.id}
              type="button"
              className="crop-handle"
              style={{ left: h.left, top: h.top, cursor: h.cursor }}
              aria-label={cornerLabels[h.id] ?? `${t.reader.cropMargins} ${h.id}`}
              onPointerDown={(e) => startDrag(h.id, e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
            >
              <span className="crop-handle-dot" />
            </button>
          ))}
        </div>
      </div>

      {showControls && (
        <CropControlsBar
          onReset={() => updateRect({ ...FULL_PAGE_RECT })}
          onCancel={onCancel}
          onApply={() => onApply(rect)}
        />
      )}
    </>
  );
}
