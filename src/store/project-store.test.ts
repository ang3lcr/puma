import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from './project-store';
import {
  createSetBlankReviewDecisionCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createMovePageCommand,
  createProjectHistoryState,
  createRestorePageCommand,
  createRotatePageCommand,
  createSetPageCropBoxCommand,
  createSetPageRotationsCommand,
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
      cropBox: null,
      duplicatedFromPageId: null,
      isDeleted: false,
      blankAnalysis: null,
      blankReviewDecision: null,
      orientationAnalysis: null,
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

  it('moves pages in the combined sequence and restores the previous order', () => {
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

  it('moves pages across source documents in the combined order without changing their source', () => {
    let history = createProjectHistoryState('project-1');
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-1', 2),
    });
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-2', 1),
    });
    const originalOrder = [
      'document-1:page:1',
      'document-1:page:2',
      'document-2:page:1',
    ];
    const command = createMovePageCommand(
      history.project,
      'document-2:page:1',
      2,
    );
    history = projectHistoryReducer(history, { type: 'execute', command });

    expect(history.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-2:page:1',
      'document-1:page:2',
    ]);
    expect(history.project.pages.get('document-2:page:1')).toMatchObject({
      documentId: 'document-2',
      sourcePageNumber: 1,
    });

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pageOrder).toEqual(originalOrder);
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pageOrder).toEqual([
      'document-1:page:1',
      'document-2:page:1',
      'document-1:page:2',
    ]);
  });

  it('rejects a move operation that misidentifies a page source', () => {
    let history = createProjectHistoryState('project-1');
    history = projectHistoryReducer(history, {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    expect(() =>
      projectHistoryReducer(history, {
        type: 'execute',
        command: {
          label: 'Mover página',
          forward: [
            {
              type: 'move-page',
              pageId: 'document-1:page:1',
              documentId: 'not-the-source',
              toIndex: 0,
            },
          ],
          inverse: [],
        },
      }),
    ).toThrow('Page "document-1:page:1" cannot be moved.');
  });

  it('records blank analysis outside undo history and keeps review decisions reversible', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    const analysis = {
      status: 'likely-blank' as const,
      reason: 'no-visible-content' as const,
      confidence: 0.99,
      foregroundPixelCount: 0,
      foregroundPixelRatio: 0,
    };
    history = projectHistoryReducer(history, {
      type: 'record-page-blank-analysis',
      pageId: 'document-1:page:1',
      analysis,
    });
    expect(history.undoStack).toHaveLength(1);

    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createSetBlankReviewDecisionCommand(
        history.project,
        'document-1:page:1',
        'confirmed-blank',
      ),
    });
    expect(
      history.project.pages.get('document-1:page:1')?.blankReviewDecision,
    ).toBe('confirmed-blank');
    expect(history.project.pages.get('document-1:page:1')?.isDeleted).toBe(
      false,
    );

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(
      history.project.pages.get('document-1:page:1')?.blankReviewDecision,
    ).toBeNull();
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(
      history.project.pages.get('document-1:page:1')?.blankReviewDecision,
    ).toBe('confirmed-blank');

    history = projectHistoryReducer(history, {
      type: 'record-page-blank-analysis',
      pageId: 'document-1:page:1',
      analysis: { ...analysis, confidence: 0.98 },
    });
    expect(
      history.project.pages.get('document-1:page:1')?.blankReviewDecision,
    ).toBe('confirmed-blank');
    expect(history.undoStack).toHaveLength(2);
  });

  it('applies selected page rotations as one reversible command', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 3),
    });
    const command = createSetPageRotationsCommand(
      history.project,
      [
        { pageId: 'document-1:page:1', rotationDeltaDegrees: 90 },
        { pageId: 'document-1:page:3', rotationDeltaDegrees: 270 },
      ],
      'Corregir páginas seleccionadas',
    );
    history = projectHistoryReducer(history, { type: 'execute', command });

    expect(history.undoStack).toHaveLength(2);
    expect(history.project.pages.get('document-1:page:1')?.rotationDeltaDegrees)
      .toBe(90);
    expect(history.project.pages.get('document-1:page:2')?.rotationDeltaDegrees)
      .toBe(0);
    expect(history.project.pages.get('document-1:page:3')?.rotationDeltaDegrees)
      .toBe(270);

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(
      history.project.pages.get('document-1:page:1')?.rotationDeltaDegrees,
    ).toBe(0);
    expect(
      history.project.pages.get('document-1:page:3')?.rotationDeltaDegrees,
    ).toBe(0);
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(
      history.project.pages.get('document-1:page:3')?.rotationDeltaDegrees,
    ).toBe(270);
  });

  it('applies CropBox changes as reversible page commands and duplicates them', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    const cropBox = {
      xMin: 12,
      yMin: 18,
      xMax: 600,
      yMax: 780,
    };
    history = projectHistoryReducer(history, {
      type: 'execute',
      command: createSetPageCropBoxCommand(
        history.project,
        'document-1:page:1',
        cropBox,
      ),
    });
    expect(history.project.pages.get('document-1:page:1')?.cropBox).toEqual(
      cropBox,
    );

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
    expect(history.project.pages.get(duplicateId)?.cropBox).toEqual(cropBox);

    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pages.get(duplicateId)).toBeUndefined();
    history = projectHistoryReducer(history, { type: 'undo' });
    expect(history.project.pages.get('document-1:page:1')?.cropBox).toBeNull();
    history = projectHistoryReducer(history, { type: 'redo' });
    expect(history.project.pages.get('document-1:page:1')?.cropBox).toEqual(
      cropBox,
    );
  });

  it('rejects invalid CropBox dimensions without changing project history', () => {
    const history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });

    expect(() =>
      createSetPageCropBoxCommand(
        history.project,
        'document-1:page:1',
        { xMin: 10, yMin: 10, xMax: 10, yMax: 20 },
      ),
    ).toThrow('The page CropBox must have finite, positive dimensions.');
    expect(history.undoStack).toHaveLength(1);
  });

  it('records orientation analysis outside undo history', () => {
    let history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument('document-1', 1),
    });
    const analysis = {
      status: 'suggestion' as const,
      reason: 'digital-text-direction' as const,
      targetRotationDeltaDegrees: 180,
    };

    history = projectHistoryReducer(history, {
      type: 'record-page-orientation-analysis',
      pageId: 'document-1:page:1',
      analysis,
    });

    expect(
      history.project.pages.get('document-1:page:1')?.orientationAnalysis,
    ).toEqual(analysis);
    expect(history.undoStack).toHaveLength(1);
  });
});
