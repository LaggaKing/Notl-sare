import './annotations.css';

export {
  AnnotationCanvas,
  type AnnotationCanvasProps,
  type PinchPanPointer,
} from './AnnotationCanvas';

export {
  AnnotationToolbar,
  type AnnotationToolbarProps,
} from './AnnotationToolbar';

export {
  StampPalette,
  StampGlyph,
  renderStampPrimitives,
  type StampPaletteProps,
  type StampGlyphProps,
} from './StampPalette';

export {
  useAnnotationSession,
  type UseAnnotationSessionOptions,
  type AnnotationSession,
} from './useAnnotationSession';

export {
  ANNOTATION_I18N,
  getAnnotationTranslations,
  type AnnotationTool,
  type StrokeSizePreset,
  type AnnotationTranslations,
} from './i18n';

export {
  STAMP_CATEGORIES,
  STAMP_DEFINITIONS,
  STAMP_LIST,
  getStampDefinition,
  getStampsByCategory,
  circlePrimitiveToPath,
  type StampCategory,
  type StampPrimitive,
  type StampDefinition,
} from './stamps';

export {
  DEFAULT_PAGE_ASPECT,
  HIGHLIGHTER_COLOR_PRESETS,
  HIGHLIGHTER_WIDTH_PRESETS,
  PEN_COLOR_PRESETS,
  PEN_WIDTH_PRESETS,
  STAMP_COLOR_PRESETS,
  STAMP_SCALE_PRESETS,
  TEXT_SIZE_PRESETS,
  createDefaultAnnotationToolState,
  clamp01,
  createAnnotationId,
  smoothStrokePoints,
  svgPathForPoints,
  cubicSvgPathForPoints,
  computeDefaultSlurControl,
  computeBracketPoints,
  hitTestItem,
  computeItemBounds,
  translateAnnotationItem,
  type AnnotationToolState,
  type NormalizedBounds,
} from './geometry';
