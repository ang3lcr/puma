import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importPdfFile } from './features/documents/pdf-import';
import { PdfImportError } from './features/documents/pdf-import-error';
import App from './App';

vi.mock('./features/documents/pdf-import', () => ({
  importPdfFile: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    estimateSize: () => number;
    getItemKey: (index: number) => string;
  }) => {
    const size = options.estimateSize();
    return {
      scrollToIndex: vi.fn(),
      getTotalSize: () => options.count * size,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          key: options.getItemKey(index),
          size,
          start: index * size,
        })),
    };
  },
}));

describe('Document Studio initial workspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.mocked(importPdfFile).mockReset();
  });

  it('renders the Spanish workspace and local PDF import controls', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Espacio de trabajo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Documentos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Seleccionar PDF' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Seleccionar PDF')).toHaveAttribute(
      'accept',
      'application/pdf,.pdf',
    );
    expect(
      screen.getByText('Los originales permanecen en este dispositivo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Archivos locales');
  });

  it('starts in dark mode and switches theme accessibly', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const shell = container.querySelector('.app-shell');
    const toggle = screen.getByRole('button', {
      name: 'Cambiar a tema claro',
    });

    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);

    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(
      screen.getByRole('button', { name: 'Cambiar a tema oscuro' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks before continuing a potentially memory-intensive full read', async () => {
    const user = userEvent.setup();
    const mockImport = vi.mocked(importPdfFile);
    mockImport.mockImplementation(async (file, options) => {
      const confirmed = await options.confirmFullRead(file.size);
      throw new PdfImportError(
        confirmed ? 'read-failed' : 'full-read-cancelled',
      );
    });

    render(<App />);
    await user.upload(
      screen.getByLabelText('Seleccionar PDF'),
      new File(['abc'], 'large.pdf', { type: 'application/pdf' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Lectura extensa del PDF',
    });
    expect(dialog).toHaveTextContent('3 B');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Se canceló la lectura porque el PDF requería acceder a casi todo el archivo.',
    );
  });

  it('adds multiple PDFs to one editable combined project', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element): void {
          this.callback(
            [
              {
                target,
                contentRect: { width: 1200, height: 1200 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const user = userEvent.setup();
    const mockImport = vi.mocked(importPdfFile);
    mockImport.mockImplementation(async (file) => ({
      id: file.name,
      file,
      fileName: file.name,
      size: file.size,
      lastModified: file.lastModified,
      pageCount: 1,
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
      session: {
        document: {
          numPages: 1,
          getPage: vi.fn().mockRejectedValue(new Error('thumbnail stub')),
        } as never,
        loadingTask: { destroy: async () => undefined } as never,
      },
    }));

    render(<App />);
    const input = screen.getByLabelText('Seleccionar PDF');
    await user.upload(input, [
      new File(['first'], 'first.pdf', { type: 'application/pdf' }),
      new File(['second'], 'second.pdf', { type: 'application/pdf' }),
    ]);

    expect(await screen.findByRole('button', { name: /first\.pdf/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /second\.pdf/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Agregar otro PDF' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('region', { name: 'Combinación y preservación' }),
    ).toBeInTheDocument();
    const thumbnailRegion = document.querySelector('.thumbnail-scroll');
    expect(thumbnailRegion).not.toBeNull();
    await waitFor(() =>
      expect(thumbnailRegion?.querySelectorAll('.thumbnail-card')).toHaveLength(2),
    );
    const [firstThumbnail, secondThumbnail] =
      thumbnailRegion!.querySelectorAll('.thumbnail-card');
    expect(secondThumbnail).toHaveClass('is-source-selected');
    await user.click(screen.getByRole('button', { name: /first\.pdf/ }));
    await waitFor(() =>
      expect(firstThumbnail).toHaveClass('is-source-selected'),
    );
    expect(secondThumbnail).not.toHaveClass('is-source-selected');
    expect(mockImport).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(input).toBeEnabled());
  });
});
