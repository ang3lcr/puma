import type { ImportedPdf } from '../features/documents/pdf-import-types';
import type {
  BlankPageAnalysis,
  BlankPageReviewDecision,
} from '../features/blank-detection/types';
import type { OrientationAnalysis } from '../features/orientation/types';

export type ProjectDocument = Omit<ImportedPdf, 'session'>;

export interface ProjectPage {
  readonly id: string;
  readonly documentId: string;
  readonly sourcePageNumber: number;
  readonly rotationDeltaDegrees: number;
  readonly duplicatedFromPageId: string | null;
  readonly isDeleted: boolean;
  readonly blankAnalysis: BlankPageAnalysis | null;
  readonly blankReviewDecision: BlankPageReviewDecision | null;
  readonly orientationAnalysis: OrientationAnalysis | null;
}

export interface Project {
  readonly id: string;
  readonly documents: ReadonlyMap<string, ProjectDocument>;
  readonly documentOrder: readonly string[];
  readonly pages: ReadonlyMap<string, ProjectPage>;
  readonly pageOrder: readonly string[];
}

export type ProjectOperation =
  | {
      type: 'insert-document';
      document: ProjectDocument;
      index: number;
    }
  | {
      type: 'remove-document';
      documentId: string;
    }
  | {
      type: 'insert-page';
      page: ProjectPage;
      index: number;
    }
  | {
      type: 'remove-page';
      pageId: string;
    }
  | {
      type: 'move-page';
      pageId: string;
      documentId: string;
      toIndex: number;
    }
  | {
      type: 'set-page-deleted';
      pageId: string;
      isDeleted: boolean;
    }
  | {
      type: 'set-page-rotation';
      pageId: string;
      rotationDeltaDegrees: number;
    }
  | {
      type: 'set-page-blank-review';
      pageId: string;
      decision: BlankPageReviewDecision | null;
    };

export interface ProjectCommand {
  readonly label: string;
  readonly forward: readonly ProjectOperation[];
  readonly inverse: readonly ProjectOperation[];
}

export interface ProjectHistoryState {
  readonly project: Project;
  readonly undoStack: readonly ProjectCommand[];
  readonly redoStack: readonly ProjectCommand[];
}

export type ProjectHistoryAction =
  | { type: 'import-document'; document: ProjectDocument }
  | { type: 'execute'; command: ProjectCommand }
  | {
      type: 'record-page-blank-analysis';
      pageId: string;
      analysis: BlankPageAnalysis;
    }
  | {
      type: 'record-page-orientation-analysis';
      pageId: string;
      analysis: OrientationAnalysis;
    }
  | { type: 'undo' }
  | { type: 'redo' };

export function createProjectHistoryState(
  projectId: string = crypto.randomUUID(),
): ProjectHistoryState {
  if (!projectId.trim()) {
    throw new Error('A project must have an ID.');
  }

  return {
    project: {
      id: projectId,
      documents: new Map(),
      documentOrder: [],
      pages: new Map(),
      pageOrder: [],
    },
    undoStack: [],
    redoStack: [],
  };
}

export function getOrderedProjectDocuments(
  project: Project,
): ProjectDocument[] {
  return project.documentOrder.map((documentId) => {
    const document = project.documents.get(documentId);
    if (!document) {
      throw new Error(`Document "${documentId}" is missing from the project.`);
    }
    return document;
  });
}

export function getOrderedProjectPages(project: Project): ProjectPage[] {
  return project.pageOrder.map((pageId) => {
    const page = project.pages.get(pageId);
    if (!page) {
      throw new Error(`Page "${pageId}" is missing from the project.`);
    }
    return page;
  });
}

export function createDocumentImportCommand(
  project: Project,
  document: ProjectDocument,
): ProjectCommand {
  if (!document.id.trim()) {
    throw new Error('A project document must have an ID.');
  }
  if (!Number.isSafeInteger(document.pageCount) || document.pageCount < 0) {
    throw new Error('A project document must have a valid page count.');
  }
  if (project.documents.has(document.id)) {
    throw new Error(`Document "${document.id}" already exists in the project.`);
  }

  const pages = Array.from({ length: document.pageCount }, (_, index) => ({
    id: `${document.id}:page:${index + 1}`,
    documentId: document.id,
    sourcePageNumber: index + 1,
    rotationDeltaDegrees: 0,
    duplicatedFromPageId: null,
    isDeleted: false,
    blankAnalysis: null,
    blankReviewDecision: null,
    orientationAnalysis: null,
  }));
  const documentIndex = project.documentOrder.length;
  const firstPageIndex = project.pageOrder.length;
  const pageIds = pages.map((page) => page.id);

  return {
    label: 'Importar documento',
    forward: [
      { type: 'insert-document', document, index: documentIndex },
      ...pages.map((page, index) => ({
        type: 'insert-page' as const,
        page,
        index: firstPageIndex + index,
      })),
    ],
    inverse: [
      ...pageIds
        .slice()
        .reverse()
        .map((pageId) => ({ type: 'remove-page' as const, pageId })),
      { type: 'remove-document', documentId: document.id },
    ],
  };
}

export function applyProjectOperations(
  project: Project,
  operations: readonly ProjectOperation[],
): Project {
  if (operations.length === 0) {
    return project;
  }

  const documents = new Map(project.documents);
  const pages = new Map(project.pages);
  const documentOrder = [...project.documentOrder];
  const pageOrder = [...project.pageOrder];

  for (const operation of operations) {
    switch (operation.type) {
      case 'insert-document': {
        const { document, index } = operation;
        if (documents.has(document.id)) {
          throw new Error(`Document "${document.id}" already exists in the project.`);
        }
        assertIndex(index, documentOrder.length);
        documents.set(document.id, document);
        documentOrder.splice(index, 0, document.id);
        break;
      }
      case 'remove-document': {
        const documentIndex = documentOrder.indexOf(operation.documentId);
        if (!documents.has(operation.documentId) || documentIndex < 0) {
          throw new Error(`Document "${operation.documentId}" is not in the project.`);
        }
        if (
          [...pages.values()].some(
            (page) => page.documentId === operation.documentId,
          )
        ) {
          throw new Error('Remove a document only after removing its pages.');
        }
        documents.delete(operation.documentId);
        documentOrder.splice(documentIndex, 1);
        break;
      }
      case 'insert-page': {
        const { page, index } = operation;
        const document = documents.get(page.documentId);
        if (!document) {
          throw new Error(`Document "${page.documentId}" is not in the project.`);
        }
        if (pages.has(page.id)) {
          throw new Error(`Page "${page.id}" already exists in the project.`);
        }
        if (
          !Number.isSafeInteger(page.sourcePageNumber) ||
          page.sourcePageNumber < 1 ||
          page.sourcePageNumber > document.pageCount
        ) {
          throw new Error('A project page has invalid source data.');
        }
        assertRotation(page.rotationDeltaDegrees);
        if (page.duplicatedFromPageId !== null) {
          const sourcePage = pages.get(page.duplicatedFromPageId);
          if (
            !sourcePage ||
            sourcePage.documentId !== page.documentId ||
            sourcePage.sourcePageNumber !== page.sourcePageNumber
          ) {
            throw new Error('A duplicate page must reference its source page.');
          }
        }
        assertIndex(index, pageOrder.length);
        pages.set(page.id, page);
        pageOrder.splice(index, 0, page.id);
        break;
      }
      case 'remove-page': {
        const page = pages.get(operation.pageId);
        if (!page) {
          throw new Error(`Page "${operation.pageId}" is not in the project.`);
        }
        const pageIndex = pageOrder.indexOf(page.id);
        if (pageIndex < 0) {
          throw new Error(`Page "${page.id}" has no position in the project.`);
        }
        if (
          [...pages.values()].some(
            (candidate) => candidate.duplicatedFromPageId === page.id,
          )
        ) {
          throw new Error('Remove duplicated pages before their source page.');
        }
        pages.delete(page.id);
        pageOrder.splice(pageIndex, 1);
        break;
      }
      case 'move-page': {
        const page = pages.get(operation.pageId);
        const currentIndex = pageOrder.indexOf(operation.pageId);
        if (
          !page ||
          page.isDeleted ||
          currentIndex < 0 ||
          page.documentId !== operation.documentId
        ) {
          throw new Error(`Page "${operation.pageId}" cannot be moved.`);
        }

        pageOrder.splice(currentIndex, 1);
        assertIndex(operation.toIndex, pageOrder.length);
        const pageIndexesInDocument = pageOrder.flatMap((pageId, index) =>
          pages.get(pageId)?.documentId === operation.documentId ? [index] : [],
        );
        const firstPageIndex = pageIndexesInDocument[0];
        const lastPageIndex =
          pageIndexesInDocument[pageIndexesInDocument.length - 1];
        if (
          firstPageIndex === undefined ||
          lastPageIndex === undefined ||
          operation.toIndex < firstPageIndex ||
          operation.toIndex > lastPageIndex + 1
        ) {
          throw new Error('Pages can only be moved within their source document.');
        }
        pageOrder.splice(operation.toIndex, 0, operation.pageId);
        break;
      }
      case 'set-page-deleted': {
        const page = pages.get(operation.pageId);
        if (!page) {
          throw new Error(`Page "${operation.pageId}" is not in the project.`);
        }
        pages.set(page.id, { ...page, isDeleted: operation.isDeleted });
        break;
      }
      case 'set-page-rotation': {
        const page = pages.get(operation.pageId);
        if (!page) {
          throw new Error(`Page "${operation.pageId}" is not in the project.`);
        }
        assertRotation(operation.rotationDeltaDegrees);
        pages.set(page.id, {
          ...page,
          rotationDeltaDegrees: operation.rotationDeltaDegrees,
        });
        break;
      }
      case 'set-page-blank-review': {
        const page = pages.get(operation.pageId);
        if (!page) {
          throw new Error(`Page "${operation.pageId}" is not in the project.`);
        }
        pages.set(page.id, {
          ...page,
          blankReviewDecision: operation.decision,
        });
        break;
      }
      default:
        assertNever(operation);
    }
  }

  return {
    ...project,
    documents,
    documentOrder,
    pages,
    pageOrder,
  };
}

export function createMovePageCommand(
  project: Project,
  pageId: string,
  targetPageNumber: number,
): ProjectCommand {
  const page = requireActivePage(project, pageId);
  const orderedPages = getOrderedProjectPages(project);
  const activePages = orderedPages.filter(
    (candidate) =>
      candidate.documentId === page.documentId && !candidate.isDeleted,
  );
  const currentPageNumber = activePages.findIndex(
    (candidate) => candidate.id === page.id,
  );
  if (
    !Number.isSafeInteger(targetPageNumber) ||
    targetPageNumber < 1 ||
    targetPageNumber > activePages.length
  ) {
    throw new Error('The target page position is out of bounds.');
  }
  if (targetPageNumber - 1 === currentPageNumber) {
    return emptyCommand('Mover página');
  }

  const pageOrder = [...project.pageOrder];
  const originalIndex = pageOrder.indexOf(page.id);
  pageOrder.splice(originalIndex, 1);
  const targetPage = activePages[targetPageNumber - 1];
  if (!targetPage) {
    throw new Error('The target page is missing from the project.');
  }
  const targetIndex = pageOrder.indexOf(targetPage.id);
  if (targetIndex < 0) {
    throw new Error(`Page "${targetPage.id}" has no position in the project.`);
  }
  const destinationIndex =
    targetPageNumber - 1 < currentPageNumber ? targetIndex : targetIndex + 1;

  return {
    label: 'Mover página',
    forward: [
      {
        type: 'move-page',
        pageId,
        documentId: page.documentId,
        toIndex: destinationIndex,
      },
    ],
    inverse: [
      {
        type: 'move-page',
        pageId,
        documentId: page.documentId,
        toIndex: originalIndex,
      },
    ],
  };
}

export function createDuplicatePageCommand(
  project: Project,
  pageId: string,
): ProjectCommand {
  const page = requireActivePage(project, pageId);
  const pageIndex = project.pageOrder.indexOf(page.id);
  const duplicate: ProjectPage = {
    ...page,
    id: `${page.documentId}:duplicate:${crypto.randomUUID()}`,
    duplicatedFromPageId: page.id,
    isDeleted: false,
    blankReviewDecision: null,
  };
  return {
    label: 'Duplicar página',
    forward: [{ type: 'insert-page', page: duplicate, index: pageIndex + 1 }],
    inverse: [{ type: 'remove-page', pageId: duplicate.id }],
  };
}

export function createDeletePageCommand(
  project: Project,
  pageId: string,
): ProjectCommand {
  return createPageDeletedCommand(project, pageId, true);
}

export function createRestorePageCommand(
  project: Project,
  pageId: string,
): ProjectCommand {
  return createPageDeletedCommand(project, pageId, false);
}

export function createRotatePageCommand(
  project: Project,
  pageId: string,
  degrees: 90 | 180 | 270 = 90,
): ProjectCommand {
  const page = requireActivePage(project, pageId);
  const rotationDeltaDegrees =
    (page.rotationDeltaDegrees + degrees) % 360;
  return createSetPageRotationsCommand(
    project,
    [{ pageId, rotationDeltaDegrees }],
    'Girar página',
  );
}

export interface PageRotationChange {
  readonly pageId: string;
  readonly rotationDeltaDegrees: number;
}

export function createSetPageRotationsCommand(
  project: Project,
  changes: readonly PageRotationChange[],
  label = 'Girar páginas',
): ProjectCommand {
  const seenPageIds = new Set<string>();
  const forward: ProjectOperation[] = [];
  const inverse: ProjectOperation[] = [];

  for (const change of changes) {
    if (seenPageIds.has(change.pageId)) {
      throw new Error(`Page "${change.pageId}" has multiple rotation changes.`);
    }
    seenPageIds.add(change.pageId);

    const page = requireActivePage(project, change.pageId);
    assertRotation(change.rotationDeltaDegrees);
    if (page.rotationDeltaDegrees === change.rotationDeltaDegrees) {
      continue;
    }
    forward.push({
      type: 'set-page-rotation',
      pageId: change.pageId,
      rotationDeltaDegrees: change.rotationDeltaDegrees,
    });
    inverse.unshift({
      type: 'set-page-rotation',
      pageId: change.pageId,
      rotationDeltaDegrees: page.rotationDeltaDegrees,
    });
  }

  if (forward.length === 0) {
    return emptyCommand(label);
  }

  return {
    label,
    forward,
    inverse,
  };
}

export function createSetBlankReviewDecisionCommand(
  project: Project,
  pageId: string,
  decision: BlankPageReviewDecision | null,
): ProjectCommand {
  const page = requireActivePage(project, pageId);
  if (!page.blankAnalysis || page.blankAnalysis.status === 'content-detected') {
    throw new Error(`Page "${pageId}" has no blank analysis to review.`);
  }
  if (page.blankReviewDecision === decision) {
    return emptyCommand('Revisar página en blanco');
  }

  return {
    label: 'Revisar página en blanco',
    forward: [{ type: 'set-page-blank-review', pageId, decision }],
    inverse: [
      {
        type: 'set-page-blank-review',
        pageId,
        decision: page.blankReviewDecision,
      },
    ],
  };
}

export function projectHistoryReducer(
  state: ProjectHistoryState,
  action: ProjectHistoryAction,
): ProjectHistoryState {
  switch (action.type) {
    case 'import-document': {
      const command = createDocumentImportCommand(state.project, action.document);
      return executeCommand(state, command);
    }
    case 'execute':
      return executeCommand(state, action.command);
    case 'record-page-blank-analysis': {
      const page = state.project.pages.get(action.pageId);
      if (!page) {
        throw new Error(`Page "${action.pageId}" is not in the project.`);
      }
      const pages = new Map(state.project.pages);
      pages.set(page.id, {
        ...page,
        blankAnalysis: action.analysis,
      });
      return {
        ...state,
        project: { ...state.project, pages },
      };
    }
    case 'record-page-orientation-analysis': {
      const page = state.project.pages.get(action.pageId);
      if (!page) {
        throw new Error(`Page "${action.pageId}" is not in the project.`);
      }
      const pages = new Map(state.project.pages);
      pages.set(page.id, {
        ...page,
        orientationAnalysis: action.analysis,
      });
      return {
        ...state,
        project: { ...state.project, pages },
      };
    }
    case 'undo': {
      const command = state.undoStack[state.undoStack.length - 1];
      if (!command) {
        return state;
      }
      return {
        project: applyProjectOperations(state.project, command.inverse),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      };
    }
    case 'redo': {
      const command = state.redoStack[state.redoStack.length - 1];
      if (!command) {
        return state;
      }
      return {
        project: applyProjectOperations(state.project, command.forward),
        undoStack: [...state.undoStack, command],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
    default:
      return assertNever(action);
  }
}

function executeCommand(
  state: ProjectHistoryState,
  command: ProjectCommand,
): ProjectHistoryState {
  if (command.forward.length === 0) {
    return state;
  }
  return {
    project: applyProjectOperations(state.project, command.forward),
    undoStack: [...state.undoStack, command],
    redoStack: [],
  };
}

function createPageDeletedCommand(
  project: Project,
  pageId: string,
  isDeleted: boolean,
): ProjectCommand {
  const page = project.pages.get(pageId);
  if (!page) {
    throw new Error(`Page "${pageId}" is not in the project.`);
  }
  if (page.isDeleted === isDeleted) {
    return emptyCommand(isDeleted ? 'Eliminar página' : 'Restaurar página');
  }

  return {
    label: isDeleted ? 'Eliminar página' : 'Restaurar página',
    forward: [{ type: 'set-page-deleted', pageId, isDeleted }],
    inverse: [{ type: 'set-page-deleted', pageId, isDeleted: !isDeleted }],
  };
}

function requireActivePage(project: Project, pageId: string): ProjectPage {
  const page = project.pages.get(pageId);
  if (!page) {
    throw new Error(`Page "${pageId}" is not in the project.`);
  }
  if (page.isDeleted) {
    throw new Error(`Page "${pageId}" is deleted.`);
  }
  return page;
}

function emptyCommand(label: string): ProjectCommand {
  return { label, forward: [], inverse: [] };
}

function assertRotation(rotationDeltaDegrees: number): void {
  if (
    !Number.isSafeInteger(rotationDeltaDegrees) ||
    rotationDeltaDegrees < 0 ||
    rotationDeltaDegrees >= 360 ||
    rotationDeltaDegrees % 90 !== 0
  ) {
    throw new Error('Page rotation must be a quarter turn from 0 to 270 degrees.');
  }
}

function assertIndex(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > length) {
    throw new Error(`Project insertion index "${index}" is out of bounds.`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project operation: ${JSON.stringify(value)}`);
}
