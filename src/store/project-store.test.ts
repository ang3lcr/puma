import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from './project-store';
import { createProjectHistoryState, projectHistoryReducer } from './project-store';

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
});
