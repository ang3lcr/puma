import { describe, expect, it } from 'vitest';
import {
  createProjectHistoryState,
  projectHistoryReducer,
  type ProjectDocument,
} from '../store/project-store';
import {
  deserializeProjectHistory,
  isStorageQuotaError,
  migratePersistedProjectRecord,
  serializeProjectHistory,
} from './project-persistence';

function createDocument(): ProjectDocument {
  const file = new File(['private source bytes'], 'source.pdf', {
    type: 'application/pdf',
  });
  return {
    id: 'document-1',
    file,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    pageCount: 1,
    fingerprint: 'pdf-fingerprint',
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

describe('local project persistence', () => {
  it('round-trips project history without storing source files', () => {
    const document = createDocument();
    const history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document,
    });
    const record = serializeProjectHistory(history, 123);
    const restored = deserializeProjectHistory(record.history);

    expect(record.savedAt).toBe(123);
    expect(JSON.stringify(record)).not.toContain('private source bytes');
    expect(record.history.project.documents[0]?.[1]).not.toHaveProperty('file');
    expect(record.history.undoStack[0]?.forward[0]).not.toHaveProperty(
      'document.file',
    );
    expect(restored.project.id).toBe('project-1');
    expect(restored.project.pages.get('document-1:page:1')).toMatchObject({
      documentId: 'document-1',
      sourcePageNumber: 1,
    });
    expect(restored.project.documents.get('document-1')?.file).toBeNull();
    expect(restored.undoStack).toHaveLength(1);

    const undone = projectHistoryReducer(restored, { type: 'undo' });
    expect(undone.project.documents.size).toBe(0);
    expect(undone.redoStack).toHaveLength(1);
    expect(
      projectHistoryReducer(undone, { type: 'redo' }).project.documents.get(
        'document-1',
      )?.file,
    ).toBeNull();
  });

  it('migrates version-zero records with no redo history', () => {
    const history = projectHistoryReducer(createProjectHistoryState('project-1'), {
      type: 'import-document',
      document: createDocument(),
    });
    const versionOne = serializeProjectHistory(history, 456);
    const migrated = migratePersistedProjectRecord({
      schemaVersion: 0,
      savedAt: versionOne.savedAt,
      history: {
        project: versionOne.history.project,
        undoStack: versionOne.history.undoStack,
      },
    });

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.history.redoStack).toEqual([]);
    expect(
      deserializeProjectHistory(migrated.history).project.documents.size,
    ).toBe(1);
  });

  it('keeps a relinked source available when undoing and redoing its import', () => {
    const document = createDocument();
    const file = document.file;
    if (!file) {
      throw new Error('The persistence fixture needs a source file.');
    }
    const restored = deserializeProjectHistory(
      serializeProjectHistory(
        projectHistoryReducer(createProjectHistoryState('project-1'), {
          type: 'import-document',
          document,
        }),
      ).history,
    );
    const relinked = projectHistoryReducer(restored, {
      type: 'attach-document-file',
      documentId: document.id,
      file,
    });

    const redone = projectHistoryReducer(
      projectHistoryReducer(relinked, { type: 'undo' }),
      { type: 'redo' },
    );
    expect(redone.project.documents.get(document.id)?.file).toBe(file);
  });

  it('rejects unknown schema versions and inconsistent page order', () => {
    expect(() =>
      migratePersistedProjectRecord({
        schemaVersion: 99,
        savedAt: 123,
        history: {},
      }),
    ).toThrow('Unsupported project schema version');

    const record = serializeProjectHistory(createProjectHistoryState('project-1'));
    expect(() =>
      deserializeProjectHistory({
        ...record.history,
        project: {
          ...record.history.project,
          pageOrder: ['missing-page'],
        },
      }),
    ).toThrow('saved project page order is inconsistent');
  });

  it('distinguishes quota errors from other storage failures', () => {
    expect(
      isStorageQuotaError(new DOMException('Storage full', 'QuotaExceededError')),
    ).toBe(true);
    expect(isStorageQuotaError(new Error('Storage unavailable'))).toBe(false);
  });
});
