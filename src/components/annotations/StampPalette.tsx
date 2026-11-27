import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import './annotations.css';
import type { AppLanguage, StampType } from '../../types';
import { getAnnotationTranslations } from './i18n';
import {
  STAMP_CATEGORIES,
  getStampDefinition,
  getStampsByCategory,
  type StampCategory,
  type StampPrimitive,
} from './stamps';

export interface StampGlyphProps {
  stampType: StampType;
  color?: string;
  className?: string;
}

export function renderStampPrimitives(primitives: StampPrimitive[]): React.ReactNode {
  return primitives.map((prim, idx) => {
    if (prim.kind === 'path') {
      return (
        <path
          key={idx}
          d={prim.d}
          fill={prim.fill ?? 'none'}
          stroke={prim.stroke ?? 'none'}
          strokeWidth={prim.strokeWidth}
          strokeLinecap={prim.strokeLinecap}
          strokeLinejoin={prim.strokeLinejoin}
          fillRule={prim.fillRule}
        />
      );
    }
    if (prim.kind === 'circle') {
      return (
        <circle
          key={idx}
          cx={prim.cx}
          cy={prim.cy}
          r={prim.r}
          fill={prim.fill ?? 'none'}
          stroke={prim.stroke ?? 'none'}
          strokeWidth={prim.strokeWidth}
        />
      );
    }
    return (
      <text
        key={idx}
        x={prim.x}
        y={prim.y}
        fill="currentColor"
        fontSize={prim.fontSize}
        fontWeight={prim.fontWeight ?? 'bold'}
        fontStyle={prim.fontStyle ?? 'normal'}
        fontFamily={
          prim.fontFamily === 'serif'
            ? 'Georgia, "Times New Roman", Times, serif'
            : 'var(--font-sans, "Segoe UI", sans-serif)'
        }
        textAnchor={prim.textAnchor ?? 'middle'}
        dominantBaseline="alphabetic"
      >
        {prim.text}
      </text>
    );
  });
}

export const StampGlyph: React.FC<StampGlyphProps> = ({
  stampType,
  color = 'currentColor',
  className,
}) => {
  const def = getStampDefinition(stampType);
  return (
    <svg
      viewBox={def.viewBox}
      className={className}
      style={{ color, width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {renderStampPrimitives(def.primitives)}
    </svg>
  );
};

export interface StampPaletteProps {
  open: boolean;
  language: AppLanguage;
  activeStamp: StampType;
  activeColor?: string;
  onSelectStamp: (stampType: StampType) => void;
  onClose: () => void;
}

export const StampPalette: React.FC<StampPaletteProps> = ({
  open,
  language,
  activeStamp,
  activeColor,
  onSelectStamp,
  onClose,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | StampCategory>('all');
  const t = getAnnotationTranslations(language);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const categoriesToDisplay: StampCategory[] =
    selectedCategory === 'all' ? [...STAMP_CATEGORIES] : [selectedCategory];

  return (
    <div
      className="notl-sare-stamp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.actions.chooseStamp}
      onClick={onClose}
    >
      <div
        className="notl-sare-stamp-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="notl-sare-stamp-sheet-header">
          <h2 className="notl-sare-stamp-sheet-title">{t.actions.chooseStamp}</h2>
          <button
            type="button"
            className="notl-sare-tool-btn"
            onClick={onClose}
            aria-label={t.actions.close}
            title={t.actions.close}
          >
            <X size={20} />
          </button>
        </div>

        <div className="notl-sare-stamp-tabs" role="tablist" aria-label={t.actions.stamps}>
          {(['all', ...STAMP_CATEGORIES] as const).map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`notl-sare-stamp-tab ${isActive ? 'notl-sare-stamp-tab--active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {t.stampCategories[cat]}
              </button>
            );
          })}
        </div>

        <div className="notl-sare-stamp-grid-scroll">
          {categoriesToDisplay.map((category) => {
            const stamps = getStampsByCategory(category);
            return (
              <section key={category} aria-label={t.stampCategories[category]}>
                <h3 className="notl-sare-stamp-category-title">
                  {t.stampCategories[category]}
                </h3>
                <div className="notl-sare-stamp-grid">
                  {stamps.map((def) => {
                    const isSelected = def.type === activeStamp;
                    const label = t.stamps[def.type];
                    return (
                      <button
                        key={def.type}
                        type="button"
                        className={`notl-sare-stamp-card ${isSelected ? 'notl-sare-stamp-card--active' : ''}`}
                        onClick={() => {
                          onSelectStamp(def.type);
                          onClose();
                        }}
                        aria-pressed={isSelected}
                        aria-label={label}
                      >
                        <span className="notl-sare-stamp-card-glyph">
                          <StampGlyph
                            stampType={def.type}
                            color={
                              activeColor && activeColor !== '#141416'
                                ? activeColor
                                : 'var(--text-primary)'
                            }
                          />
                        </span>
                        <span className="notl-sare-stamp-card-name">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
