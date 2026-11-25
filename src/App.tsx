import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DragEvent, FormEvent, KeyboardEvent } from 'react';
import {
  PdfImportError,
  sanitizeText,
} from './features/documents/pdf-import-error';
import {
  type PdfDocumentSession,
  type PasswordReason,
  type PdfImportProgress,
} from './features/documents/pdf-import-types';
import { ThumbnailList } from './features/pages/ThumbnailList';
import { PageViewer } from './features/pages/PageViewer';
import type { PageInfo } from './features/pages/PageViewer';
import { MarginEditor } from './features/margins/MarginEditor';
import type { PdfBox } from './features/margins/types';
import {
  estimatePdfExportMemory,
  planPdfExportParts,
  PdfExportError,
  type PdfExportErrorCode,
  type PdfExportProgress,
  type PdfExportStage,
} from './features/export/pdf-export-common';
import { ByteLruCache } from './features/pages/thumbnail-cache';
import {
  getBlankPageReasonLabel,
  getBlankPageStatusLabel,
} from './features/blank-detection/presentation';
import type { BlankPageReviewDecision } from './features/blank-detection/types';
import {
  getOrientationReasonLabel,
  getOrientationStatusLabel,
} from './features/orientation/presentation';
import { es } from './i18n/es';
import { formatBytes, formatNumber } from './i18n/format';
import { PageRenderQueue } from './pdf/page-render-queue';
import {
  estimateLocalStorage,
  isStorageQuotaError,
  loadSavedProject,
  saveProjectHistory,
  type StorageEstimate,
} from './storage/project-persistence';
import {
  createDeletePageCommand,
  createDuplicatePageCommand,
  createMovePageCommand,
  createProjectHistoryState,
  createRestorePageCommand,
  createRotatePageCommand,
  createSetPageCropBoxCommand,
  createSetPageRotationsCommand,
  createSetBlankReviewDecisionCommand,
  getOrderedProjectDocuments,
  getOrderedProjectPages,
  type ProjectHistoryAction,
  projectHistoryReducer,
  type ProjectDocument,
} from './store/project-store';

type Theme = 'dark' | 'light';

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

interface BlankScanState {
  documentId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  completed: number;
  total: number;
}

interface OrientationScanState {
  documentId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  completed: number;
  total: number;
}

type PdfExportUiStage =
  | PdfExportStage
  | 'preparing'
  | 'cancelling'
  | 'complete'
  | 'cancelled'
  | 'failed';

interface PdfExportUiState {
  stage: PdfExportUiStage;
  current: number;
  total: number;
  errorCode: PdfExportErrorCode | null;
  completedParts?: number;
  totalParts?: number;
  partIndex?: number;
  partCount?: number;
}

type PersistenceStatus = 'loading' | 'pending' | 'saving' | 'saved' | 'error';

function App() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [maxPagesPerPart, setMaxPagesPerPart] = useState(1000);
  const [hydrationGate] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  const [projectHistory, dispatchProjectAction] = useReducer(
    projectHistoryReducer,
    undefined,
    createProjectHistoryState,
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>('loading');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [storageEstimate, setStorageEstimate] =
    useState<StorageEstimate | null>(null);
  const [storageEstimateFailed, setStorageEstimateFailed] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);
  const documents = getOrderedProjectDocuments(projectHistory.project);
  const projectPages = getOrderedProjectPages(projectHistory.project);
  const activeProjectPages = projectPages.filter((page) => !page.isDeleted);
  const exportEstimate = estimatePdfExportMemory(documents, activeProjectPages);
  const exportPartPlan = (() => {
    try {
      return planPdfExportParts(documents, activeProjectPages, maxPagesPerPart);
    } catch {
      return [];
    }
  })();
  const exportSources = new Map(
    documents.map((document) => [document.id, document]),
  );
  const exportPreflightError: PdfExportErrorCode | null =
    activeProjectPages.length === 0
      ? 'no-pages'
      : activeProjectPages.some(
            (page) => !exportSources.has(page.documentId),
          )
        ? 'invalid-project'
        : activeProjectPages.some(
              (page) => !exportSources.get(page.documentId)?.file,
            )
          ? 'missing-source'
          : activeProjectPages.some(
                (page) => exportSources.get(page.documentId)?.metadata.encrypted,
              )
            ? 'encrypted-source'
              : null;
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activePageInfo, setActivePageInfo] = useState<
    (PageInfo & { pageId: string }) | null
  >(null);
  const [blankScan, setBlankScan] = useState<BlankScanState | null>(null);
  const [orientationScan, setOrientationScan] =
    useState<OrientationScanState | null>(null);
  const [pdfExportState, setPdfExportState] =
    useState<PdfExportUiState | null>(null);
  const isPdfExportRunning =
    pdfExportState !== null &&
    !['complete', 'cancelled', 'failed'].includes(pdfExportState.stage);
  const [selectedOrientationPageIds, setSelectedOrientationPageIds] =
    useState<ReadonlySet<string>>(() => new Set());
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
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordDialogRef = useRef<HTMLDivElement>(null);
  const fullReadDialogRef = useRef<HTMLDivElement>(null);
  const importRunning = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const persistenceAvailable = useRef(false);
  const dispatchProject = useCallback((action: ProjectHistoryAction): void => {
    dispatchProjectAction(action);
    if (action.type !== 'restore-history' && persistenceAvailable.current) {
      saveRevision.current += 1;
      setPersistenceStatus('pending');
      setPersistenceError(null);
    }
  }, []);
  const blankScanAbort = useRef<AbortController | null>(null);
  const orientationScanAbort = useRef<AbortController | null>(null);
  const pdfExportAbort = useRef<AbortController | null>(null);
  const isDark = theme === 'dark';
  const isLoadingDocument = isImporting || isOpeningDocument || isRelinking;
  const documentsNeedingRelink = documents.filter(
    (document) => document.file === null,
  );
  const activeDocument = documents.find(
    (document) => document.id === activeDocumentId,
  );
  const documentPages = projectPages.filter(
    (page) => page.documentId === activeDocumentId,
  );
  const activeDocumentPages = documentPages.filter((page) => !page.isDeleted);
  const selectedPageId = activeDocumentPages.some(
    (page) => page.id === activePageId,
  )
    ? activePageId
    : (activeDocumentPages[0]?.id ?? null);
  const activePageIndex = activeDocumentPages.findIndex(
    (page) => page.id === selectedPageId,
  );
  const activePageNumber = activePageIndex + 1;
  const currentProjectPage =
    activePageIndex >= 0 ? activeDocumentPages[activePageIndex] : null;
  const sequencePageNumber =
    activeProjectPages.findIndex((page) => page.id === currentProjectPage?.id) +
    1;
  const activeSession =
    activePdfSession?.documentId === activeDocumentId
      ? activePdfSession.session
      : null;
  const isBlankScanRunning =
    blankScan?.documentId === activeDocumentId && blankScan.status === 'running';
  const isOrientationScanRunning =
    orientationScan?.documentId === activeDocumentId &&
    orientationScan.status === 'running';
  const isPageAnalysisRunning =
    isBlankScanRunning || isOrientationScanRunning;
  const selectedOrientationPages = activeDocumentPages.filter((page) =>
    selectedOrientationPageIds.has(page.id),
  );
  const pendingOrientationSuggestions = activeDocumentPages.filter(
    (page) =>
      page.orientationAnalysis?.status === 'suggestion' &&
      page.orientationAnalysis.targetRotationDeltaDegrees !==
        page.rotationDeltaDegrees,
  );
  const currentPageInfo =
    activePageInfo?.pageId === currentProjectPage?.id ? activePageInfo : null;
  const totalPages = activeProjectPages.length;
  const updatePageInfo = useCallback(
    (pageId: string, info: PageInfo): void => {
      setActivePageInfo({ ...info, pageId });
    },
    [],
  );

  const saveProjectNow = useCallback(
    async (history: typeof projectHistory): Promise<void> => {
      if (!persistenceEnabled) {
        return;
      }

      const revision = ++saveRevision.current;
      setPersistenceStatus('saving');
      setPersistenceError(null);
      const queuedSave = saveQueue.current.then(() =>
        saveProjectHistory(history),
      );
      saveQueue.current = queuedSave.then(
        () => undefined,
        () => undefined,
      );

      try {
        const nextSavedAt = await queuedSave;
        if (revision === saveRevision.current) {
          setSavedAt(nextSavedAt);
          setPersistenceStatus('saved');
        }
        try {
          setStorageEstimate(await estimateLocalStorage());
          setStorageEstimateFailed(false);
        } catch (error) {
          console.error('Unable to estimate local storage usage.', error);
          setStorageEstimateFailed(true);
        }
      } catch (error) {
        console.error('Unable to save the local project.', error);
        if (revision === saveRevision.current) {
          setPersistenceStatus('error');
          setPersistenceError(
            isStorageQuotaError(error)
              ? es.persistence.quotaExceeded
              : es.persistence.saveFailed,
          );
        }
      }
    },
    [persistenceEnabled],
  );

  useEffect(() => {
    let cancelled = false;
    async function restoreLocalProject(): Promise<void> {
      try {
        const savedProject = await loadSavedProject();
        if (cancelled) {
          return;
        }
        if (savedProject) {
          dispatchProject({
            type: 'restore-history',
            history: savedProject.history,
          });
          setSavedAt(savedProject.savedAt);
        }
        persistenceAvailable.current = true;
        setPersistenceEnabled(true);
        setPersistenceStatus('saved');
        try {
          setStorageEstimate(await estimateLocalStorage());
        } catch (error) {
          console.error('Unable to estimate local storage usage.', error);
          setStorageEstimateFailed(true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Unable to recover the local project.', error);
        persistenceAvailable.current = false;
        setPersistenceStatus('error');
        setPersistenceError(es.persistence.recoveryFailed);
      } finally {
        if (!cancelled) {
          setHasHydrated(true);
          hydrationGate.resolve();
        }
      }
    }

    void restoreLocalProject();
    return () => {
      cancelled = true;
    };
  }, [dispatchProject, hydrationGate]);

  useEffect(() => {
    if (
      !hasHydrated ||
      !persistenceEnabled ||
      (projectHistory.project.documents.size === 0 &&
        projectHistory.undoStack.length === 0 &&
        projectHistory.redoStack.length === 0)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveProjectNow(projectHistory);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hasHydrated, persistenceEnabled, projectHistory, saveProjectNow]);

  const redoProjectChange = useCallback((): void => {
    if (isPageAnalysisRunning) {
      return;
    }
    dispatchProject({ type: 'redo' });
  }, [dispatchProject, isPageAnalysisRunning]);

  const undoProjectChange = useCallback((): void => {
    if (isPageAnalysisRunning) {
      return;
    }
    const command = projectHistory.undoStack.at(-1);
    if (!command) {
      return;
    }

    const removesActiveDocument =
      activeDocumentId !== null &&
      command.inverse.some(
        (operation) =>
          operation.type === 'remove-document' &&
          operation.documentId === activeDocumentId,
      );
    if (removesActiveDocument) {
      setActiveDocumentId(null);
      setActivePageId(null);
      setActivePageInfo(null);
      setActivePdfSession(null);
      setSelectedOrientationPageIds(new Set());
    }
    dispatchProject({ type: 'undo' });
  }, [
    activeDocumentId,
    dispatchProject,
    isPageAnalysisRunning,
    projectHistory.undoStack,
  ]);

  function moveSelectedPage(direction: 'up' | 'down'): void {
    if (!currentProjectPage) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createMovePageCommand(
        projectHistory.project,
        currentProjectPage.id,
        sequencePageNumber + (direction === 'up' ? -1 : 1),
      ),
    });
  }

  function duplicateSelectedPage(): void {
    if (!currentProjectPage) {
      return;
    }
    const command = createDuplicatePageCommand(
      projectHistory.project,
      currentProjectPage.id,
    );
    const operation = command.forward[0];
    if (!operation || operation.type !== 'insert-page') {
      throw new Error('The duplicate page command did not insert a page.');
    }
    dispatchProject({ type: 'execute', command });
    setActivePageId(operation.page.id);
  }

  function rotateSelectedPage(degrees: 90 | 180 | 270): void {
    if (!currentProjectPage) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createRotatePageCommand(
        projectHistory.project,
        currentProjectPage.id,
        degrees,
      ),
    });
  }

  function applySelectedPageCropBox(cropBox: PdfBox | null): void {
    if (!currentProjectPage || isPageAnalysisRunning) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createSetPageCropBoxCommand(
        projectHistory.project,
        currentProjectPage.id,
        cropBox,
      ),
    });
  }

  function rotateSelectedPages(degrees: 90 | 180 | 270): void {
    if (selectedOrientationPages.length === 0 || isPageAnalysisRunning) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createSetPageRotationsCommand(
        projectHistory.project,
        selectedOrientationPages.map((page) => ({
          pageId: page.id,
          rotationDeltaDegrees: (page.rotationDeltaDegrees + degrees) % 360,
        })),
        'Girar páginas seleccionadas',
      ),
    });
    setSelectedOrientationPageIds(new Set());
  }

  function applyOrientationSuggestion(pageId: string): void {
    const page = projectHistory.project.pages.get(pageId);
    const analysis = page?.orientationAnalysis;
    if (
      !page ||
      analysis?.status !== 'suggestion' ||
      analysis.targetRotationDeltaDegrees === page.rotationDeltaDegrees ||
      isPageAnalysisRunning
    ) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createSetPageRotationsCommand(
        projectHistory.project,
        [
          {
            pageId,
            rotationDeltaDegrees: analysis.targetRotationDeltaDegrees,
          },
        ],
        'Aplicar sugerencia de orientación',
      ),
    });
  }

  function applyAllOrientationSuggestions(): void {
    if (pendingOrientationSuggestions.length === 0 || isPageAnalysisRunning) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createSetPageRotationsCommand(
        projectHistory.project,
        pendingOrientationSuggestions.flatMap((page) => {
          const analysis = page.orientationAnalysis;
          return analysis?.status === 'suggestion'
            ? [
                {
                  pageId: page.id,
                  rotationDeltaDegrees:
                    analysis.targetRotationDeltaDegrees,
                },
              ]
            : [];
        }),
        'Aplicar sugerencias de orientación',
      ),
    });
  }

  function toggleOrientationPageSelection(pageId: string): void {
    if (isPageAnalysisRunning) {
      return;
    }
    setSelectedOrientationPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }

  function deleteSelectedPage(): void {
    if (!currentProjectPage) {
      return;
    }
    const nextPage =
      activeDocumentPages[activePageIndex + 1] ??
      activeDocumentPages[activePageIndex - 1] ??
      null;
    dispatchProject({
      type: 'execute',
      command: createDeletePageCommand(
        projectHistory.project,
        currentProjectPage.id,
      ),
    });
    setActivePageId(nextPage?.id ?? null);
  }

  function restorePage(pageId: string): void {
    dispatchProject({
      type: 'execute',
      command: createRestorePageCommand(projectHistory.project, pageId),
    });
    setActivePageId(pageId);
  }

  async function runBlankScan(): Promise<void> {
    if (
      !activeDocument ||
      !activeSession ||
      activeDocumentPages.length === 0 ||
      isPageAnalysisRunning
    ) {
      return;
    }

    blankScanAbort.current?.abort();
    const controller = new AbortController();
    blankScanAbort.current = controller;
    const documentId = activeDocument.id;
    const pages = activeDocumentPages;
    let completed = 0;
    setBlankScan({
      documentId,
      status: 'running',
      completed,
      total: pages.length,
    });

    try {
      const { analyzeDocumentPages } = await import(
        './features/blank-detection/analyze-document'
      );
      const result = await analyzeDocumentPages({
        document: activeSession.document,
        pages,
        renderQueue,
        signal: controller.signal,
        onPageAnalysis: (pageId, analysis) => {
          dispatchProject({
            type: 'record-page-blank-analysis',
            pageId,
            analysis,
          });
        },
        onProgress: (progress) => {
          completed = progress.completed;
          setBlankScan((current) =>
            current?.documentId === documentId
              ? { ...current, completed }
              : current,
          );
        },
      });
      setBlankScan({
        documentId,
        status: result,
        completed,
        total: pages.length,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        setBlankScan({
          documentId,
          status: 'cancelled',
          completed,
          total: pages.length,
        });
      } else {
        console.error('Unable to complete blank-page analysis.', error);
        setBlankScan({
          documentId,
          status: 'failed',
          completed,
          total: pages.length,
        });
      }
    } finally {
      if (blankScanAbort.current === controller) {
        blankScanAbort.current = null;
      }
    }
  }

  function reviewSelectedPage(
    decision: BlankPageReviewDecision | null,
  ): void {
    if (!currentProjectPage || isPageAnalysisRunning) {
      return;
    }
    dispatchProject({
      type: 'execute',
      command: createSetBlankReviewDecisionCommand(
        projectHistory.project,
        currentProjectPage.id,
        decision,
      ),
    });
  }

  function cancelBlankScan(): void {
    blankScanAbort.current?.abort();
  }

  async function runOrientationScan(): Promise<void> {
    if (
      !activeDocument ||
      !activeSession ||
      activeDocumentPages.length === 0 ||
      isPageAnalysisRunning
    ) {
      return;
    }

    const controller = new AbortController();
    orientationScanAbort.current = controller;
    const documentId = activeDocument.id;
    const pages = activeDocumentPages;
    let completed = 0;
    setOrientationScan({
      documentId,
      status: 'running',
      completed,
      total: pages.length,
    });

    try {
      const { analyzeDocumentOrientation } = await import(
        './features/orientation/analyze-document-orientation'
      );
      const result = await analyzeDocumentOrientation({
        document: activeSession.document,
        pages,
        signal: controller.signal,
        onPageAnalysis: (pageId, analysis) => {
          dispatchProject({
            type: 'record-page-orientation-analysis',
            pageId,
            analysis,
          });
        },
        onProgress: (progress) => {
          completed = progress.completed;
          setOrientationScan((current) =>
            current?.documentId === documentId
              ? { ...current, completed }
              : current,
          );
        },
      });
      setOrientationScan({
        documentId,
        status: result,
        completed,
        total: pages.length,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        setOrientationScan({
          documentId,
          status: 'cancelled',
          completed,
          total: pages.length,
        });
      } else {
        console.error('Unable to complete orientation analysis.', error);
        setOrientationScan({
          documentId,
          status: 'failed',
          completed,
          total: pages.length,
        });
      }
    } finally {
      if (orientationScanAbort.current === controller) {
        orientationScanAbort.current = null;
      }
    }
  }

  function cancelOrientationScan(): void {
    orientationScanAbort.current?.abort();
  }

  async function runPdfExport(asParts = false, startAtPart = 1): Promise<void> {
    if (pdfExportAbort.current || exportPreflightError || (!asParts && !exportEstimate.withinBudget)) {
      return;
    }

    const controller = new AbortController();
    pdfExportAbort.current = controller;
    let completedParts = startAtPart - 1;
    setPdfExportState({
      stage: 'preparing',
      current: 0,
      total: activeProjectPages.length,
      errorCode: null,
    });

    try {
      const { exportProjectPdf, exportProjectPdfParts } = await import(
        './features/export/pdf-export'
      );
      const options = {
        documents,
        pages: activeProjectPages,
        signal: controller.signal,
        onProgress: (progress: PdfExportProgress) => {
          setPdfExportState({
            stage: progress.stage,
            current: progress.current,
            total: progress.total,
            errorCode: null,
            completedParts,
            ...(asParts ? { totalParts: exportPartPlan.length } : {}),
            ...(progress.partIndex !== undefined ? { partIndex: progress.partIndex } : {}),
            ...(progress.partCount !== undefined ? { partCount: progress.partCount } : {}),
          });
        },
      };
      const downloadResult = (bytes: ArrayBuffer, name: string) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        try {
          const download = window.document.createElement('a');
          download.href = url;
          download.download = name;
          download.click();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw new PdfExportError('generation-failed', { cause: error });
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      let totalPages = 0;
      if (asParts) {
        for await (const part of exportProjectPdfParts(options, startAtPart, maxPagesPerPart)) {
          if (controller.signal.aborted) throw new PdfExportError('cancelled');
          downloadResult(part.result.bytes, `document-studio-parte-${String(part.index).padStart(2, '0')}.pdf`);
          completedParts += 1;
          totalPages += part.result.pageCount;
          setPdfExportState({ stage: 'copying', current: completedParts, total: part.total, errorCode: null, completedParts, totalParts: part.total });
        }
      } else {
        const result = await exportProjectPdf(options);
        if (controller.signal.aborted) throw new PdfExportError('cancelled');
        downloadResult(result.bytes, 'document-studio-combined.pdf');
        totalPages = result.pageCount;
      }
      setPdfExportState({
        stage: 'complete',
        current: asParts ? completedParts : totalPages,
        total: asParts ? exportPartPlan.length : totalPages,
        errorCode: null,
        completedParts,
        ...(asParts ? { totalParts: exportPartPlan.length } : {}),
      });
    } catch (error) {
      const code =
        error instanceof PdfExportError ? error.code : 'generation-failed';
      if (code !== 'cancelled') {
        console.error('Unable to export the project PDF.', error);
      }
      setPdfExportState({
        stage: code === 'cancelled' ? 'cancelled' : 'failed',
        current: completedParts,
        total: asParts ? exportPartPlan.length : activeProjectPages.length,
        errorCode: code,
        completedParts,
        ...(asParts ? { totalParts: exportPartPlan.length } : {}),
      });
    } finally {
      if (pdfExportAbort.current === controller) {
        pdfExportAbort.current = null;
      }
    }
  }

  function cancelPdfExport(): void {
    if (!pdfExportAbort.current) {
      return;
    }
    pdfExportAbort.current.abort();
    setPdfExportState((current) =>
      current
        ? { ...current, stage: 'cancelling', errorCode: null }
        : current,
    );
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input:not([type="file"]), textarea, select, [contenteditable="true"]',
          ))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoProjectChange();
        } else {
          undoProjectChange();
        }
      } else if (key === 'y' && !event.shiftKey) {
        event.preventDefault();
        redoProjectChange();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redoProjectChange, undoProjectChange]);

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

  useEffect(() => {
    return () => {
      blankScanAbort.current?.abort();
      orientationScanAbort.current?.abort();
      pdfExportAbort.current?.abort();
    };
  }, []);

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
    if (files.length === 0) {
      return;
    }
    if (!hasHydrated) {
      await hydrationGate.promise;
    }
    if (importRunning.current || isPageAnalysisRunning) {
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
        dispatchProject({ type: 'import-document', document: documentRecord });
        setSelectedOrientationPageIds(new Set());
        setActiveDocumentId(documentRecord.id);
        setActivePageId(
          documentRecord.pageCount > 0
            ? `${documentRecord.id}:page:1`
            : null,
        );
        setActivePageInfo(null);
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

  async function relinkFiles(files: File[]): Promise<void> {
    if (
      files.length === 0 ||
      isLoadingDocument ||
      isPageAnalysisRunning ||
      documentsNeedingRelink.length === 0
    ) {
      return;
    }

    setIsRelinking(true);
    setImportFailures([]);
    let remainingDocuments = [...documentsNeedingRelink];
    const failures: ImportFailure[] = [];

    for (const file of files) {
      const fileName = safeFileName(file.name);
      const candidates = remainingDocuments.filter(
        (document) =>
          document.fileName === fileName &&
          document.size === file.size &&
          document.fingerprint !== null,
      );
      if (candidates.length === 0) {
        failures.push({
          fileName,
          message: es.persistence.sourceNotFound,
        });
        continue;
      }

      setProgress({
        fileName,
        loaded: 0,
        total: file.size,
        percent: 0,
      });

      let session: PdfDocumentSession | null = null;
      let retainedSession = false;
      try {
        const { openPdfDocument } = await import(
          './features/documents/pdf-import'
        );
        session = await openPdfDocument(file, {
          requestPassword: (reason) =>
            requestDocumentPassword(fileName, reason),
          confirmFullRead: (fileSize) =>
            requestFullReadConfirmation(fileName, fileSize),
          onProgress: (nextProgress) => {
            setProgress({ fileName, ...nextProgress });
          },
        });

        const fingerprint = session.document.fingerprints[0] ?? null;
        const matches = candidates.filter(
          (document) =>
            document.fingerprint === fingerprint &&
            document.pageCount === session?.document.numPages,
        );
        const activeDocument = matches[0];
        if (!activeDocument) {
          failures.push({
            fileName,
            message: es.persistence.sourceMismatch,
          });
          continue;
        }

        for (const document of matches) {
          dispatchProject({
            type: 'attach-document-file',
            documentId: document.id,
            file,
          });
        }
        remainingDocuments = remainingDocuments.filter(
          (document) => !matches.some((match) => match.id === document.id),
        );
        setActiveDocumentId(activeDocument.id);
        const firstPage = getOrderedProjectPages(
          projectHistory.project,
        ).find(
          (page) => page.documentId === activeDocument.id && !page.isDeleted,
        );
        setActivePageId(firstPage?.id ?? null);
        setActivePageInfo(null);
        setSelectedOrientationPageIds(new Set());
        setActivePdfSession({
          documentId: activeDocument.id,
          session,
        });
        retainedSession = true;
      } catch (error) {
        failures.push({
          fileName,
          message: getImportFailureMessage(error),
        });
      } finally {
        if (session && !retainedSession) {
          try {
            await session.loadingTask.destroy();
          } catch (error) {
            console.error('Unable to release a relinked PDF source.', error);
          }
        }
      }
    }

    setImportFailures(failures);
    setIsRelinking(false);
    setProgress(null);
  }

  async function selectDocument(document: ProjectDocument): Promise<void> {
    if (
      isLoadingDocument ||
      isPageAnalysisRunning ||
      importRunning.current ||
      activePdfSession?.documentId === document.id
    ) {
      return;
    }
    if (!document.file) {
      setImportFailures([
        {
          fileName: document.fileName,
          message: es.persistence.sourceNotFound,
        },
      ]);
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

      setSelectedOrientationPageIds(new Set());
      setActiveDocumentId(document.id);
      const firstPage = getOrderedProjectPages(projectHistory.project).find(
        (page) => page.documentId === document.id && !page.isDeleted,
      );
      setActivePageId(firstPage?.id ?? null);
      setActivePageInfo(null);
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

  function handleRelinkInputChange(
    event: FormEvent<HTMLInputElement>,
  ): void {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void relinkFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!isLoadingDocument && !isPageAnalysisRunning) {
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
          <div
            className="history-controls"
            role="group"
            aria-label={es.history.groupLabel}
          >
            <button
              className="history-control"
              type="button"
              aria-label={es.history.undo}
              title={es.history.undo}
              disabled={
                isPageAnalysisRunning || projectHistory.undoStack.length === 0
              }
              onClick={undoProjectChange}
            >
              <span aria-hidden="true">↶</span>
              <span>{es.history.undo}</span>
            </button>
            <button
              className="history-control"
              type="button"
              aria-label={es.history.redo}
              title={es.history.redo}
              disabled={
                isPageAnalysisRunning || projectHistory.redoStack.length === 0
              }
              onClick={redoProjectChange}
            >
              <span aria-hidden="true">↷</span>
              <span>{es.history.redo}</span>
            </button>
          </div>
          <button
            className="save-project-button"
            type="button"
            disabled={
              !persistenceEnabled ||
              persistenceStatus === 'loading' ||
              persistenceStatus === 'saving'
            }
            onClick={() => void saveProjectNow(projectHistory)}
          >
            {es.persistence.saveNow}
          </button>
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
                      disabled={
                        isLoadingDocument ||
                        isPageAnalysisRunning ||
                        document.file === null
                      }
                      onClick={() => void selectDocument(document)}
                    >
                      <span className="document-list-name">
                        {document.fileName}
                      </span>
                      {document.file === null && (
                        <span className="document-list-source">
                          {es.persistence.sourcePending}
                        </span>
                      )}
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
              {activeSession && (
                <button
                  className="blank-scan-button"
                  type="button"
                  disabled={
                    (!isBlankScanRunning &&
                      (activeDocumentPages.length === 0 ||
                        isPageAnalysisRunning))
                  }
                  onClick={() =>
                    isBlankScanRunning
                      ? cancelBlankScan()
                      : void runBlankScan()
                  }
                >
                  {isBlankScanRunning
                    ? es.blankDetection.cancel
                    : es.blankDetection.scan}
                </button>
              )}
            </div>
            {activeDocument &&
              blankScan?.documentId === activeDocument.id && (
                <div className="blank-scan-status">
                  {blankScan.status === 'running' ? (
                    <>
                      <p role="status">
                        {es.blankDetection.scanning}:{' '}
                        {formatNumber(blankScan.completed)} /{' '}
                        {formatNumber(blankScan.total)}
                      </p>
                      <progress
                        aria-label={es.blankDetection.progress}
                        max={blankScan.total}
                        value={blankScan.completed}
                      />
                    </>
                  ) : (
                    <p role={blankScan.status === 'failed' ? 'alert' : 'status'}>
                      {blankScan.status === 'completed'
                        ? es.blankDetection.scanComplete
                        : blankScan.status === 'cancelled'
                          ? es.blankDetection.scanCancelled
                          : es.blankDetection.scanFailed}
                    </p>
                  )}
                </div>
              )}
            {activeDocument && activeSession && (
              <div className="orientation-tools">
                <button
                  className="orientation-action-button"
                  type="button"
                  disabled={
                    !isOrientationScanRunning &&
                    (activeDocumentPages.length === 0 ||
                      isPageAnalysisRunning)
                  }
                  onClick={() =>
                    isOrientationScanRunning
                      ? cancelOrientationScan()
                      : void runOrientationScan()
                  }
                >
                  {isOrientationScanRunning
                    ? es.orientation.cancel
                    : es.orientation.analyze}
                </button>
                {orientationScan?.documentId === activeDocument.id && (
                  <div className="orientation-scan-status">
                    {orientationScan.status === 'running' ? (
                      <>
                        <p role="status">
                          {es.orientation.scanning}:{' '}
                          {formatNumber(orientationScan.completed)} /{' '}
                          {formatNumber(orientationScan.total)}
                        </p>
                        <progress
                          aria-label={es.orientation.progress}
                          max={orientationScan.total}
                          value={orientationScan.completed}
                        />
                      </>
                    ) : (
                      <p
                        role={
                          orientationScan.status === 'failed'
                            ? 'alert'
                            : 'status'
                        }
                      >
                        {orientationScan.status === 'completed'
                          ? es.orientation.scanComplete
                          : orientationScan.status === 'cancelled'
                            ? es.orientation.scanCancelled
                            : es.orientation.scanFailed}
                      </p>
                    )}
                  </div>
                )}
                <p className="orientation-disclaimer">
                  {es.orientation.disclaimer}
                </p>
                {pendingOrientationSuggestions.length > 0 && (
                  <button
                    className="orientation-action-button"
                    type="button"
                    disabled={isPageAnalysisRunning}
                    onClick={applyAllOrientationSuggestions}
                  >
                    {es.orientation.applySuggestions} (
                    {formatNumber(pendingOrientationSuggestions.length)})
                  </button>
                )}
                {selectedOrientationPages.length > 0 && (
                  <div
                    className="orientation-batch-controls"
                    role="group"
                    aria-label={es.orientation.region}
                  >
                    <span>
                      {formatNumber(selectedOrientationPages.length)}{' '}
                      {es.orientation.selectedCount}
                    </span>
                    <button
                      className="orientation-action-button"
                      type="button"
                      disabled={isPageAnalysisRunning}
                      onClick={() => rotateSelectedPages(270)}
                    >
                      {es.orientation.rotateLeft}
                    </button>
                    <button
                      className="orientation-action-button"
                      type="button"
                      disabled={isPageAnalysisRunning}
                      onClick={() => rotateSelectedPages(90)}
                    >
                      {es.orientation.rotateRight}
                    </button>
                    <button
                      className="orientation-action-button"
                      type="button"
                      disabled={isPageAnalysisRunning}
                      onClick={() => rotateSelectedPages(180)}
                    >
                      {es.orientation.rotateHalf}
                    </button>
                    <button
                      className="orientation-clear-selection"
                      type="button"
                      disabled={isPageAnalysisRunning}
                      onClick={() => setSelectedOrientationPageIds(new Set())}
                    >
                      {es.orientation.clearSelection}
                    </button>
                  </div>
                )}
              </div>
            )}
            {activeDocument && activeSession ? (
              <ThumbnailList
                key={activeDocument.id}
                cache={thumbnailCache}
                document={activeSession.document}
                documentId={activeDocument.id}
                pages={documentPages}
                selectedPageId={selectedPageId}
                onSelectPage={setActivePageId}
                onRestorePage={restorePage}
                selectedOrientationPageIds={selectedOrientationPageIds}
                onToggleOrientationPage={toggleOrientationPageSelection}
                pageActionsDisabled={isPageAnalysisRunning}
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
            disabled={isLoadingDocument || isPageAnalysisRunning}
            onChange={handleFileInputChange}
          />
          <input
            ref={relinkInputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            aria-label={es.persistence.relinkButton}
            disabled={isLoadingDocument || isPageAnalysisRunning}
            onChange={handleRelinkInputChange}
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

          <section
            className="persistence-panel"
            aria-label={es.persistence.region}
            aria-live="polite"
          >
            <div className="persistence-summary">
              <span>
                {persistenceStatus === 'loading'
                  ? es.persistence.loading
                  : persistenceStatus === 'pending'
                    ? es.persistence.pending
                    : persistenceStatus === 'saving'
                      ? es.persistence.saving
                      : persistenceStatus === 'error'
                        ? es.persistence.errorSummary
                        : savedAt
                          ? es.persistence.savedAt.replace(
                              '{time}',
                              new Date(savedAt).toLocaleTimeString('es-MX', {
                                hour: '2-digit',
                                minute: '2-digit',
                              }),
                            )
                          : es.persistence.notSaved}
              </span>
              {storageEstimate && (
                <span className="storage-usage">
                  {formatBytes(storageEstimate.usage)} /{' '}
                  {formatBytes(storageEstimate.quota)}
                </span>
              )}
            </div>
            {persistenceStatus === 'error' && persistenceError && (
              <p className="persistence-error" role="alert">
                {persistenceError}
              </p>
            )}
            {storageEstimate &&
              storageEstimate.usage / storageEstimate.quota >= 0.9 && (
                <p className="persistence-warning">
                  {es.persistence.quotaWarning
                    .replace('{usage}', formatBytes(storageEstimate.usage))
                    .replace('{quota}', formatBytes(storageEstimate.quota))}
                </p>
              )}
            {storageEstimateFailed && (
              <p className="persistence-warning">
                {es.persistence.quotaEstimateFailed}
              </p>
            )}
            {!storageEstimate && !storageEstimateFailed && hasHydrated && (
              <p className="persistence-hint">
                {es.persistence.quotaUnavailable}
              </p>
            )}
          </section>

          {documentsNeedingRelink.length > 0 && (
            <section
              className="recovery-panel"
              aria-label={es.persistence.recoveryRegion}
            >
              <p>
                {es.persistence.missingSources.replace(
                  '{count}',
                  formatNumber(documentsNeedingRelink.length),
                )}
              </p>
              <p>{es.persistence.relinkDescription}</p>
              <button
                className="secondary-button"
                type="button"
                disabled={isLoadingDocument || isPageAnalysisRunning}
                onClick={() => relinkInputRef.current?.click()}
              >
                {es.persistence.relinkButton}
              </button>
            </section>
          )}

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
            {activeDocument && activeSession && currentProjectPage ? (
              <PageViewer
                key={activeDocument.id}
                document={activeSession.document}
                pageId={currentProjectPage.id}
                sourcePageNumber={currentProjectPage.sourcePageNumber}
                rotationDeltaDegrees={currentProjectPage.rotationDeltaDegrees}
                pageGeometry={currentPageInfo}
                cropBox={currentProjectPage.cropBox}
                pageNumber={activePageNumber}
                pageCount={activeDocumentPages.length}
                sequencePageNumber={sequencePageNumber}
                sequencePageCount={totalPages}
                canMoveUp={sequencePageNumber > 1}
                canMoveDown={sequencePageNumber < totalPages}
                pageActionsDisabled={isPageAnalysisRunning}
                onPageChange={(pageNumber) =>
                  setActivePageId(activeDocumentPages[pageNumber - 1]?.id ?? null)
                }
                onMovePage={moveSelectedPage}
                onDuplicatePage={duplicateSelectedPage}
                onRotatePage={rotateSelectedPage}
                onApplyCropBox={applySelectedPageCropBox}
                onDeletePage={deleteSelectedPage}
                onPageInfo={updatePageInfo}
                onImport={() => fileInputRef.current?.click()}
                importDisabled={isLoadingDocument || isPageAnalysisRunning}
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
                  {activeDocument && activeSession
                    ? es.pages.noActivePages
                    : activeDocument
                    ? activeDocument.fileName
                    : es.workspace.emptyHeading}
                </h2>
                <p>
                  {activeDocument && activeSession
                    ? es.pages.restoreHint
                    : activeDocument
                    ? es.documents.reopening
                    : es.workspace.emptyDescription}
                </p>
                {!activeDocument && (
                  <div className="import-controls">
                    <button
                      className="import-button"
                      type="button"
                      disabled={isLoadingDocument || isPageAnalysisRunning}
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
          {documents.length > 0 && (
            <section
              className="export-panel"
              aria-label={es.pdfExport.region}
            >
              <h3>{es.pdfExport.heading}</h3>
              <p>{es.pdfExport.description}</p>
              <p>
                {es.pdfExport.pageSummary
                  .replace('{pages}', formatNumber(exportEstimate.pageCount))
                  .replace(
                    '{sources}',
                    formatNumber(exportEstimate.sourceDocumentCount),
                  )}
              </p>
              <p>
                {es.pdfExport.memoryEstimate
                  .replace(
                    '{estimate}',
                    formatBytes(exportEstimate.estimatedPeakBytes),
                  )
                  .replace('{budget}', formatBytes(exportEstimate.budgetBytes))}
              </p>
              <p>{es.pdfExport.estimateDisclaimer}</p>
              <label className="export-part-limit">
                {es.pdfExport.pagesPerPart}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={maxPagesPerPart}
                  onChange={(event) => setMaxPagesPerPart(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
                  aria-label={es.pdfExport.pagesPerPart}
                />
              </label>
              {exportEstimate.pageCount > 0 && exportPartPlan.length > 1 && (
                <div className="export-part-plan" aria-label={es.pdfExport.partPlan.replace('{count}', formatNumber(exportPartPlan.length))}>
                  <p>{es.pdfExport.partPlan.replace('{count}', formatNumber(exportPartPlan.length))}</p>
                  <ol>
                    {exportPartPlan.map((part) => (
                      <li key={part.index}>
                        {es.pdfExport.partRange
                          .replace('{part}', formatNumber(part.index))
                          .replace('{first}', formatNumber(part.firstPage))
                          .replace('{last}', formatNumber(part.lastPage))}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p>{es.pdfExport.signatureWarning}</p>
              <p>{es.pdfExport.preservationWarning}</p>
              {exportPreflightError && (
                <p className="export-error">
                  {es.pdfExport.errors[exportPreflightError]}
                </p>
              )}
              {!exportEstimate.withinBudget && exportPartPlan.length === 0 && !exportPreflightError && (
                <p className="export-error">{es.pdfExport.errors['memory-budget']}</p>
              )}
              <div className="export-actions">
                <button
                  className="import-button"
                  type="button"
                  disabled={
                    exportPreflightError !== null ||
                    !exportEstimate.withinBudget ||
                    isLoadingDocument ||
                    isPdfExportRunning
                  }
                  onClick={() => void runPdfExport()}
                >
                  {es.pdfExport.button}
                </button>
                {exportPartPlan.length > 1 && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={exportPreflightError !== null || isLoadingDocument || isPdfExportRunning}
                  onClick={() => void runPdfExport(
                    true,
                    pdfExportState?.totalParts !== undefined &&
                      ['cancelled', 'failed'].includes(pdfExportState.stage)
                      ? (pdfExportState.completedParts ?? 0) + 1
                      : 1,
                  )}
                  >
                    {es.pdfExport.partsButton}
                  </button>
                )}
                {isPdfExportRunning && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pdfExportState?.stage === 'cancelling'}
                    onClick={cancelPdfExport}
                  >
                    {es.pdfExport.cancelButton}
                  </button>
                )}
              </div>
              {isPdfExportRunning && pdfExportState && (
                <progress
                  max={Math.max(1, pdfExportState.total)}
                  value={pdfExportState.current}
                  aria-label={es.pdfExport.progress}
                />
              )}
              {pdfExportState && (
                <p
                  className={
                    pdfExportState.stage === 'failed'
                      ? 'export-error'
                      : 'export-status'
                  }
                  role={
                    pdfExportState.stage === 'failed' ? 'alert' : 'status'
                  }
                >
                  {getPdfExportStatusMessage(pdfExportState)}
                </p>
              )}
            </section>
          )}
          {activeDocument ? (
            <div className="document-properties">
              <h3>{es.properties.documentHeading}</h3>
             {documents.length > 1 && (
               <section
                 className="combination-notice"
                 aria-label={es.combination.region}
               >
                 <h3>{es.combination.heading}</h3>
                 <p>{es.combination.description}</p>
                 <p>{es.combination.sourceNote}</p>
                 <ul>
                   <li>{es.combination.signatureWarning}</li>
                   <li>{es.combination.preservationWarning}</li>
                   <li>{es.combination.exportNote}</li>
                   {documents.some(
                     (document) => document.metadata.hasSignatures,
                   ) && (
                     <li>
                       {es.combination.detectedSignatures.replace(
                         '{count}',
                         formatNumber(
                           documents.filter(
                             (document) =>
                               document.metadata.hasSignatures,
                           ).length,
                         ),
                       )}
                     </li>
                   )}
                   {documents.some(
                     (document) => document.metadata.hasForms,
                   ) && (
                     <li>
                       {es.combination.detectedForms.replace(
                         '{count}',
                         formatNumber(
                           documents.filter(
                             (document) => document.metadata.hasForms,
                           ).length,
                         ),
                       )}
                     </li>
                   )}
                 </ul>
               </section>
             )}
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
                        {formatNumber(activePageNumber)} /{' '}
                        {formatNumber(activeDocumentPages.length)}
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
              {currentProjectPage && (
                <MarginEditor
                  key={currentProjectPage.id}
                  geometry={currentPageInfo}
                  cropBox={currentProjectPage.cropBox}
                  disabled={isPageAnalysisRunning}
                  onApply={applySelectedPageCropBox}
                />
              )}
              {currentProjectPage && (
                <section
                  className="blank-review-properties"
                  aria-label={es.blankDetection.region}
                >
                  <h3>{es.blankDetection.reviewHeading}</h3>
                  {currentProjectPage.blankAnalysis ? (
                    <>
                      <p className="blank-analysis-status">
                        {getBlankPageStatusLabel(
                          currentProjectPage.blankAnalysis,
                          currentProjectPage.blankReviewDecision,
                        )}
                      </p>
                      <p>
                        {getBlankPageReasonLabel(
                          currentProjectPage.blankAnalysis,
                        )}
                      </p>
                      <p>
                        {es.blankDetection.confidence}:{' '}
                        {currentProjectPage.blankAnalysis.confidence ===
                        null
                          ? es.blankDetection.confidenceNotCalibrated
                          : `${formatNumber(
                              currentProjectPage.blankAnalysis.confidence * 100,
                              { maximumFractionDigits: 0 },
                            )}%`}
                      </p>
                      {currentProjectPage.blankAnalysis.status !==
                        'content-detected' &&
                        (currentProjectPage.blankReviewDecision ? (
                          <button
                            className="blank-review-button"
                            type="button"
                            disabled={isPageAnalysisRunning}
                            onClick={() => reviewSelectedPage(null)}
                          >
                            {es.blankDetection.clearDecision}
                          </button>
                        ) : (
                          <div className="blank-review-actions">
                            <button
                              className="blank-review-button"
                              type="button"
                              disabled={isPageAnalysisRunning}
                              onClick={() =>
                                reviewSelectedPage('confirmed-blank')
                              }
                            >
                              {es.blankDetection.confirmBlank}
                            </button>
                            <button
                              className="blank-review-button"
                              type="button"
                              disabled={isPageAnalysisRunning}
                              onClick={() => reviewSelectedPage('keep')}
                            >
                              {es.blankDetection.keep}
                            </button>
                          </div>
                        ))}
                      <p className="blank-review-disclaimer">
                        {es.blankDetection.manualOnly}
                      </p>
                    </>
                  ) : (
                    <p>{es.blankDetection.notAnalyzed}</p>
                  )}
                </section>
              )}
              {currentProjectPage && (
                <section
                  className="orientation-review-properties"
                  aria-label={es.orientation.region}
                >
                  <h3>{es.orientation.heading}</h3>
                  {currentProjectPage.orientationAnalysis ? (
                    <>
                      <p className="orientation-analysis-status">
                        {getOrientationStatusLabel(
                          currentProjectPage.orientationAnalysis,
                          currentProjectPage.rotationDeltaDegrees,
                        )}
                      </p>
                      <p>
                        {getOrientationReasonLabel(
                          currentProjectPage.orientationAnalysis,
                        )}
                      </p>
                      {currentProjectPage.orientationAnalysis.status ===
                        'suggestion' &&
                        currentProjectPage.orientationAnalysis
                          .targetRotationDeltaDegrees !==
                          currentProjectPage.rotationDeltaDegrees && (
                          <button
                            className="orientation-action-button"
                            type="button"
                            disabled={isPageAnalysisRunning}
                            onClick={() =>
                              applyOrientationSuggestion(
                                currentProjectPage.id,
                              )
                            }
                          >
                            {es.orientation.applySuggestion}
                          </button>
                        )}
                    </>
                  ) : (
                    <p>{es.orientation.notAnalyzed}</p>
                  )}
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getPdfExportStatusMessage(state: PdfExportUiState): string {
  const partSuffix = state.partIndex !== undefined && state.partCount !== undefined
    ? ` (${es.pdfExport.status.part.replace('{part}', formatNumber(state.partIndex)).replace('{total}', formatNumber(state.partCount))})`
    : '';
  switch (state.stage) {
    case 'preparing':
      return es.pdfExport.status.preparing;
    case 'loading':
      return es.pdfExport.status.loading
        .replace('{current}', formatNumber(state.current))
        .replace('{total}', formatNumber(state.total)) + partSuffix;
    case 'copying':
      return es.pdfExport.status.copying
        .replace('{current}', formatNumber(state.current))
        .replace('{total}', formatNumber(state.total)) + partSuffix;
    case 'serializing':
      return es.pdfExport.status.serializing + partSuffix;
    case 'validating':
      return es.pdfExport.status.validating
        .replace('{current}', formatNumber(state.current))
        .replace('{total}', formatNumber(state.total)) + partSuffix;
    case 'cancelling':
      return es.pdfExport.status.cancelling;
    case 'complete':
      if (state.totalParts !== undefined) {
        return es.pdfExport.status.partsComplete
          .replace('{done}', formatNumber(state.completedParts ?? 0))
          .replace('{total}', formatNumber(state.totalParts));
      }
      return es.pdfExport.status.complete.replace(
        '{count}',
        formatNumber(state.current),
      );
    case 'cancelled':
      if (state.totalParts !== undefined) {
        return es.pdfExport.status.cancelledParts
          .replace('{done}', formatNumber(state.completedParts ?? 0))
          .replace('{total}', formatNumber(state.totalParts));
      }
      return es.pdfExport.status.cancelled;
    case 'failed':
      if (state.totalParts !== undefined && (state.completedParts ?? 0) > 0) {
        return `${es.pdfExport.status.partsPartial.replace('{done}', formatNumber(state.completedParts ?? 0)).replace('{total}', formatNumber(state.totalParts))} ${es.pdfExport.errors[state.errorCode ?? 'generation-failed']}`;
      }
      return es.pdfExport.errors[state.errorCode ?? 'generation-failed'];
  }
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
