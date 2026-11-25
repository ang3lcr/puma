import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('Document Studio initial workspace', () => {
  it('renders the Spanish document workspace and local empty states', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Espacio de trabajo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Documentos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('La importación estará disponible en la Etapa 2.'),
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
});
