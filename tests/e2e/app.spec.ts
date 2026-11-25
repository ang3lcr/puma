import { expect, test } from '@playwright/test';
import { createMinimalPdf } from '../fixtures/minimal-pdf';
import { createManyPagesPdf } from '../fixtures/many-pages-pdf';
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
  await expect(page.locator('.statusbar')).toContainText('Archivos locales');
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

  await expect(page.locator('.document-properties')).toContainText('local.pdf');
  await expect(page.getByText('Fixture document')).toBeVisible();
  await expect(page.getByText('Local test')).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('1 páginas');
  await expect(page.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  await expect(page.locator('.page-properties')).toContainText(
    '215,9 × 279,4 mm',
  );
  await expect(page.locator('.page-properties')).toContainText('0°');
  await expect(page.locator('canvas[aria-label="Página 1"]')).toBeVisible();
  const viewerCanvas = page.locator('.viewer-canvas-scroll canvas');
  await expect(viewerCanvas).toBeVisible();
  await expect
    .poll(() =>
      viewerCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0),
    )
    .toBe(true);

  const zoomLevel = page.locator('.viewer-zoom-value');
  const initialZoom = await zoomLevel.textContent();
  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(zoomLevel).not.toHaveText(initialZoom ?? '');
  await page.getByRole('button', { name: 'Ajustar página al área' }).click();

  const pageNumberInput = page.getByRole('spinbutton', {
    name: 'Número de página',
  });
  await pageNumberInput.fill('2');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.document-list-item')).toHaveCount(1);
  await pageNumberInput.fill('2');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Escribe un número de página entre 1 y 1.',
  );
  await expect(pageNumberInput).toHaveValue('2');
  await pageNumberInput.fill('1');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Metadatos del documento' })).toBeVisible();
  await expect
    .poll(() =>
      viewerCanvas.evaluate((canvas: HTMLCanvasElement) => {
        const viewport = canvas.closest('.viewer-canvas-scroll');
        if (!viewport) {
          return false;
        }
        const bounds = canvas.getBoundingClientRect();
        return (
          bounds.width <= viewport.clientWidth &&
          bounds.height <= viewport.clientHeight
        );
      }),
    )
    .toBe(true);
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
  await expect(page.locator('.document-properties')).toContainText('local.pdf');

  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'second.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });
  await expect(page.locator('.document-properties')).toContainText('second.pdf');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.document-list-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rehacer' })).toBeEnabled();
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.locator('.document-list-item')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.document-list-item')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.document-list-item')).toHaveCount(2);
  await page.locator('.document-list-item').first().click();
  await expect(page.locator('.document-properties')).toContainText('local.pdf');
  await expect(page.locator('canvas[aria-label="Página 1"]')).toBeVisible();

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('reorders, duplicates, rotates, deletes, and restores project pages', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'page-operations.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });
  await expect(page.locator('.statusbar')).toContainText('1 páginas');

  await page.getByRole('button', { name: 'Duplicar página' }).click();
  await expect(page.locator('.statusbar')).toContainText('2 páginas');
  await page
    .getByRole('button', { name: 'Girar página 90° a la derecha' })
    .click();
  await expect(page.locator('.page-properties')).toContainText('90°');
  await page.getByRole('button', { name: 'Mover página arriba' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Número de página' }),
  ).toHaveValue('1');

  await page.getByRole('button', { name: 'Eliminar página' }).click();
  await expect(page.locator('.statusbar')).toContainText('1 páginas');
  await expect(page.locator('.thumbnail-card-deleted')).toHaveCount(1);
  await page.getByRole('button', { name: 'Restaurar 1' }).click();
  await expect(page.locator('.statusbar')).toContainText('2 páginas');
  await expect(page.locator('.page-properties')).toContainText('90°');

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.statusbar')).toContainText('1 páginas');
  await expect(page.locator('.thumbnail-card-deleted')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.locator('.statusbar')).toContainText('2 páginas');
  await expect(page.locator('.thumbnail-card-deleted')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('virtualizes long documents and renders thumbnails on demand', async ({
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
    name: 'many-pages.pdf',
    mimeType: 'application/pdf',
    buffer: createManyPagesPdf(1000),
  });

  await expect(page.locator('.statusbar')).toContainText('1000 páginas');
  await expect(page.locator('canvas[aria-label="Página 1"]')).toBeVisible();
  expect(await page.locator('.thumbnail-virtual-row').count()).toBeLessThan(12);

  const pageNumberInput = page.getByRole('spinbutton', {
    name: 'Número de página',
  });
  await pageNumberInput.fill('1000');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  const viewerCanvas = page.locator('.viewer-canvas-scroll canvas');
  await expect(viewerCanvas).toHaveAttribute(
    'aria-label',
    /1000 de 1000/,
  );
  await expect(
    page.getByRole('button', { name: 'Seleccionar página 1000' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      viewerCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0),
    )
    .toBe(true);

  await page.locator('.viewer-canvas-scroll').focus();
  await page.locator('.viewer-canvas-scroll').press('ArrowLeft');
  await expect(pageNumberInput).toHaveValue('999');
  await page.getByRole('button', { name: 'Seleccionar página 1000' }).click();
  await expect(pageNumberInput).toHaveValue('1000');
  await pageNumberInput.fill('1');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  await expect(pageNumberInput).toHaveValue('1');

  await page
    .locator('.thumbnail-scroll')
    .evaluate((element: HTMLDivElement) => {
      element.scrollTop = element.scrollHeight;
    });
  const lastThumbnail = page.locator('canvas[aria-label="Página 1000"]');
  await expect(lastThumbnail).toBeVisible();
  await expect
    .poll(() =>
      lastThumbnail.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0),
    )
    .toBe(true);
  expect(await page.locator('.thumbnail-virtual-row').count()).toBeLessThan(12);
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

  await expect(page.locator('.document-properties')).toContainText(
    'protected.pdf',
  );
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
