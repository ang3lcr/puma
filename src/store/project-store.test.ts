import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from './project-store';
import {
  createDeletePageCommand,
  createDuplicatePageCommand,
  createMovePageCommand,
  createProjectHistoryState,
  createRestorePageCommand,
  createRotatePageCommand,
  projectHistoryReducer,
} from './project-store';

function createDocument(
  id: string,
  pageCount: number,
): ProjectDocument {
  const file = new File(['source'], `${id}.pdf`, {
    type: 'application/pdf',
  });
  return {
    id,
    file,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    pageCount,
    fingerprint: null,
    metadata: {
      title: null,
      author: null,
      subject: null,
      creator: null,
      producer: null,
      pdfVersion: null,
      creationDate: null,
      modificationDate: null,
      encrypted: false,
      hasForms: false,
      hasSignatures: false,
    },
  };
}

describe('project history', () => {
  it('creates stable page records and undoes/redoes an imported document', () => {
    const initial = createProjectHistoryState('project-1');
    const document = createDocument('document-1', 2);
    const imported = projectHistoryReducer(initial, {
      type: 'import-document',
      document,
    });

    expect(initial.project.documents.size).toBe(0);
    expect(imported.project.documentOrder).toEqual(['document-1']);
    expect(imported.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-1:page:2',
    ]);
    expect(imported.project.pages.get('document-1:page:2')).toEqual({
      id: 'document-1:page:2',
      documentId: 'document-1',
      sourcePageNumber: 2,
      rotationDeltaDegrees: 0,
      duplicatedFromPageId: null,
      isDeleted: false,
    });

    const undone = projectHistoryReducer(imported, { type: 'undo' });
    expect(undone.project.documents.size).toBe(0);
    expect(undone.project.pages.size).toBe(0);
    expect(undone.undoStack).toHaveLength(0);
    expect(undone.redoStack).toHaveLength(1);

    const redone = projectHistoryReducer(undone, { type: 'redo' });
    expect(redone.project.documents.get('document-1')?.file).toBe(document.file);
    expect(redone.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-1:page:2',
    ]);
    expect(redone.undoStack).toHaveLength(1);
    expect(redone.redoStack).toHaveLength(0);
  });

  it('clears the redo branch when a new import is executed', () => {
    let history = createProjectHistoryState('project-1');
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    history = projectHistoryReducer(history, {
      type: 'undo',
    });
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-2', 0),
    });

    expect(history.project.documentOrder).toEqual(['document-2']);
    expect(history.project.pageOrder).toEqual([]);
    expect(history.undoStack).toHaveLength(1);
    expect(history.redoStack).toHaveLength(0);
  });

  it('moves pages within their source document and restores the previous order', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 3),
    });
    const command = createMovePageCommand(
      history.project,
      'document-1:page:1',
      3,
    );
    history = projectHistoryReducer(history, { type: 'execute', command });

    expect(history.project.pageOrder).toEqual([
      'document-1:page:2',
      'document-1:page:3',
      'document-1:page:1',
    ]);

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-1:page:2',
      'document-1:page:3',
    ]);
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pageOrder[0]).toBe('document-1:page:2');
  });

  it('moves around deleted pages without changing their relative positions', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 3),
    });
    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createDeletePageCommand(
        history.project,
        'document-1:page:2',
      ),
    });
    expect(() =>
      projectHistoryReducer(history, {
        type: 'execute',
        command: {
          label: 'Mover página eliminada',
          forward: [
            {
              type: 'move-page',
              pageId: 'document-1:page:2',
              documentId: 'document-1',
              toIndex: 0,
            },
          ],
          inverse: [],
        },
      }),
    ).toThrow('Page "document-1:page:2" cannot be moved.');
    const originalOrder = history.project.pageOrder;
    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createMovePageCommand(
        history.project,
        'document-1:page:3',
        1,
      ),
    });

    expect(history.project.pageOrder).toEqual([
      'document-1:page:3',
      'document-1:page:1',
      'document-1:page:2',
    ]);
    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pageOrder).toEqual(originalOrder);
  });

  it('duplicates, rotates, deletes, and restores pages through reversible commands', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    const duplicateCommand = createDuplicatePageCommand(
      history.project,
      'document-1:page:1',
    );
    const duplicateOperation = duplicateCommand.forward[0];
    if (!duplicateOperation || duplicateOperation.type !== 'insert-page') {
      throw new Error('The duplicate command did not insert its page.');
    }
    const duplicateId = duplicateOperation.page.id;
    history = projectHistoryReducer(history, {
      type: 'execute',
      command: duplicateCommand,
    });
    expect(history.project.pages.get(duplicateId)).toMatchObject({
      sourcePageNumber: 1,
      duplicatedFromPageId: 'document-1:page:1',
      isDeleted: false,
    });

    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createRotatePageCommand(history.project, duplicateId),
    });
    expect(history.project.pages.get(duplicateId)?.rotationDeltaDegrees).toBe(90);

    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createDeletePageCommand(history.project, duplicateId),
    });
    expect(history.project.pages.get(duplicateId)?.isDeleted).toBe(true);

    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createRestorePageCommand(history.project, duplicateId),
    });
    expect(history.project.pages.get(duplicateId)?.isDeleted).toBe(false);

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pages.get(duplicateId)?.isDeleted).toBe(true);
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pages.get(duplicateId)?.isDeleted).toBe(false);

    history = projectHistoryReducer(history, { type: 'undo' });
    history = projectHistoryReducer(history, { type: 'undo' });
    history = projectHistoryReducer(history, { type: 'undo' });
    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pages.get(duplicateId)).toBeUndefined();
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pages.get(duplicateId)?.rotationDeltaDegrees).toBe(0);
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pages.get(duplicateId)?.rotationDeltaDegrees).toBe(90);
  });

  it('rejects a page move across source documents without changing project state', () => {
    let history = createProjectHistoryState('project-1');
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-2', 1),
    });
    const invalidMove = {
      label: 'Mover entre documentos',
      forward: [
        {
          type: 'move-page' as const,
          pageId: 'document-1:page:1',
          documentId: 'document-1',
          toIndex: 1,
        },
      ],
      inverse: [],
    };

    expect(() =>
      projectHistoryReducer(history, {
        type: 'execute',
        command: invalidMove,
      }),
    ).toThrow('Pages can only be moved within their source document.');
    expect(history.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-2:page:1',
    ]);
  });
});
