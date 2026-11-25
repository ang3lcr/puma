import type { ImportedPdf } from '../features/documents/pdf-import-types';

export type ProjectDocument = Omit<ImportedPdf, 'session'>;

export interface ProjectPage {
  readonly id: string;
  readonly documentId: string;
  readonly sourcePageNumber: number;
  readonly rotationDeltaDegrees: number;
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
          page.sourcePageNumber > document.pageCount ||
          !Number.isFinite(page.rotationDeltaDegrees)
        ) {
          throw new Error('A project page has invalid source data.');
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
        pages.delete(page.id);
        pageOrder.splice(pageIndex, 1);
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
  return {
    project: applyProjectOperations(state.project, command.forward),
    undoStack: [...state.undoStack, command],
    redoStack: [],
  };
}

function assertIndex(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > length) {
    throw new Error(`Project insertion index "${index}" is out of bounds.`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project operation: ${JSON.stringify(value)}`);
}
