import type {
  ProjectCommand,
  ProjectDocument,
  ProjectHistoryState,
  ProjectOperation,
  ProjectPage,
} from '../store/project-store';
import type {
  BlankPageAnalysis,
  BlankPageReviewDecision,
} from '../features/blank-detection/types';
import { isValidBox } from '../features/margins/geometry';
import type { OrientationAnalysis } from '../features/orientation/types';

const databaseName = 'document-studio';
const databaseVersion = 1;
const projectStoreName = 'projects';
const activeProjectKey = 'active';
const currentSchemaVersion = 1;

interface UnknownRecord extends Record<string, unknown> {
  project?: unknown;
  documents?: unknown;
  documentOrder?: unknown;
  pages?: unknown;
  pageOrder?: unknown;
  id?: unknown;
  undoStack?: unknown;
  redoStack?: unknown;
  schemaVersion?: unknown;
  savedAt?: unknown;
  history?: unknown;
  forward?: unknown;
  inverse?: unknown;
  label?: unknown;
  type?: unknown;
  document?: unknown;
  index?: unknown;
  documentId?: unknown;
  page?: unknown;
  pageId?: unknown;
  toIndex?: unknown;
  isDeleted?: unknown;
  rotationDeltaDegrees?: unknown;
  cropBox?: unknown;
  decision?: unknown;
  metadata?: unknown;
  fileName?: unknown;
  size?: unknown;
  lastModified?: unknown;
  pageCount?: unknown;
  fingerprint?: unknown;
  title?: unknown;
  author?: unknown;
  subject?: unknown;
  creator?: unknown;
  producer?: unknown;
  pdfVersion?: unknown;
  creationDate?: unknown;
  modificationDate?: unknown;
  encrypted?: unknown;
  hasForms?: unknown;
  hasSignatures?: unknown;
  sourcePageNumber?: unknown;
  duplicatedFromPageId?: unknown;
  blankAnalysis?: unknown;
  blankReviewDecision?: unknown;
  orientationAnalysis?: unknown;
  status?: unknown;
  reason?: unknown;
  confidence?: unknown;
  foregroundPixelCount?: unknown;
  foregroundPixelRatio?: unknown;
  targetRotationDeltaDegrees?: unknown;
  xMin?: unknown;
  yMin?: unknown;
  xMax?: unknown;
  yMax?: unknown;
}

type StoredDocument = Omit<ProjectDocument, 'file'>;

type StoredOperation =
  | {
      type: 'insert-document';
      document: StoredDocument;
      index: number;
    }
  | Exclude<ProjectOperation, { type: 'insert-document' }>;

interface StoredProject {
  id: string;
  documents: [string, StoredDocument][];
  documentOrder: string[];
  pages: [string, ProjectPage][];
  pageOrder: string[];
}

interface StoredCommand {
  label: string;
  forward: StoredOperation[];
  inverse: StoredOperation[];
}

interface StoredProjectHistory {
  project: StoredProject;
  undoStack: StoredCommand[];
  redoStack: StoredCommand[];
}

export interface PersistedProjectRecord {
  schemaVersion: 1;
  savedAt: number;
  history: StoredProjectHistory;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export function serializeProjectHistory(
  history: ProjectHistoryState,
  savedAt = Date.now(),
): PersistedProjectRecord {
  return {
    schemaVersion: currentSchemaVersion,
    savedAt,
    history: {
      project: {
        id: history.project.id,
        documents: [...history.project.documents].map(([id, document]) => [
          id,
          stripDocumentFile(document),
        ]),
        documentOrder: [...history.project.documentOrder],
        pages: [...history.project.pages],
        pageOrder: [...history.project.pageOrder],
      },
      undoStack: history.undoStack.map(serializeCommand),
      redoStack: history.redoStack.map(serializeCommand),
    },
  };
}

export function deserializeProjectHistory(
  value: unknown,
): ProjectHistoryState {
  const history = expectRecord(value, 'project history');
  const storedProject = expectRecord(history.project, 'project');
  const documents = readPairs(
    storedProject.documents,
    'documents',
    (document) => readDocument(document),
  );
  const pages = readPairs(storedProject.pages, 'pages', readPage);
  const documentOrder = readStringArray(
    storedProject.documentOrder,
    'document order',
  );
  const pageOrder = readStringArray(storedProject.pageOrder, 'page order');

  assertProjectIndexes(documents, pages, documentOrder, pageOrder);

  return {
    project: {
      id: expectString(storedProject.id, 'project ID'),
      documents: new Map(documents),
      documentOrder,
      pages: new Map(pages),
      pageOrder,
    },
    undoStack: readCommands(history.undoStack, 'undo history'),
    redoStack: readCommands(history.redoStack, 'redo history'),
  };
}

export function migratePersistedProjectRecord(
  value: unknown,
): PersistedProjectRecord {
  const record = expectRecord(value, 'saved project');
  const schemaVersion = record.schemaVersion;
  const savedAt = expectFiniteNumber(record.savedAt, 'save time');
  if (schemaVersion === 0) {
    const legacyHistory = expectRecord(record.history, 'legacy project history');
    const history = deserializeProjectHistory({
      ...legacyHistory,
      redoStack: Array.isArray(legacyHistory.redoStack)
        ? legacyHistory.redoStack
        : [],
    });
    return serializeProjectHistory(history, savedAt);
  }
  if (schemaVersion !== currentSchemaVersion) {
    throw new Error(
      `Unsupported project schema version "${String(schemaVersion)}".`,
    );
  }

  const history = deserializeProjectHistory(record.history);
  return serializeProjectHistory(history, savedAt);
}

export async function loadSavedProject(): Promise<{
  history: ProjectHistoryState;
  savedAt: number;
} | null> {
  const database = await openDatabase();
  try {
    const record = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(projectStoreName, 'readonly');
      const request = transaction
        .objectStore(projectStoreName)
        .get(activeProjectKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to read the saved project.'));
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error('Unable to read the saved project.'),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error('Reading the saved project was aborted.'),
        );
    });
    if (record === undefined) {
      return null;
    }
    const migrated = migratePersistedProjectRecord(record);
    return {
      history: deserializeProjectHistory(migrated.history),
      savedAt: migrated.savedAt,
    };
  } finally {
    database.close();
  }
}

export async function saveProjectHistory(
  history: ProjectHistoryState,
): Promise<number> {
  const savedAt = Date.now();
  const record = serializeProjectHistory(history, savedAt);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(projectStoreName, 'readwrite');
      transaction.objectStore(projectStoreName).put(record, activeProjectKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error('Unable to save the local project.'),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error('Saving the local project was aborted.'),
        );
    });
    return savedAt;
  } finally {
    database.close();
  }
}

export async function estimateLocalStorage(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) {
    return null;
  }
  const estimate = await navigator.storage.estimate();
  if (
    typeof estimate.usage !== 'number' ||
    typeof estimate.quota !== 'number' ||
    !Number.isFinite(estimate.usage) ||
    !Number.isFinite(estimate.quota) ||
    estimate.quota <= 0
  ) {
    return null;
  }
  return { usage: estimate.usage, quota: estimate.quota };
}

export function isStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(projectStoreName)) {
        database.createObjectStore(projectStoreName);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to open local project storage.'));
  });
}

function stripDocumentFile(document: ProjectDocument): StoredDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    size: document.size,
    lastModified: document.lastModified,
    pageCount: document.pageCount,
    fingerprint: document.fingerprint,
    metadata: document.metadata,
  };
}

function serializeCommand(command: ProjectCommand): StoredCommand {
  return {
    label: command.label,
    forward: command.forward.map(serializeOperation),
    inverse: command.inverse.map(serializeOperation),
  };
}

function serializeOperation(operation: ProjectOperation): StoredOperation {
  if (operation.type === 'insert-document') {
    return {
      ...operation,
      document: stripDocumentFile(operation.document),
    };
  }
  return operation;
}

function readCommands(value: unknown, label: string): ProjectCommand[] {
  if (!Array.isArray(value)) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value.map((commandValue) => {
    const command = expectRecord(commandValue, 'project command');
    if (!Array.isArray(command.forward) || !Array.isArray(command.inverse)) {
      throw new Error('A saved project command is invalid.');
    }
    return {
      label: expectString(command.label, 'command label'),
      forward: command.forward.map(readOperation),
      inverse: command.inverse.map(readOperation),
    };
  });
}

function readOperation(value: unknown): ProjectOperation {
  const operation = expectRecord(value, 'project operation');
  switch (operation.type) {
    case 'insert-document':
      return {
        type: 'insert-document',
        document: readDocument(operation.document),
        index: expectIndex(operation.index),
      };
    case 'remove-document':
      return {
        type: operation.type,
        documentId: expectString(operation.documentId, 'document ID'),
      };
    case 'insert-page':
      return {
        type: operation.type,
        page: readPage(operation.page),
        index: expectIndex(operation.index),
      };
    case 'remove-page':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
      };
    case 'move-page':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
        documentId: expectString(operation.documentId, 'document ID'),
        toIndex: expectIndex(operation.toIndex),
      };
    case 'set-page-deleted':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
        isDeleted: expectBoolean(operation.isDeleted, 'deleted flag'),
      };
    case 'set-page-rotation':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
        rotationDeltaDegrees: readRotation(operation.rotationDeltaDegrees),
      };
    case 'set-page-crop-box':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
        cropBox: readCropBox(operation.cropBox),
      };
    case 'set-page-blank-review':
      return {
        type: operation.type,
        pageId: expectString(operation.pageId, 'page ID'),
        decision: readBlankReviewDecision(operation.decision),
      };
    default:
      throw new Error('The saved project contains an unknown operation.');
  }
}

function readDocument(value: unknown): ProjectDocument {
  const document = expectRecord(value, 'project document');
  if ('file' in document) {
    throw new Error('Saved project records must not contain source file bytes.');
  }
  const metadata = expectRecord(document.metadata, 'PDF metadata');
  for (const key of [
    'title',
    'author',
    'subject',
    'creator',
    'producer',
    'pdfVersion',
    'creationDate',
    'modificationDate',
  ]) {
    if (metadata[key] !== null && typeof metadata[key] !== 'string') {
      throw new Error(`The saved PDF metadata field "${key}" is invalid.`);
    }
  }
  for (const key of ['encrypted', 'hasForms', 'hasSignatures']) {
    expectBoolean(metadata[key], `PDF metadata ${key}`);
  }
  return {
    id: expectString(document.id, 'document ID'),
    file: null,
    fileName: expectString(document.fileName, 'file name'),
    size: expectNonNegativeNumber(document.size, 'file size'),
    lastModified: expectNonNegativeNumber(document.lastModified, 'file date'),
    pageCount: expectIndex(document.pageCount),
    fingerprint:
      document.fingerprint === null
        ? null
        : expectString(document.fingerprint, 'PDF fingerprint'),
    metadata: {
      title: metadata.title as string | null,
      author: metadata.author as string | null,
      subject: metadata.subject as string | null,
      creator: metadata.creator as string | null,
      producer: metadata.producer as string | null,
      pdfVersion: metadata.pdfVersion as string | null,
      creationDate: metadata.creationDate as string | null,
      modificationDate: metadata.modificationDate as string | null,
      encrypted: expectBoolean(metadata.encrypted, 'encrypted flag'),
      hasForms: expectBoolean(metadata.hasForms, 'forms flag'),
      hasSignatures: expectBoolean(metadata.hasSignatures, 'signatures flag'),
    },
  };
}

function readPage(value: unknown): ProjectPage {
  const page = expectRecord(value, 'project page');
  return {
    id: expectString(page.id, 'page ID'),
    documentId: expectString(page.documentId, 'document ID'),
    sourcePageNumber: expectPositiveIndex(page.sourcePageNumber),
    rotationDeltaDegrees: readRotation(page.rotationDeltaDegrees),
    cropBox: readCropBox(page.cropBox),
    duplicatedFromPageId:
      page.duplicatedFromPageId === null
        ? null
        : expectString(page.duplicatedFromPageId, 'duplicated page ID'),
    isDeleted: expectBoolean(page.isDeleted, 'deleted flag'),
    blankAnalysis: readBlankAnalysis(page.blankAnalysis),
    blankReviewDecision: readBlankReviewDecision(page.blankReviewDecision),
    orientationAnalysis: readOrientationAnalysis(page.orientationAnalysis),
  };
}

function readRotation(value: unknown): number {
  const rotation = expectIndex(value);
  if (rotation >= 360 || rotation % 90 !== 0) {
    throw new Error('The saved page rotation is invalid.');
  }
  return rotation;
}

function readBlankAnalysis(value: unknown): BlankPageAnalysis | null {
  if (value === null) {
    return null;
  }
  const analysis = expectRecord(value, 'blank-page analysis');
  const statuses = ['likely-blank', 'content-detected', 'needs-review'];
  const reasons = [
    'annotation-present',
    'no-visible-content',
    'visible-content',
    'sparse-content',
    'ambiguous-background',
    'analysis-error',
  ];
  const status = expectString(analysis.status, 'blank analysis status');
  const reason = expectString(analysis.reason, 'blank analysis reason');
  if (!statuses.includes(status) || !reasons.includes(reason)) {
    throw new Error('The saved blank-page analysis is invalid.');
  }
  const confidence = readOptionalFiniteNumber(
    analysis.confidence,
    'analysis confidence',
  );
  const foregroundPixelCount = readOptionalNonNegativeInteger(
    analysis.foregroundPixelCount,
    'foreground pixel count',
  );
  const foregroundPixelRatio = readOptionalFiniteNumber(
    analysis.foregroundPixelRatio,
    'foreground pixel ratio',
  );
  if (
    (confidence !== null && (confidence < 0 || confidence > 1)) ||
    (foregroundPixelRatio !== null &&
      (foregroundPixelRatio < 0 || foregroundPixelRatio > 1))
  ) {
    throw new Error('The saved blank-page analysis is out of range.');
  }
  return {
    status: status as BlankPageAnalysis['status'],
    reason: reason as BlankPageAnalysis['reason'],
    confidence,
    foregroundPixelCount,
    foregroundPixelRatio,
  };
}

function readBlankReviewDecision(
  value: unknown,
): BlankPageReviewDecision | null {
  if (value === null || value === 'confirmed-blank' || value === 'keep') {
    return value;
  }
  throw new Error('The saved blank-page review decision is invalid.');
}

function readOrientationAnalysis(value: unknown): OrientationAnalysis | null {
  if (value === null) {
    return null;
  }
  const analysis = expectRecord(value, 'orientation analysis');
  const status = expectString(analysis.status, 'orientation status');
  const reason = expectString(analysis.reason, 'orientation reason');
  const reasons = [
    'digital-text-direction',
    'no-digital-text',
    'insufficient-text',
    'mixed-directions',
    'non-cardinal-direction',
    'vertical-writing',
    'analysis-error',
  ];
  if (!reasons.includes(reason)) {
    throw new Error('The saved orientation reason is invalid.');
  }
  if (status === 'suggestion') {
    const targetRotationDeltaDegrees = expectIndex(
      analysis.targetRotationDeltaDegrees,
    );
    if (
      reason !== 'digital-text-direction' ||
      targetRotationDeltaDegrees >= 360 ||
      targetRotationDeltaDegrees % 90 !== 0
    ) {
      throw new Error('The saved orientation suggestion is invalid.');
    }
    return {
      status,
      reason,
      targetRotationDeltaDegrees,
    };
  }
  if (
    status !== 'needs-review' ||
    reason === 'digital-text-direction' ||
    analysis.targetRotationDeltaDegrees !== null
  ) {
    throw new Error('The saved orientation analysis is invalid.');
  }
  return {
    status,
    reason: reason as Exclude<
      OrientationAnalysis['reason'],
      'digital-text-direction'
    >,
    targetRotationDeltaDegrees: null,
  };
}

function readCropBox(value: unknown): ProjectPage['cropBox'] {
  if (value === null) {
    return null;
  }
  const box = expectRecord(value, 'CropBox');
  const cropBox = {
    xMin: expectFiniteNumber(box.xMin, 'CropBox x minimum'),
    yMin: expectFiniteNumber(box.yMin, 'CropBox y minimum'),
    xMax: expectFiniteNumber(box.xMax, 'CropBox x maximum'),
    yMax: expectFiniteNumber(box.yMax, 'CropBox y maximum'),
  };
  if (!isValidBox(cropBox)) {
    throw new Error('The saved CropBox must have positive dimensions.');
  }
  return cropBox;
}

function readPairs<T>(
  value: unknown,
  label: string,
  parse: (value: unknown) => T,
): [string, T][] {
  if (!Array.isArray(value)) {
    throw new Error(`The saved ${label} list is invalid.`);
  }
  const pairs = value.map((entry): [string, T] => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`A saved ${label} entry is invalid.`);
    }
    return [expectString(entry[0], `${label} ID`), parse(entry[1])];
  });
  if (new Set(pairs.map(([id]) => id)).size !== pairs.length) {
    throw new Error(`The saved ${label} list contains duplicate IDs.`);
  }
  return pairs;
}

function assertProjectIndexes(
  documents: [string, ProjectDocument][],
  pages: [string, ProjectPage][],
  documentOrder: string[],
  pageOrder: string[],
): void {
  const documentIds = new Set(documents.map(([id]) => id));
  const pageIds = new Set(pages.map(([id]) => id));
  const documentById = new Map(documents);
  const pageById = new Map(pages);
  if (
    documentIds.size !== documentOrder.length ||
    documentOrder.some((id) => !documentIds.has(id)) ||
    new Set(documentOrder).size !== documentOrder.length
  ) {
    throw new Error('The saved project document order is inconsistent.');
  }
  if (
    pageIds.size !== pageOrder.length ||
    pageOrder.some((id) => !pageIds.has(id)) ||
    new Set(pageOrder).size !== pageOrder.length
  ) {
    throw new Error('The saved project page order is inconsistent.');
  }
  for (const [id, document] of documents) {
    if (id !== document.id) {
      throw new Error('A saved document ID does not match its index.');
    }
  }
  for (const [id, page] of pages) {
    const document = documentById.get(page.documentId);
    if (
      id !== page.id ||
      !document ||
      page.sourcePageNumber > document.pageCount
    ) {
      throw new Error('A saved page references an invalid document.');
    }
    if (page.duplicatedFromPageId !== null) {
      const sourcePage = pageById.get(page.duplicatedFromPageId);
      if (
        !sourcePage ||
        sourcePage.id === page.id ||
        sourcePage.documentId !== page.documentId ||
        sourcePage.sourcePageNumber !== page.sourcePageNumber
      ) {
        throw new Error('A saved duplicated page has an invalid source.');
      }
    }
  }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value.map((item) => expectString(item, label));
}

function expectRecord(
  value: unknown,
  label: string,
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value;
}

function expectFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return value;
}

function expectNonNegativeNumber(value: unknown, label: string): number {
  const number = expectFiniteNumber(value, label);
  if (number < 0) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return number;
}

function readOptionalFiniteNumber(value: unknown, label: string): number | null {
  return value === null ? null : expectFiniteNumber(value, label);
}

function readOptionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === null) {
    return null;
  }
  const number = expectFiniteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`The saved ${label} is invalid.`);
  }
  return number;
}

function expectIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('A saved project index is invalid.');
  }
  return value as number;
}

function expectPositiveIndex(value: unknown): number {
  const index = expectIndex(value);
  if (index < 1) {
    throw new Error('A saved page number must be positive.');
  }
  return index;
}
