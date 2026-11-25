import { useState } from 'react';
import { es } from './i18n/es';
import { formatNumber } from './i18n/format';

type Theme = 'dark' | 'light';

function App() {
  const [theme, setTheme] = useState<Theme>('dark');
  const isDark = theme === 'dark';

  return (
    <div className="app-shell" data-theme={theme}>
      <a className="skip-link" href="#workspace">
        {es.accessibility.skipToWorkspace}
      </a>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span className="brand-name">{es.app.name}</span>
          <span className="session-badge">{es.app.localSession}</span>
        </div>

        <div className="topbar-actions">
          <span className="local-indicator">
            <span className="status-dot" aria-hidden="true" />
            {es.header.localProcessing}
          </span>
          <button
            className="theme-toggle"
            type="button"
            aria-label={
              isDark
                ? es.header.switchToLightTheme
                : es.header.switchToDarkTheme
            }
            aria-pressed={!isDark}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            <span className="theme-icon" aria-hidden="true">
              {isDark ? '☼' : '◐'}
            </span>
            <span>
              {isDark ? es.header.lightTheme : es.header.darkTheme}
            </span>
          </button>
        </div>
      </header>

      <div className="workbench">
        <aside className="document-panel" aria-labelledby="documents-heading">
          <section className="document-section">
            <div className="panel-title-row">
              <h2 id="documents-heading">{es.documents.heading}</h2>
              <span className="count-badge" aria-hidden="true">
                {formatNumber(0)}
              </span>
            </div>
            <p className="panel-caption">
              {formatNumber(0)} {es.documents.countLabel}
            </p>
            <div className="document-empty">
              <span className="empty-mark" aria-hidden="true">
                —
              </span>
              <p>{es.documents.emptyState}</p>
            </div>
          </section>

          <section className="thumbnail-section" aria-labelledby="pages-heading">
            <div className="panel-title-row">
              <h2 id="pages-heading">{es.documents.pagesHeading}</h2>
            </div>
            <p className="thumbnail-empty">{es.documents.emptyPages}</p>
          </section>
        </aside>

        <main
          id="workspace"
          className="workspace"
          aria-labelledby="workspace-heading"
          tabIndex={-1}
        >
          <div className="workspace-header">
            <div>
              <p className="eyebrow">{es.workspace.eyebrow}</p>
              <h1 id="workspace-heading">{es.workspace.heading}</h1>
            </div>
            <span className="document-state">
              <span className="state-dot" aria-hidden="true" />
              {es.workspace.pending}
            </span>
          </div>

          <section
            className="canvas-stage"
            aria-label={es.workspace.landmark}
          >
            <div className="empty-document">
              <div className="document-glyph" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2>{es.workspace.emptyHeading}</h2>
              <p>{es.workspace.emptyDescription}</p>
              <p className="stage-note">{es.workspace.nextStage}</p>
            </div>
          </section>
        </main>

        <aside className="properties-panel" aria-labelledby="properties-heading">
          <div className="properties-header">
            <p className="eyebrow">{es.app.localSession}</p>
            <h2 id="properties-heading">{es.properties.heading}</h2>
          </div>
          <div className="properties-empty">
            <span className="selection-mark" aria-hidden="true">
              ◇
            </span>
            <h3>{es.properties.emptyState}</h3>
            <p>{es.properties.description}</p>
          </div>
        </aside>
      </div>

      <footer className="statusbar" role="status" aria-live="polite">
        <span className="status-ready">
          <span className="status-dot" aria-hidden="true" />
          {es.status.ready}
        </span>
        <span className="status-item">
          {formatNumber(0)} {es.documents.countLabel}
        </span>
        <span className="status-item">
          {formatNumber(0)} {es.documents.pageCountLabel}
        </span>
        <span className="status-spacer" />
        <span className="status-item status-local">{es.status.localOnly}</span>
      </footer>
    </div>
  );
}

export default App;
