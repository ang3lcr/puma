import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent, KeyboardEvent } from 'react';
import {
  PdfImportError,
  sanitizeText,
} from './features/documents/pdf-import-error';
import {
  type ImportedPdf,
  type PdfDocumentSession,
  type PasswordReason,
  type PdfImportProgress,
} from './features/documents/pdf-import-types';
import { ThumbnailList } from './features/pages/ThumbnailList';
import { PageViewer } from './features/pages/PageViewer';
import type { PageInfo } from './features/pages/PageViewer';
import { ByteLruCache } from './features/pages/thumbnail-cache';
import { es } from './i18n/es';
import { formatBytes, formatNumber } from './i18n/format';
import { PageRenderQueue } from './pdf/page-render-queue';

type Theme = 'dark' | 'light';
type DocumentRecord = Omit<ImportedPdf, 'session'>;

interface ImportFailure {
  fileName: string;
  message: string;
}

interface ImportProgressState extends PdfImportProgress {
  fileName: string;
}

interface PasswordRequest {
  fileName: string;
  reason: PasswordReason;
  resolve: (password: string | null) => void;
}

interface FullReadRequest {
  fileName: string;
  fileSize: number;
  resolve: (confirmed: boolean) => void;
}

interface ActivePdfSession {
  documentId: string;
  session: PdfDocumentSession;
}

function App() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePageNumber, setActivePageNumber] = useState(1);
  const [activePageInfo, setActivePageInfo] = useState<
    (PageInfo & { documentId: string; pageNumber: number }) | null
  >(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isOpeningDocument, setIsOpeningDocument] = useState(false);
  const [activePdfSession, setActivePdfSession] =
    useState<ActivePdfSession | null>(null);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [importFailures, setImportFailures] = useState<ImportFailure[]>([]);
  const [passwordRequest, setPasswordRequest] =
    useState<PasswordRequest | null>(null);
  const [fullReadRequest, setFullReadRequest] =
    useState<FullReadRequest | null>(null);
  const [password, setPassword] = useState('');
  const [thumbnailCache] = useState(
    () =>
      new ByteLruCache<string, ImageBitmap>(
        64 * 1024 * 1024,
        (bitmap) => bitmap.width * bitmap.height * 4,
        (bitmap) => bitmap.close(),
      ),
  );
  const [renderQueue] = useState(() => new PageRenderQueue());
  const renderQueueLifecycle = useRef({ active: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordDialogRef = useRef<HTMLDivElement>(null);
  const fullReadDialogRef = useRef<HTMLDivElement>(null);
  const importRunning = useRef(false);
  const isDark = theme === 'dark';
  const isLoadingDocument = isImporting || isOpeningDocument;
  const activeDocument = documents.find(
    (document) => document.id === activeDocumentId,
  );
  const activeSession =
    activePdfSession?.documentId === activeDocumentId
      ? activePdfSession.session
      : null;
  const currentPageInfo =
    activePageInfo?.documentId === activeDocumentId &&
    activePageInfo.pageNumber === activePageNumber
      ? activePageInfo
      : null;
  const totalPages = documents.reduce(
    (count, document) => count + document.pageCount,
    0,
  );
  const updatePageInfo = useCallback(
    (pageNumber: number, info: PageInfo): void => {
      if (activeDocumentId) {
        setActivePageInfo({
          ...info,
          documentId: activeDocumentId,
          pageNumber,
        });
      }
    },
    [activeDocumentId],
  );

  useEffect(() => {
    if (passwordRequest) {
      passwordInputRef.current?.focus();
    }
  }, [passwordRequest]);

  useEffect(() => {
    if (fullReadRequest) {
      fullReadDialogRef.current
        ?.querySelector<HTMLButtonElement>('button')
        ?.focus();
    }
  }, [fullReadRequest]);

  useEffect(() => {
    if (!activePdfSession) {
      return;
    }

    return () => {
      void activePdfSession.session.loadingTask
        .destroy()
        .catch((error: unknown) => {
          console.error('Unable to release the active PDF document.', error);
        });
    };
  }, [activePdfSession]);

  useEffect(() => {
    return () => thumbnailCache.clear();
  }, [thumbnailCache]);

  useEffect(() => {
    const lifecycle = renderQueueLifecycle.current;
    lifecycle.active = true;
    return () => {
      lifecycle.active = false;
      // StrictMode replays effect cleanup/setup; defer disposal until that replay settles.
      queueMicrotask(() => {
        if (!lifecycle.active) {
          renderQueue.dispose();
        }
      });
    };
  }, [renderQueue]);

  function requestDocumentPassword(
    fileName: string,
    reason: PasswordReason,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      setPasswordRequest({ fileName, reason, resolve });
      setPassword('');
    });
  }

  function requestFullReadConfirmation(
    fileName: string,
    fileSize: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      setFullReadRequest({ fileName, fileSize, resolve });
    });
  }

  async function importFiles(files: File[]): Promise<void> {
    if (files.length === 0 || importRunning.current) {
      return;
    }

    importRunning.current = true;
    setIsImporting(true);
    setImportFailures([]);

    const failures: ImportFailure[] = [];
    for (const file of files) {
      const fileName = safeFileName(file.name);
      setProgress({
        fileName,
        loaded: 0,
        total: file.size,
        percent: 0,
      });

      try {
        const { importPdfFile } = await import(
          './features/documents/pdf-import'
        );
        const imported = await importPdfFile(file, {
          requestPassword: (reason) =>
            requestDocumentPassword(fileName, reason),
          confirmFullRead: (fileSize) =>
            requestFullReadConfirmation(fileName, fileSize),
          onProgress: (nextProgress) => {
            setProgress({ fileName, ...nextProgress });
          },
        });

        const { session, ...documentRecord } = imported;
        setDocuments((currentDocuments) => [
          ...currentDocuments,
          documentRecord,
        ]);
        setActiveDocumentId(documentRecord.id);
        setActivePageNumber(1);
        setActivePdfSession({ documentId: documentRecord.id, session });
      } catch (error) {
        failures.push({
          fileName,
          message: getImportFailureMessage(error),
        });
        setImportFailures([...failures]);
      }
    }

    importRunning.current = false;
    setIsImporting(false);
    setProgress(null);
  }

  async function selectDocument(document: DocumentRecord): Promise<void> {
    if (
      isLoadingDocument ||
      importRunning.current ||
      activePdfSession?.documentId === document.id
    ) {
      return;
    }

    setIsOpeningDocument(true);
    setImportFailures([]);
    setProgress({
      fileName: document.fileName,
      loaded: 0,
      total: document.size,
      percent: 0,
    });

    try {
      const { openPdfDocument } = await import(
        './features/documents/pdf-import'
      );
      const session = await openPdfDocument(document.file, {
        requestPassword: (reason) =>
          requestDocumentPassword(document.fileName, reason),
        confirmFullRead: (fileSize) =>
          requestFullReadConfirmation(document.fileName, fileSize),
        onProgress: (nextProgress) => {
          setProgress({ fileName: document.fileName, ...nextProgress });
        },
      });

      setActiveDocumentId(document.id);
      setActivePageNumber(1);
      setActivePdfSession({ documentId: document.id, session });
    } catch (error) {
      setImportFailures([
        {
          fileName: document.fileName,
          message: getImportFailureMessage(error),
        },
      ]);
    } finally {
      setIsOpeningDocument(false);
      setProgress(null);
    }
  }

  function handleFileInputChange(
    event: FormEvent<HTMLInputElement>,
  ): void {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void importFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!isLoadingDocument) {
      void importFiles(Array.from(event.dataTransfer.files));
    }
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const request = passwordRequest;
    if (!request) {
      return;
    }

    setPasswordRequest(null);
    request.resolve(password);
    setPassword('');
  }

  function cancelPasswordRequest(): void {
    const request = passwordRequest;
    if (!request) {
      return;
    }

    setPasswordRequest(null);
    request.resolve(null);
    setPassword('');
  }

  function resolveFullReadRequest(confirmed: boolean): void {
    const request = fullReadRequest;
    if (!request) {
      return;
    }

    setFullReadRequest(null);
    request.resolve(confirmed);
  }

  function handlePasswordDialogKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelPasswordRequest();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = passwordDialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      first &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && last && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleFullReadDialogKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      resolveFullReadRequest(false);
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = fullReadDialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      first &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && last && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const metadataRows = activeDocument
    ? [
        [es.properties.fileName, activeDocument.fileName],
        [es.properties.fileSize, formatBytes(activeDocument.size)],
        [es.properties.pageCount, formatNumber(activeDocument.pageCount)],
        [es.properties.pdfVersion, activeDocument.metadata.pdfVersion],
        [es.properties.title, activeDocument.metadata.title],
        [es.properties.author, activeDocument.metadata.author],
        [es.properties.subject, activeDocument.metadata.subject],
        [es.properties.creator, activeDocument.metadata.creator],
        [es.properties.producer, activeDocument.metadata.producer],
        [es.properties.creationDate, activeDocument.metadata.creationDate],
        [
          es.properties.modificationDate,
          activeDocument.metadata.modificationDate,
        ],
        [
          es.properties.encrypted,
          activeDocument.metadata.encrypted
            ? es.properties.present
            : es.properties.absent,
        ],
        [
          es.properties.forms,
          activeDocument.metadata.hasForms
            ? es.properties.present
            : es.properties.absent,
        ],
        [
          es.properties.signatures,
          activeDocument.metadata.hasSignatures
            ? es.properties.present
            : es.properties.absent,
        ],
      ] as const
    : [];

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
                {formatNumber(documents.length)}
              </span>
            </div>
            <p className="panel-caption">
              {formatNumber(documents.length)} {es.documents.countLabel}
            </p>
            {documents.length === 0 ? (
              <div className="document-empty">
                <span className="empty-mark" aria-hidden="true">
                  —
                </span>
                <p>{es.documents.emptyState}</p>
              </div>
            ) : (
              <ul className="document-list">
                {documents.map((document) => (
                  <li key={document.id}>
                    <button
                      className="document-list-item"
                      type="button"
                      aria-pressed={document.id === activeDocumentId}
                      disabled={isLoadingDocument}
                      onClick={() => void selectDocument(document)}
                    >
                      <span className="document-list-name">
                        {document.fileName}
                      </span>
                      <span className="document-list-pages">
                        {formatNumber(document.pageCount)}{' '}
                        {es.documents.pageCountLabel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="thumbnail-section" aria-labelledby="pages-heading">
            <div className="panel-title-row">
              <h2 id="pages-heading">{es.documents.pagesHeading}</h2>
            </div>
            {activeDocument && activeSession ? (
              <ThumbnailList
                key={activeDocument.id}
                cache={thumbnailCache}
                document={activeSession.document}
                documentId={activeDocument.id}
                pageCount={activeDocument.pageCount}
                selectedPageNumber={activePageNumber}
                onSelectPage={setActivePageNumber}
                renderQueue={renderQueue}
              />
            ) : (
              <p className="thumbnail-empty">
                {activeDocument
                  ? es.documents.reopening
                  : es.documents.emptyPages}
              </p>
            )}
          </section>
        </aside>

        <main
          id="workspace"
          className="workspace"
          aria-labelledby="workspace-heading"
          tabIndex={-1}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            aria-label={es.documents.importButton}
            disabled={isLoadingDocument}
            onChange={handleFileInputChange}
          />
          <div className="workspace-header">
            <div>
              <p className="eyebrow">{es.workspace.eyebrow}</p>
              <h1 id="workspace-heading">{es.workspace.heading}</h1>
            </div>
            <span className="document-state">
              <span className="state-dot" aria-hidden="true" />
              {activeDocument
                ? es.workspace.activeDocument
                : isLoadingDocument
                  ? es.workspace.importing
                  : es.workspace.pending}
            </span>
          </div>

          {isLoadingDocument && progress && (
            <div className="import-progress workspace-progress" aria-live="polite">
              <p>
                {es.workspace.loading}: {progress.fileName}
              </p>
              <progress
                aria-label={es.workspace.importProgress}
                max={100}
                value={progress.percent}
              />
            </div>
          )}

          {importFailures.length > 0 && (
            <ul className="import-errors workspace-errors" role="alert">
              {importFailures.map((failure, index) => (
                <li key={`${failure.fileName}-${index}`}>
                  <strong>{failure.fileName}:</strong> {failure.message}
                </li>
              ))}
            </ul>
          )}

          <section
            className={`canvas-stage${isLoadingDocument ? ' is-importing' : ''}`}
            aria-label={es.workspace.landmark}
          >
            {activeDocument && activeSession ? (
              <PageViewer
                key={activeDocument.id}
                document={activeSession.document}
                pageNumber={activePageNumber}
                pageCount={activeDocument.pageCount}
                onPageChange={setActivePageNumber}
                onPageInfo={updatePageInfo}
                onImport={() => fileInputRef.current?.click()}
                importDisabled={isLoadingDocument}
                renderQueue={renderQueue}
              />
            ) : (
              <div className="empty-document">
                <div className="document-glyph" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <h2>
                  {activeDocument
                    ? activeDocument.fileName
                    : es.workspace.emptyHeading}
                </h2>
                <p>
                  {activeDocument
                    ? es.documents.reopening
                    : es.workspace.emptyDescription}
                </p>
                {!activeDocument && (
                  <div className="import-controls">
                    <button
                      className="import-button"
                      type="button"
                      disabled={isLoadingDocument}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {es.documents.importButton}
                    </button>
                    <p className="import-hint">
                      {es.documents.importDescription}
                    </p>
                  </div>
                )}
                <p className="stage-note">{es.documents.sourceNote}</p>
              </div>
            )}
          </section>
        </main>

        <aside className="properties-panel" aria-labelledby="properties-heading">
          <div className="properties-header">
            <p className="eyebrow">{es.app.localSession}</p>
            <h2 id="properties-heading">{es.properties.heading}</h2>
          </div>
          {activeDocument ? (
            <div className="document-properties">
              <h3>{es.properties.documentHeading}</h3>
              <dl>
                {metadataRows.map(([label, value]) => (
                  <div className="metadata-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              {currentPageInfo && (
                <section className="page-properties">
                  <h3>{es.properties.pageHeading}</h3>
                  <dl>
                    <div className="metadata-row">
                      <dt>{es.properties.currentPage}</dt>
                      <dd>
                        {formatNumber(currentPageInfo.pageNumber)} /{' '}
                        {formatNumber(activeDocument.pageCount)}
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>{es.properties.pageDimensions}</dt>
                      <dd>
                        {formatNumber(currentPageInfo.widthMillimeters, {
                          maximumFractionDigits: 1,
                        })}{' '}
                        ×{' '}
                        {formatNumber(currentPageInfo.heightMillimeters, {
                          maximumFractionDigits: 1,
                        })}{' '}
                        mm
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>{es.properties.pageRotation}</dt>
                      <dd>{formatNumber(currentPageInfo.rotation)}°</dd>
                    </div>
                  </dl>
                </section>
              )}
            </div>
          ) : (
            <div className="properties-empty">
              <span className="selection-mark" aria-hidden="true">
                ◇
              </span>
              <h3>{es.properties.emptyState}</h3>
              <p>{es.properties.description}</p>
            </div>
          )}
        </aside>
      </div>

      <footer
        className="statusbar"
        role="status"
        aria-live="polite"
        title={es.status.sessionOnly}
      >
        <span className="status-ready">
          <span className="status-dot" aria-hidden="true" />
          {isLoadingDocument ? es.status.loading : es.status.ready}
        </span>
        <span className="status-item">
          {formatNumber(documents.length)} {es.documents.countLabel}
        </span>
        <span className="status-item">
          {formatNumber(totalPages)} {es.documents.pageCountLabel}
        </span>
        <span className="status-spacer" />
        <span className="status-item status-local">{es.status.localOnly}</span>
      </footer>

      {passwordRequest && (
        <div className="modal-backdrop">
          <div
            ref={passwordDialogRef}
            className="password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-title"
            onKeyDown={handlePasswordDialogKeyDown}
          >
            <h2 id="password-title">{es.password.title}</h2>
            <p>
              {es.password.description.replace(
                '{fileName}',
                passwordRequest.fileName,
              )}
            </p>
            {passwordRequest.reason === 'incorrect' && (
              <p className="password-error" role="alert">
                {es.password.incorrect}
              </p>
            )}
            <form onSubmit={handlePasswordSubmit}>
              <label htmlFor="pdf-password">{es.password.label}</label>
              <input
                ref={passwordInputRef}
                id="pdf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <div className="password-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={cancelPasswordRequest}
                >
                  {es.password.cancel}
                </button>
                <button className="import-button" type="submit">
                  {es.password.submit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {fullReadRequest && (
        <div className="modal-backdrop">
          <div
            ref={fullReadDialogRef}
            className="password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="full-read-title"
            onKeyDown={handleFullReadDialogKeyDown}
          >
            <h2 id="full-read-title">{es.fullRead.title}</h2>
            <p>
              {es.fullRead.description
                .replace('{fileName}', fullReadRequest.fileName)
                .replace('{fileSize}', formatBytes(fullReadRequest.fileSize))}
            </p>
            <div className="password-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => resolveFullReadRequest(false)}
              >
                {es.fullRead.cancel}
              </button>
              <button
                className="import-button"
                type="button"
                onClick={() => resolveFullReadRequest(true)}
              >
                {es.fullRead.continue}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function safeFileName(fileName: string): string {
  return sanitizeText(fileName, 255) ?? 'documento.pdf';
}

function getImportFailureMessage(error: unknown): string {
  if (!(error instanceof PdfImportError)) {
    return es.documents.errors.readFailed;
  }

  switch (error.code) {
    case 'empty-file':
      return es.documents.errors.emptyFile;
    case 'not-pdf':
      return es.documents.errors.notPdf;
    case 'invalid-pdf':
      return es.documents.errors.invalidPdf;
    case 'password-required':
      return es.documents.errors.passwordRequired;
    case 'password-incorrect':
      return es.documents.errors.passwordIncorrect;
    case 'password-cancelled':
      return es.documents.errors.passwordCancelled;
    case 'full-read-cancelled':
      return es.documents.errors.fullReadCancelled;
    case 'read-failed':
      return es.documents.errors.readFailed;
  }
}

export default App;
