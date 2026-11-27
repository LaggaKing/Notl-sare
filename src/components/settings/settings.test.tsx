import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../types';
import { I18nProvider } from '../../i18n';
import * as tauriApi from '../../services/tauriApi';
import { SettingsModal } from './index';

describe('SettingsModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('switches language, steps A4 pitch, toggles paper tint/wake lock, and handles backup/restore', async () => {
    const onUpdateSettings = vi.fn();
    const onClose = vi.fn();
    const onBackupRestored = vi.fn();

    vi.spyOn(tauriApi, 'exportBackupJson').mockResolvedValue('{"version":1}');
    vi.spyOn(tauriApi, 'saveTextFileWithDialog').mockResolvedValue(true);
    vi.spyOn(tauriApi, 'openTextFileWithDialog').mockResolvedValue('{"version":1}');
    vi.spyOn(tauriApi, 'importBackupJson').mockResolvedValue({
      scoresUpdated: 2,
      annotationsRestored: 4,
    });

    render(
      <I18nProvider language="sv">
        <SettingsModal
          open={true}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={onUpdateSettings}
          onClose={onClose}
          onBackupRestored={onBackupRestored}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Inställningar')).toBeTruthy();

    // Language switch
    fireEvent.click(screen.getByText('Engelska'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ language: 'en' });

    // Reference pitch +1 Hz
    fireEvent.click(screen.getByLabelText('Höj referenston'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ referencePitchHz: 441 });

    // Night paper tint
    fireEvent.click(screen.getByText('Nattläge'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ paperTint: 'night' });

    // Wake lock toggle
    fireEvent.click(screen.getByText('Skärmlås (håll vaken)'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ wakeLockEnabled: false });

    // Backup export & restore
    await act(async () => {
      fireEvent.click(screen.getByText('Säkerhetskopiera anteckningar'));
    });
    expect(screen.getByText('Säkerhetskopia sparad.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Återställ anteckningar'));
    });
    expect(onBackupRestored).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Återställde 2 stycken och 4 anteckningssidor.'),
    ).toBeTruthy();

    // Close modal via close button, backdrop, and Escape
    fireEvent.click(screen.getByLabelText('Stäng'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('shows localized error message when backup import fails validation', async () => {
    vi.spyOn(tauriApi, 'openTextFileWithDialog').mockResolvedValue('{"invalid":true}');
    vi.spyOn(tauriApi, 'importBackupJson').mockRejectedValue(new Error('Invalid backup'));

    render(
      <I18nProvider language="sv">
        <SettingsModal
          open={true}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Återställ anteckningar'));
    });
    expect(screen.getByText('Kunde inte slutföra säkerhetskopieringen.')).toBeTruthy();
  });
});
