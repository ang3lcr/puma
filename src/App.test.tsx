import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importPdfFile } from './features/documents/pdf-import';
import { PdfImportError } from './features/documents/pdf-import-error';
import App from './App';

vi.mock('./features/documents/pdf-import', () => ({
  importPdfFile: vi.fn(),
}));

describe('Document Studio initial workspace', () => {
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
});
