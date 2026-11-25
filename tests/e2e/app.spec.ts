import { expect, test } from '@playwright/test';
import { createMinimalPdf } from '../fixtures/minimal-pdf';
import { createPasswordProtectedPdf } from '../fixtures/password-protected-pdf';

test('initial workspace is usable and makes no external network requests', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL must be configured.');
  }

  const applicationOrigin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin !== applicationOrigin
    ) {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Espacio de trabajo' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Archivos locales');
  await expect(
    page.getByRole('button', { name: 'Cambiar a tema claro' }),
  ).toBeVisible();

  const csp = response?.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');

  await page.getByRole('button', { name: 'Cambiar a tema claro' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('imports PDF metadata locally and reports invalid PDF files', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL must be configured.');
  }

  const applicationOrigin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin !== applicationOrigin
    ) {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'local.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });

  await expect(page.getByRole('heading', { name: 'local.pdf' })).toBeVisible();
  await expect(page.getByText('Fixture document')).toBeVisible();
  await expect(page.getByText('Local test')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('1 páginas');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Metadatos del documento' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'invalid.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText(
    'El archivo no parece ser un PDF válido.',
  );
  await expect(page.getByRole('heading', { name: 'local.pdf' })).toBeVisible();

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('prompts for an encrypted PDF password and allows cancellation', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL must be configured.');
  }

  const applicationOrigin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin !== applicationOrigin
    ) {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'protected.pdf',
    mimeType: 'application/pdf',
    buffer: createPasswordProtectedPdf(),
  });

  const passwordDialog = page.getByRole('dialog', { name: 'PDF protegido' });
  await expect(passwordDialog).toBeVisible();
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Abrir documento' }).click();
  await expect(passwordDialog).toContainText(
    'La contraseña no es correcta. Inténtalo de nuevo.',
  );
  await page.getByLabel('Contraseña').fill('secret');
  await page.getByRole('button', { name: 'Abrir documento' }).click();

  await expect(page.getByRole('heading', { name: 'protected.pdf' })).toBeVisible();
  await expect(page.getByText('Protegido con contraseña')).toBeVisible();
  await expect(
    page
      .locator('.metadata-row')
      .filter({ hasText: 'Protegido con contraseña' }),
  ).toContainText('Detectado');

  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'cancelled.pdf',
    mimeType: 'application/pdf',
    buffer: createPasswordProtectedPdf(),
  });
  await expect(passwordDialog).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Se canceló la lectura protegida con contraseña.',
  );

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
