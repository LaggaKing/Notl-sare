// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { PageAnnotations, StampType } from '../../types';
import {
  ANNOTATION_I18N,
  AnnotationCanvas,
  AnnotationToolbar,
  STAMP_CATEGORIES,
  STAMP_DEFINITIONS,
  STAMP_LIST,
  StampPalette,
  createDefaultAnnotationToolState,
  cubicSvgPathForPoints,
  getStampsByCategory,
  hitTestItem,
  smoothStrokePoints,
  svgPathForPoints,
  useAnnotationSession,
  type AnnotationToolState,
} from './index';
import { exportAnnotatedPdf } from '../../services/pdfExport';

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    pressure: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'touch';
      this.pressure = params.pressure ?? 0.5;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
    MockPointerEvent as unknown as typeof PointerEvent;
}

afterEach(() => {
  cleanup();
});

const ALL_39_STAMPS: StampType[] = [
  'breath',
  'no_breath',
  'caesura',
  'fermata',
  'cutoff',
  'pitch_up',
  'pitch_down',
  'sharp',
  'flat',
  'natural',
  'half_step',
  'whole_step',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'sfz',
  'fp',
  'cresc_text',
  'dim_text',
  'cresc_hairpin',
  'dim_hairpin',
  'accent',
  'staccato',
  'tenuto',
  'marcato',
  'segno',
  'coda',
  'dc',
  'ds',
  'fine',
  'repeat_start',
  'repeat_end',
  'turn_page',
  'watch_conductor',
];

function makeBasePageAnnotations(): PageAnnotations {
  return {
    scoreId: 'score-1',
    pageNum: 1,
    layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
    items: [],
    updatedAt: '2026-11-22T12:00:00.000Z',
  };
}

describe('annotations i18n and stamps', () => {
  it('provides complete Swedish and English translations for all 39 stamps and tools', () => {
    expect(ANNOTATION_I18N.sv.tools.highlighter).toBe('Stämmarkering');
    expect(ANNOTATION_I18N.sv.tools.pen).toBe('Penna');
    expect(ANNOTATION_I18N.sv.tools.eraser).toBe('Suddgummi');
    expect(ANNOTATION_I18N.sv.tools.text).toBe('Text');
    expect(ANNOTATION_I18N.sv.tools.stamp).toBe('Stämplar');
    expect(ANNOTATION_I18N.sv.tools.shape).toBe('Former');
    expect(ANNOTATION_I18N.sv.layers.addLayer).toBe('+ Nytt lager');
    expect(ANNOTATION_I18N.en.layers.addLayer).toBe('+ Add layer');
    expect(ANNOTATION_I18N.sv.layers.defaultName).toBe('Anteckningar');
    expect(ANNOTATION_I18N.en.layers.defaultName).toBe('Annotations');
    expect(ANNOTATION_I18N.sv.stamps.watch_conductor).toBe('Se dirigenten');
    expect(ANNOTATION_I18N.sv.stamps.turn_page).toBe('Bläddra');

    for (const stamp of ALL_39_STAMPS) {
      expect(ANNOTATION_I18N.sv.stamps[stamp].length).toBeGreaterThan(0);
      expect(ANNOTATION_I18N.en.stamps[stamp].length).toBeGreaterThan(0);
    }
  });

  it('defines vector primitives for all 39 StampType entries across categories', () => {
    expect(STAMP_LIST).toHaveLength(39);
    for (const stamp of ALL_39_STAMPS) {
      const def = STAMP_DEFINITIONS[stamp];
      expect(def).toBeDefined();
      expect(def.primitives.length).toBeGreaterThan(0);
      expect(def.width).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);
    }

    const totalCategorized = STAMP_CATEGORIES.reduce(
      (sum, cat) => sum + getStampsByCategory(cat).length,
      0
    );
    expect(totalCategorized).toBe(39);
  });
});

describe('geometry helpers', () => {
  it('smoothStrokePoints decimates close points and preserves endpoints', () => {
    const raw = [
      { x: 0.1, y: 0.1 },
      { x: 0.1005, y: 0.1005 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.15 },
      { x: 0.4, y: 0.25 },
    ];
    const smoothed = smoothStrokePoints(raw, 0.005);
    expect(smoothed.length).toBe(4);
    expect(smoothed[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(smoothed[smoothed.length - 1]).toEqual({ x: 0.4, y: 0.25 });
  });

  it('svgPathForPoints builds quadratic Bezier SVG path strings', () => {
    expect(svgPathForPoints([])).toBe('');
    expect(svgPathForPoints([{ x: 0.5, y: 0.5 }], 1000, 1000)).toBe(
      'M 500.00 500.00 L 500.00 500.00'
    );
    const path = svgPathForPoints(
      [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
        { x: 0.5, y: 0.2 },
      ],
      1000,
      1000
    );
    expect(path).toContain('M 100.00 200.00');
    expect(path).toContain('Q 300.00 400.00');
    expect(path).toContain('L 500.00 200.00');
  });

  it('hitTestItem accurately tests strokes, shapes, stamps, and text', () => {
    expect(
      hitTestItem(
        {
          kind: 'stroke',
          id: 's1',
          layerId: 'default',
          tool: 'pen',
          points: [
            { x: 0.1, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
          color: '#141416',
          width: 0.004,
          opacity: 1,
        },
        { x: 0.3, y: 0.505 },
        0.02
      )
    ).toBe(true);

    expect(
      hitTestItem(
        {
          kind: 'shape',
          id: 'sh1',
          layerId: 'default',
          shapeType: 'circle',
          start: { x: 0.5, y: 0.5 },
          end: { x: 0.6, y: 0.5 },
          color: '#d64545',
          width: 0.004,
        },
        { x: 0.6, y: 0.5 },
        0.02
      )
    ).toBe(true);

    expect(
      hitTestItem(
        {
          kind: 'stamp',
          id: 'st1',
          layerId: 'default',
          stampType: 'fermata',
          position: { x: 0.4, y: 0.3 },
          scale: 1,
          color: '#141416',
        },
        { x: 0.41, y: 0.305 },
        0.02
      )
    ).toBe(true);

    expect(
      hitTestItem(
        {
          kind: 'text',
          id: 't1',
          layerId: 'default',
          position: { x: 0.2, y: 0.2 },
          text: 'Andas!',
          fontSize: 0.024,
          color: '#141416',
        },
        { x: 0.23, y: 0.21 },
        0.02
      )
    ).toBe(true);
  });
});

describe('AnnotationCanvas pointer interaction & multi-touch abort', () => {
  function mockBoundingRect(el: Element) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 500,
        height: 707,
        right: 500,
        bottom: 707,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
  }

  it('commits a multiply-blended highlighter stroke on single-finger drag', () => {
    const onChange = vi.fn();
    const { container } = render(
      <AnnotationCanvas
        pageAnnotations={makeBasePageAnnotations()}
        onChange={onChange}
        toolState={createDefaultAnnotationToolState()}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />
    );

    const root = container.querySelector('.notlasare-annotation-root')!;
    mockBoundingRect(root);

    fireEvent.pointerDown(root, { pointerId: 1, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 250, clientY: 100 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as PageAnnotations;
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].kind).toBe('stroke');
    if (updated.items[0].kind === 'stroke') {
      expect(updated.items[0].tool).toBe('highlighter');
      expect(updated.items[0].multiply).toBe(true);
      expect(updated.items[0].points[0].x).toBeCloseTo(0.1, 2);
    }
  });

  it('aborts accidental <8px 1-finger stroke immediately when 2nd finger touches down and delegates pinch/pan', () => {
    const onChange = vi.fn();
    const onPinchPanStart = vi.fn();
    const onPinchPanMove = vi.fn();
    const onPinchPanEnd = vi.fn();

    const { container } = render(
      <AnnotationCanvas
        pageAnnotations={makeBasePageAnnotations()}
        onChange={onChange}
        toolState={createDefaultAnnotationToolState()}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
        onPinchPanStart={onPinchPanStart}
        onPinchPanMove={onPinchPanMove}
        onPinchPanEnd={onPinchPanEnd}
      />
    );

    const root = container.querySelector('.notlasare-annotation-root')!;
    mockBoundingRect(root);

    fireEvent.pointerDown(root, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 103, clientY: 202 });
    // Second finger arrives immediately for pinch-zoom
    fireEvent.pointerDown(root, { pointerId: 2, clientX: 300, clientY: 400 });

    expect(onPinchPanStart).toHaveBeenCalledTimes(1);
    expect(onPinchPanStart.mock.calls[0][0]).toHaveLength(2);

    fireEvent.pointerMove(root, { pointerId: 2, clientX: 330, clientY: 430 });
    expect(onPinchPanMove).toHaveBeenCalledTimes(1);

    // Lift pointer 2, then move/lift pointer 1 — no stray stroke should ever commit
    fireEvent.pointerUp(root, { pointerId: 2, clientX: 330, clientY: 430 });
    expect(onPinchPanEnd).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(root, { pointerId: 1, clientX: 140, clientY: 240 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 140, clientY: 240 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('places stamps and allows selecting and deleting them via 48px touch handle', () => {
    function Harness() {
      const [annotations, setAnnotations] = useState<PageAnnotations>(
        makeBasePageAnnotations()
      );
      const [toolState, setToolState] = useState<AnnotationToolState>(() => ({
        ...createDefaultAnnotationToolState(),
        tool: 'stamp',
        stampType: 'watch_conductor',
      }));
      return (
        <div>
          <button
            type="button"
            onClick={() => setToolState((s) => ({ ...s, tool: 'select' }))}
          >
            switch-select
          </button>
          <AnnotationCanvas
            pageAnnotations={annotations}
            onChange={setAnnotations}
            toolState={toolState}
            activeLayerId="default"
            active={true}
            showAllAnnotations={true}
            language="sv"
            pageWidth={500}
            pageHeight={707}
          />
        </div>
      );
    }

    const { container } = render(<Harness />);
    const root = container.querySelector('.notlasare-annotation-root')!;
    mockBoundingRect(root);

    // Place stamp at (0.5, 0.5)
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 250, clientY: 353.5 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 250, clientY: 353.5 });

    expect(container.querySelectorAll('g')).toHaveLength(1);

    // Switch to select tool and tap stamp
    fireEvent.click(screen.getByText('switch-select'));
    fireEvent.pointerDown(root, { pointerId: 2, clientX: 250, clientY: 353.5 });
    fireEvent.pointerUp(root, { pointerId: 2, clientX: 250, clientY: 353.5 });

    const deleteBtn = screen.getByLabelText('Ta bort');
    fireEvent.click(deleteBtn);

    expect(container.querySelectorAll('g')).toHaveLength(0);
  });
});

describe('AnnotationToolbar, StampPalette, and useAnnotationSession', () => {
  it('supports layer creation, stamp selection, undo/redo, and show/hide toggle', () => {
    function SessionHarness() {
      const [annotations, setAnnotations] = useState<PageAnnotations>(
        makeBasePageAnnotations()
      );
      const [paletteOpen, setPaletteOpen] = useState(false);
      const session = useAnnotationSession({
        pageAnnotations: annotations,
        onCommit: setAnnotations,
        language: 'sv',
      });

      return (
        <div>
          <span data-testid="layer-count">{session.layers.length}</span>
          <span data-testid="active-stamp">{session.toolState.stampType}</span>
          <span data-testid="show-all">{String(session.showAllAnnotations)}</span>
          <AnnotationToolbar
            language="sv"
            toolState={session.toolState}
            onToolStateChange={session.setToolState}
            layers={session.layers}
            activeLayerId={session.activeLayerId}
            onSelectLayer={session.setActiveLayerId}
            onAddLayer={session.addLayer}
            onToggleLayerVisibility={session.toggleLayerVisibility}
            onRenameLayer={session.renameLayer}
            onDeleteLayer={session.deleteLayer}
            canUndo={session.canUndo}
            canRedo={session.canRedo}
            onUndo={session.undo}
            onRedo={session.redo}
            showAllAnnotations={session.showAllAnnotations}
            onToggleShowAllAnnotations={session.toggleShowAllAnnotations}
            onOpenStampPalette={() => setPaletteOpen(true)}
            onDone={() => {}}
          />
          <StampPalette
            open={paletteOpen}
            language="sv"
            activeStamp={session.toolState.stampType}
            onSelectStamp={(stampType) =>
              session.setToolState({ ...session.toolState, tool: 'stamp', stampType })
            }
            onClose={() => setPaletteOpen(false)}
          />
        </div>
      );
    }

    render(<SessionHarness />);

    // Open layers popover and add a layer
    fireEvent.click(screen.getByLabelText('Lager'));
    fireEvent.click(screen.getByText('Nytt lager'));
    expect(screen.getByTestId('layer-count').textContent).toBe('2');

    // Undo layer add, then redo
    fireEvent.click(screen.getByLabelText('Ångra'));
    expect(screen.getByTestId('layer-count').textContent).toBe('1');
    fireEvent.click(screen.getByLabelText('Gör om'));
    expect(screen.getByTestId('layer-count').textContent).toBe('2');

    // Toggle visibility of all annotations
    fireEvent.click(screen.getByLabelText('Dölj anteckningar'));
    expect(screen.getByTestId('show-all').textContent).toBe('false');

    // Open stamp palette and pick "Se dirigenten"
    fireEvent.click(screen.getByLabelText('Stämplar'));
    fireEvent.click(screen.getByLabelText('Se dirigenten'));
    expect(screen.getByTestId('active-stamp').textContent).toBe('watch_conductor');
  });
});

describe('pdfExport', () => {
  it('bakes visible strokes, shapes, stamps, and Swedish text into valid PDF bytes in Node/jsdom', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const originalBytes = await doc.save();

    const page1: PageAnnotations = {
      scoreId: 's1',
      pageNum: 1,
      layers: [
        { id: 'default', name: 'Anteckningar', visible: true },
        { id: 'hidden', name: 'Dold', visible: false },
      ],
      items: [
        {
          kind: 'stroke',
          id: 'hl-1',
          layerId: 'default',
          tool: 'highlighter',
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.5, y: 0.21 },
            { x: 0.85, y: 0.2 },
          ],
          color: '#f7c948',
          width: 0.024,
          opacity: 0.48,
          multiply: true,
        },
        {
          kind: 'stroke',
          id: 'pen-1',
          layerId: 'default',
          tool: 'pen',
          points: [
            { x: 0.2, y: 0.4 },
            { x: 0.25, y: 0.42 },
            { x: 0.3, y: 0.41 },
          ],
          color: '#d64545',
          width: 0.004,
          opacity: 1,
        },
        {
          kind: 'shape',
          id: 'sh-line',
          layerId: 'default',
          shapeType: 'line',
          start: { x: 0.1, y: 0.5 },
          end: { x: 0.3, y: 0.5 },
          color: '#2563eb',
          width: 0.003,
        },
        {
          kind: 'shape',
          id: 'sh-bracket',
          layerId: 'default',
          shapeType: 'bracket',
          start: { x: 0.08, y: 0.55 },
          end: { x: 0.1, y: 0.65 },
          color: '#141416',
          width: 0.003,
        },
        {
          kind: 'shape',
          id: 'sh-circle',
          layerId: 'default',
          shapeType: 'circle',
          start: { x: 0.5, y: 0.55 },
          end: { x: 0.55, y: 0.55 },
          color: '#d64545',
          width: 0.003,
        },
        {
          kind: 'shape',
          id: 'sh-oval',
          layerId: 'default',
          shapeType: 'oval',
          start: { x: 0.6, y: 0.5 },
          end: { x: 0.78, y: 0.58 },
          color: '#16a34a',
          width: 0.003,
        },
        {
          kind: 'shape',
          id: 'sh-slur',
          layerId: 'default',
          shapeType: 'slur',
          start: { x: 0.2, y: 0.7 },
          end: { x: 0.6, y: 0.7 },
          color: '#141416',
          width: 0.004,
        },
        {
          kind: 'stamp',
          id: 'st-glasses',
          layerId: 'default',
          stampType: 'watch_conductor',
          position: { x: 0.5, y: 0.15 },
          scale: 1.2,
          rotation: 10,
          color: '#d64545',
        },
        {
          kind: 'stamp',
          id: 'st-mf',
          layerId: 'default',
          stampType: 'mf',
          position: { x: 0.35, y: 0.35 },
          scale: 1.0,
          color: '#141416',
        },
        {
          kind: 'stamp',
          id: 'st-fermata',
          layerId: 'default',
          stampType: 'fermata',
          position: { x: 0.7, y: 0.35 },
          scale: 1.1,
          color: '#141416',
        },
        {
          kind: 'text',
          id: 'tx-1',
          layerId: 'default',
          position: { x: 0.2, y: 0.8 },
          text: 'Andas här! Högt c♯ åäö',
          fontSize: 0.022,
          color: '#141416',
          bgColor: '#fcfbf7',
        },
        {
          kind: 'text',
          id: 'tx-hidden',
          layerId: 'hidden',
          position: { x: 0.2, y: 0.9 },
          text: 'Should not draw',
          fontSize: 0.02,
          color: '#d64545',
        },
      ],
      updatedAt: '2026-11-22T12:00:00.000Z',
    };

    const exportedBytes = await exportAnnotatedPdf(originalBytes, [page1]);
    expect(exportedBytes).toBeInstanceOf(Uint8Array);
    expect(exportedBytes.length).toBeGreaterThan(originalBytes.length);

    const reloaded = await PDFDocument.load(exportedBytes);
    expect(reloaded.getPageCount()).toBe(2);

    const extGState = reloaded
      .getPage(0)
      .node.Resources()
      ?.lookup(PDFName.of('ExtGState'), PDFDict);
    expect(extGState).toBeDefined();
    const hasMultiply = extGState
      ?.entries()
      .some(([, ref]) => {
        const dict = reloaded.context.lookup(ref, PDFDict);
        return dict?.get(PDFName.of('BM'))?.toString() === '/Multiply';
      });
    expect(hasMultiply).toBe(true);
  });

  it('exports all 39 StampType variants cleanly without throwing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 850]);
    const originalBytes = await doc.save();

    const allStampItems = ALL_39_STAMPS.map((stampType, idx) => ({
      kind: 'stamp' as const,
      id: `st-${idx}`,
      layerId: 'default',
      stampType,
      position: {
        x: 0.1 + (idx % 6) * 0.14,
        y: 0.1 + Math.floor(idx / 6) * 0.12,
      },
      scale: 1,
      color: '#141416',
    }));

    const exportedBytes = await exportAnnotatedPdf(originalBytes, [
      {
        scoreId: 'all-stamps',
        pageNum: 1,
        layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
        items: allStampItems,
        updatedAt: '2026-11-22T12:00:00.000Z',
      },
    ]);

    const reloaded = await PDFDocument.load(exportedBytes);
    expect(reloaded.getPageCount()).toBe(1);
    expect(exportedBytes.length).toBeGreaterThan(originalBytes.length);
  });
});

describe('AnnotationCanvas resize, text, and eraser scrub', () => {
  function mockRect(el: Element) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 500,
        height: 707,
        right: 500,
        bottom: 707,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
  }

  it('resizes a selected stamp via 48px corner resize handle and creates/edits text notes', () => {
    const onChange = vi.fn();
    const initial: PageAnnotations = {
      ...makeBasePageAnnotations(),
      items: [
        {
          kind: 'stamp',
          id: 'stamp-resize-1',
          layerId: 'default',
          stampType: 'fermata',
          position: { x: 0.5, y: 0.5 },
          scale: 1,
          color: '#141416',
        },
      ],
    };

    const { container, rerender } = render(
      <AnnotationCanvas
        pageAnnotations={initial}
        onChange={onChange}
        toolState={{ ...createDefaultAnnotationToolState(), tool: 'select' }}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />
    );

    const root = container.querySelector('.notlasare-annotation-root')!;
    mockRect(root);

    // Select stamp
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 250, clientY: 353.5 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 250, clientY: 353.5 });

    const resizeHandle = screen.getByLabelText('Ändra storlek');
    fireEvent.pointerDown(resizeHandle, { pointerId: 2, clientX: 263, clientY: 367 });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 290, clientY: 394 });
    fireEvent.pointerUp(root, { pointerId: 2, clientX: 290, clientY: 394 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const resized = onChange.mock.calls[0][0] as PageAnnotations;
    expect(resized.items[0].kind).toBe('stamp');
    if (resized.items[0].kind === 'stamp') {
      expect(resized.items[0].scale).toBeGreaterThan(1.3);
    }

    // Switch to text tool and create a note
    rerender(
      <AnnotationCanvas
        pageAnnotations={resized}
        onChange={onChange}
        toolState={{ ...createDefaultAnnotationToolState(), tool: 'text' }}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />
    );

    fireEvent.pointerDown(root, { pointerId: 3, clientX: 100, clientY: 141 });
    fireEvent.pointerUp(root, { pointerId: 3, clientX: 100, clientY: 141 });

    const textarea = screen.getByPlaceholderText('Skriv anteckning...');
    fireEvent.change(textarea, { target: { value: 'Lättare på upptakten' } });
    fireEvent.click(screen.getByText('Spara'));

    expect(onChange).toHaveBeenCalledTimes(2);
    const withText = onChange.mock.calls[1][0] as PageAnnotations;
    expect(withText.items).toHaveLength(2);
    expect(withText.items[1].kind).toBe('text');
  });

  it('erases items on eraser drag scrub as one batch commit', () => {
    const onChange = vi.fn();
    const initial: PageAnnotations = {
      ...makeBasePageAnnotations(),
      items: [
        {
          kind: 'stamp',
          id: 's-a',
          layerId: 'default',
          stampType: 'breath',
          position: { x: 0.2, y: 0.5 },
          scale: 1,
          color: '#141416',
        },
        {
          kind: 'stamp',
          id: 's-b',
          layerId: 'default',
          stampType: 'cutoff',
          position: { x: 0.6, y: 0.5 },
          scale: 1,
          color: '#141416',
        },
      ],
    };

    const { container } = render(
      <AnnotationCanvas
        pageAnnotations={initial}
        onChange={onChange}
        toolState={{ ...createDefaultAnnotationToolState(), tool: 'eraser' }}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />
    );

    const root = container.querySelector('.notlasare-annotation-root')!;
    mockRect(root);

    fireEvent.pointerDown(root, { pointerId: 1, clientX: 100, clientY: 353.5 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 300, clientY: 353.5 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 300, clientY: 353.5 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const afterErase = onChange.mock.calls[0][0] as PageAnnotations;
    expect(afterErase.items).toHaveLength(0);
  });
});

describe('Merged geometry, hidden layers, and PDF export assertions', () => {
  function mockRect(el: Element) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 500,
        height: 707,
        right: 500,
        bottom: 707,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
  }

  it('handles empty/single strokes, 3-tap blending, and cubicSvgPathForPoints', () => {
    expect(smoothStrokePoints([])).toEqual([]);
    expect(smoothStrokePoints([{ x: 0.2, y: 0.3 }])).toEqual([{ x: 0.2, y: 0.3 }]);

    const points = [
      { x: 0.1, y: 0.5, p: 0.4 },
      { x: 0.1004, y: 0.5004, p: 0.5 },
      { x: 0.2, y: 0.4, p: 0.6 },
      { x: 0.3, y: 0.6, p: 0.7 },
      { x: 0.4, y: 0.5, p: 0.8 },
    ];
    const smoothed = smoothStrokePoints(points, 0.01);
    expect(smoothed).toHaveLength(4);
    expect(smoothed[1].x).toBeCloseTo(0.1 * 0.2 + 0.2 * 0.6 + 0.3 * 0.2, 6);
    expect(smoothed[1].y).toBeCloseTo(0.5 * 0.2 + 0.4 * 0.6 + 0.6 * 0.2, 6);

    const pts = [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.5 },
      { x: 0.6, y: 0.3 },
      { x: 0.8, y: 0.4 },
    ];
    const cubicPath = cubicSvgPathForPoints(pts, 595, 842);
    expect(cubicPath).toMatch(/^M 59\.50 168\.40 C .+ C .+ L 476\.00 336\.80$/);
  });

  it('tests hitTestItem for slur, bracket, and distant negative cases', () => {
    const slur = {
      kind: 'shape' as const,
      id: 'sh-slur',
      layerId: 'default',
      shapeType: 'slur' as const,
      start: { x: 0.2, y: 0.6 },
      end: { x: 0.6, y: 0.6 },
      control: { x: 0.4, y: 0.5 },
      color: '#d64545',
      width: 0.004,
    };
    expect(hitTestItem(slur, { x: 0.4, y: 0.55 })).toBe(true);
    expect(hitTestItem(slur, { x: 0.4, y: 0.72 })).toBe(false);

    const bracket = {
      kind: 'shape' as const,
      id: 'sh-bracket',
      layerId: 'default',
      shapeType: 'bracket' as const,
      start: { x: 0.1, y: 0.2 },
      end: { x: 0.12, y: 0.5 },
      color: '#141416',
      width: 0.004,
    };
    expect(hitTestItem(bracket, { x: 0.1, y: 0.35 })).toBe(true);
    expect(hitTestItem(bracket, { x: 0.4, y: 0.35 })).toBe(false);

    const text = {
      kind: 'text' as const,
      id: 'txt-1',
      layerId: 'default',
      position: { x: 0.3, y: 0.7 },
      text: 'Crescendo på stämma 2',
      fontSize: 0.023,
      color: '#141416',
    };
    expect(hitTestItem(text, { x: 0.34, y: 0.71 })).toBe(true);
    expect(hitTestItem(text, { x: 0.85, y: 0.9 })).toBe(false);
  });

  it('renders only visible layers and omits hidden-layer ExtGState on 3-page exportAnnotatedPdf', async () => {
    const pageAnnotations: PageAnnotations = {
      scoreId: 'score-layers',
      pageNum: 1,
      layers: [
        { id: 'bass', name: 'Basstämma', visible: true },
        { id: 'hidden-notes', name: 'Dolda anteckningar', visible: false },
      ],
      items: [
        {
          kind: 'text',
          id: 'txt-visible',
          layerId: 'bass',
          position: { x: 0.2, y: 0.3 },
          text: 'Synlig text',
          fontSize: 0.023,
          color: '#141416',
        },
        {
          kind: 'text',
          id: 'txt-hidden',
          layerId: 'hidden-notes',
          position: { x: 0.2, y: 0.5 },
          text: 'Dold text',
          fontSize: 0.023,
          color: '#d64545',
        },
      ],
      updatedAt: '2026-11-22T12:00:00.000Z',
    };

    const { container, rerender } = render(
      <AnnotationCanvas
        pageAnnotations={pageAnnotations}
        onChange={vi.fn()}
        toolState={createDefaultAnnotationToolState()}
        activeLayerId="bass"
        active={false}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />,
    );

    expect(container.textContent).toContain('Synlig text');
    expect(container.textContent).not.toContain('Dold text');

    rerender(
      <AnnotationCanvas
        pageAnnotations={pageAnnotations}
        onChange={vi.fn()}
        toolState={createDefaultAnnotationToolState()}
        activeLayerId="bass"
        active={false}
        showAllAnnotations={false}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />,
    );
    expect(container.textContent).not.toContain('Synlig text');

    // 3-page PDF export with hidden-only page 2
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const originalBytes = await doc.save();

    const exportedBytes = await exportAnnotatedPdf(originalBytes, [
      {
        scoreId: 'export-check',
        pageNum: 1,
        layers: [{ id: 'default', name: 'Bas', visible: true }],
        items: [
          {
            kind: 'stroke',
            id: 'hl-visible',
            layerId: 'default',
            tool: 'highlighter',
            points: [
              { x: 0.15, y: 0.4 },
              { x: 0.8, y: 0.4 },
            ],
            color: '#f7c948',
            width: 0.024,
            opacity: 0.45,
            multiply: true,
          },
        ],
        updatedAt: '2026-11-22T12:00:00.000Z',
      },
      {
        scoreId: 'export-check',
        pageNum: 2,
        layers: [{ id: 'secret', name: 'Dold', visible: false }],
        items: [
          {
            kind: 'stroke',
            id: 'hl-hidden-page2',
            layerId: 'secret',
            tool: 'highlighter',
            points: [
              { x: 0.2, y: 0.5 },
              { x: 0.7, y: 0.5 },
            ],
            color: '#38bdf8',
            width: 0.024,
            opacity: 0.45,
            multiply: true,
          },
        ],
        updatedAt: '2026-11-22T12:00:00.000Z',
      },
    ]);

    expect(new TextDecoder().decode(exportedBytes.slice(0, 5))).toBe('%PDF-');
    const reloaded = await PDFDocument.load(exportedBytes);
    expect(reloaded.getPageCount()).toBe(3);
    const page2ExtGState = reloaded
      .getPage(1)
      .node.Resources()
      ?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
    expect(page2ExtGState).toBeUndefined();
  });

  it('closes only StampPalette on Escape without bubbling to outer window Escape handlers', () => {
    const outerEscape = vi.fn();
    window.addEventListener('keydown', outerEscape);
    const onClose = vi.fn();

    render(
      <StampPalette
        open={true}
        language="sv"
        activeStamp="breath"
        onSelectStamp={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();

    window.removeEventListener('keydown', outerEscape);
  });

  it('blocks drawing when hidden, commits text on outside tap/exit, re-pinches, sanitizes colors, and resets undo on restoreEpoch', () => {
    const onChange = vi.fn();
    const onPinchPanStart = vi.fn();
    const onPinchPanEnd = vi.fn();

    // 1. Blocks drawing when showAllAnnotations is false
    const { container, rerender } = render(
      <AnnotationCanvas
        pageAnnotations={makeBasePageAnnotations()}
        onChange={onChange}
        toolState={createDefaultAnnotationToolState()}
        activeLayerId="default"
        active={true}
        showAllAnnotations={false}
        language="sv"
        pageWidth={500}
        pageHeight={707}
        onPinchPanStart={onPinchPanStart}
        onPinchPanEnd={onPinchPanEnd}
      />,
    );

    const root = container.querySelector('.notlasare-annotation-root')!;
    mockRect(root);
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 150, clientY: 100 });
    expect(onChange).not.toHaveBeenCalled();

    // 2. Re-pinch calls onPinchPanStart again when 2nd finger returns
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(root, { pointerId: 2, clientX: 200, clientY: 200 });
    expect(onPinchPanStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(root, { pointerId: 2, clientX: 200, clientY: 200 });
    expect(onPinchPanEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(root, { pointerId: 3, clientX: 220, clientY: 220 });
    expect(onPinchPanStart).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(root, { pointerId: 3, clientX: 220, clientY: 220 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 100, clientY: 100 });

    // 3. Sanitizes unsafe SVG colors
    rerender(
      <AnnotationCanvas
        pageAnnotations={{
          ...makeBasePageAnnotations(),
          items: [
            {
              kind: 'stroke',
              id: 'evil-stroke',
              layerId: 'default',
              tool: 'pen',
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.3, y: 0.4 },
              ],
              color: 'url(#evil)',
              width: 0.004,
              opacity: 1,
            },
          ],
        }}
        onChange={onChange}
        toolState={{ ...createDefaultAnnotationToolState(), tool: 'text' }}
        activeLayerId="default"
        active={true}
        showAllAnnotations={true}
        language="sv"
        pageWidth={500}
        pageHeight={707}
      />,
    );
    const pathEl = container.querySelector('path');
    expect(pathEl?.getAttribute('stroke')).toBe('#141416');

    // 4. Outside tap commits non-empty text
    fireEvent.pointerDown(root, { pointerId: 4, clientX: 100, clientY: 140 });
    fireEvent.pointerUp(root, { pointerId: 4, clientX: 100, clientY: 140 });
    fireEvent.change(screen.getByPlaceholderText('Skriv anteckning...'), {
      target: { value: 'Andas!' },
    });
    fireEvent.pointerDown(root, { pointerId: 5, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(root, { pointerId: 5, clientX: 300, clientY: 300 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const committed = onChange.mock.calls[0][0] as PageAnnotations;
    expect(committed.items.some((i) => i.kind === 'text' && i.text === 'Andas!')).toBe(true);

    // 5. useAnnotationSession clears past/future on restoreEpoch and localizes default layer
    function EpochHarness({ epoch }: { epoch: number }) {
      const [anns, setAnns] = useState<PageAnnotations>(makeBasePageAnnotations());
      const session = useAnnotationSession({
        pageAnnotations: anns,
        onCommit: setAnns,
        language: 'en',
        restoreEpoch: epoch,
      });
      return (
        <div>
          <span data-testid="layer-name">{session.layers[0].name}</span>
          <span data-testid="can-undo">{String(session.canUndo)}</span>
          <button type="button" onClick={() => session.addLayer('Extra')}>
            add
          </button>
        </div>
      );
    }

    const { rerender: rerenderEpoch } = render(<EpochHarness epoch={0} />);
    expect(screen.getByTestId('layer-name').textContent).toBe('Annotations');
    fireEvent.click(screen.getByText('add'));
    expect(screen.getByTestId('can-undo').textContent).toBe('true');

    rerenderEpoch(<EpochHarness epoch={1} />);
    expect(screen.getByTestId('can-undo').textContent).toBe('false');
  });
});
