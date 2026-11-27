import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getTranslations } from './i18n';
import './styles/tokens.css';
import './styles/global.css';

const initialLang =
  typeof navigator !== 'undefined' &&
  navigator.language.toLowerCase().startsWith('en')
    ? 'en'
    : 'sv';
const errorStrings = getTranslations(initialLang).errors;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      fallbackTitle={errorStrings.unexpectedCrashTitle}
      fallbackBody={errorStrings.unexpectedCrashBody}
      actionLabel={errorStrings.reloadApp}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
