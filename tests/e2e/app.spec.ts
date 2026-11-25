import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createMinimalPdf } from '../fixtures/minimal-pdf';
import { createManyPagesPdf } from '../fixtures/many-pages-pdf';
import { createPasswordProtectedPdf } from '../fixtures/password-protected-pdf';
import { createBlankAndTextPdf } from '../fixtures/blank-and-text-pdf';
import { createOrientationPdf } from '../fixtures/orientation-pdf';
import { createCropBoxPdf } from '../fixtures/crop-box-pdf';

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

test('autosaves project edits, restores history, and relinks PDF sources', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'recovery.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });
  await expect(page.locator('.page-properties')).toContainText('0°');
  await page.getByRole('button', { name: 'Guardar ahora' }).click();
  await expect(page.locator('.persistence-panel')).toContainText(
    'Último guardado:',
  );
  await page
    .getByRole('button', { name: 'Girar página 90° a la derecha' })
    .click();
  await expect(page.locator('.page-properties')).toContainText('90°');
  await expect(page.locator('.persistence-panel')).toContainText(
    'Cambios pendientes de guardar',
  );
  await expect(page.locator('.persistence-panel')).toContainText(
    'Último guardado:',
  );

  await page.reload();
  await expect(page.locator('.document-list-item')).toHaveCount(1);
  await expect(page.locator('.recovery-panel')).toContainText(
    'faltan 1 archivos PDF de origen',
  );
  await expect(page.locator('.page-properties')).toHaveCount(0);

  await page.getByLabel('Seleccionar archivos para recuperar').setInputFiles({
    name: 'other.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });
  await expect(page.getByRole('alert')).toContainText(
    'No se encontró una fuente pendiente',
  );
  await expect(page.locator('.recovery-panel')).toBeVisible();

  await page.getByLabel('Seleccionar archivos para recuperar').setInputFiles({
    name: 'recovery.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });
  await expect(page.locator('.page-properties')).toContainText('90°');
  await expect(page.locator('.recovery-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.page-properties')).toContainText('0°');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.locator('.page-properties')).toContainText('90°');
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

test('edits page margins as a reversible CropBox and previews the excluded area', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'crop.pdf',
    mimeType: 'application/pdf',
    buffer: createCropBoxPdf(),
  });

  await expect(page.locator('.page-properties')).toContainText(
    '381 × 508 mm',
  );
  const top = page.getByRole('spinbutton', { name: 'Superior (mm)' });
  const right = page.getByRole('spinbutton', { name: 'Derecho (mm)' });
  const bottom = page.getByRole('spinbutton', { name: 'Inferior (mm)' });
  const left = page.getByRole('spinbutton', { name: 'Izquierdo (mm)' });
  await expect(top).toHaveValue('0');
  await expect(
    page.getByRole('button', { name: 'Aplicar CropBox al proyecto' }),
  ).toBeDisabled();
  await expect(page.locator('.crop-preview-overlay')).toBeVisible();
  await expect(page.locator('.crop-preview-shade')).toHaveCount(0);

  await top.fill('25.4');
  await right.fill('12.7');
  await bottom.fill('10');
  await left.fill('15.2');
  await page.getByRole('button', { name: 'Aplicar CropBox al proyecto' }).click();
  await expect(page.locator('.crop-preview-overlay')).toBeVisible();
  await expect(page.locator('.thumbnail-crop-label')).toHaveText(
    'CropBox ajustada',
  );
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeEnabled();

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.crop-preview-overlay')).toBeVisible();
  await expect(page.locator('.crop-preview-shade')).toHaveCount(0);
  await expect(top).toHaveValue('0');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.locator('.crop-preview-overlay')).toBeVisible();

  await page.getByRole('button', { name: 'Girar página 90° a la derecha' }).click();
  await expect(top).toHaveValue('15.2');
  await expect(right).toHaveValue('25.4');
  await expect(bottom).toHaveValue('12.7');
  await expect(left).toHaveValue('10');

  await page.getByRole('button', { name: 'Restaurar área original' }).click();
  await expect(page.locator('.crop-preview-overlay')).toBeVisible();
  await expect(page.locator('.crop-preview-shade')).toHaveCount(0);
  await expect(top).toHaveValue('0');

  await top.fill('300');
  await bottom.fill('300');
  await expect(page.getByRole('alert')).toContainText(
    'Los márgenes deben dejar un área visible mayor que cero.',
  );
  await expect(
    page.getByRole('button', { name: 'Aplicar CropBox al proyecto' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(top).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('crops a page by dragging a guide and supports keyboard adjustment', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'crop-drag.pdf',
    mimeType: 'application/pdf',
    buffer: createCropBoxPdf(),
  });
  const top = page.getByRole('spinbutton', { name: 'Superior (mm)' });
  await page
    .getByRole('button', { name: 'Girar página 90° a la derecha' })
    .click();
  await expect(page.locator('.page-properties')).toContainText('90°');
  const topHandle = page.getByRole('slider', {
    name: 'Línea de recorte superior',
  });
  await expect(topHandle).toBeVisible();
  await expect(top).toHaveValue('0');

  const bounds = await topHandle.boundingBox();
  if (!bounds) {
    throw new Error('The top crop guide is not positioned.');
  }
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 24);
  await page.mouse.up();

  await expect(top).not.toHaveValue('0');
  const draggedMargin = Number(await top.inputValue());
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(top).toHaveValue('0');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(top).toHaveValue(String(draggedMargin));

  await topHandle.focus();
  await topHandle.press('ArrowDown');
  await expect(top).not.toHaveValue(String(draggedMargin));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar PDF combinado' }).click();
  const download = await downloadPromise;
  await expect(page.locator('.export-status')).toContainText(
    'PDF validado y descargado (1 páginas).',
  );
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('The exported PDF was not written to a download file.');
  }
  const exportedPdf = await PDFDocument.load(await readFile(downloadPath));
  expect(exportedPdf.getPageCount()).toBe(1);
  expect(exportedPdf.getPage(0).getRotation().angle).toBe(90);
  expect(exportedPdf.getPage(0).getCropBox().width).toBeLessThan(540);
  expect(pageErrors).toEqual([]);
});

test('composes pages across source PDFs and explains preservation limits', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles([
    {
      name: 'source-a.pdf',
      mimeType: 'application/pdf',
      buffer: createManyPagesPdf(2),
    },
    {
      name: 'source-b.pdf',
      mimeType: 'application/pdf',
      buffer: createCropBoxPdf(),
    },
  ]);
  await expect(page.locator('.statusbar')).toContainText('3 páginas');
  await expect(page.locator('.document-list-item')).toHaveCount(2);

  const notice = page.getByRole('region', {
    name: 'Combinación y preservación',
  });
  await expect(notice).toContainText(
    'Cada página conserva su archivo y número de origen',
  );
  await expect(notice).toContainText(
    'El PDF combinado se valida antes de descargarlo',
  );
  await expect(notice).toContainText(
    'No se garantiza conservar formularios interactivos',
  );

  const sequencePosition = page.locator('.viewer-sequence-position');
  await expect(sequencePosition).toContainText('3 / 3');
  await page
    .getByRole('button', { name: 'Mover página arriba en la combinación' })
    .click();
  await expect(sequencePosition).toContainText('2 / 3');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(sequencePosition).toContainText('3 / 3');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(sequencePosition).toContainText('2 / 3');

  await page.getByRole('button', { name: /source-a\.pdf/ }).click();
  await expect(sequencePosition).toContainText('1 / 3');
  await page.getByRole('button', { name: 'Seleccionar página 2' }).click();
  await expect(sequencePosition).toContainText('3 / 3');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar PDF combinado' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('The exported PDF was not written to a download file.');
  }
  const exportedPdf = await PDFDocument.load(await readFile(downloadPath));
  expect(exportedPdf.getPageCount()).toBe(3);
  expect(exportedPdf.getPage(1).getCropBox().width).toBe(540);
  expect(exportedPdf.getPage(1).getCropBox().height).toBe(720);
  expect(pageErrors).toEqual([]);
});

test('cancels PDF export without starting a download', async ({ page }) => {
  let downloadStarted = false;
  page.on('download', () => {
    downloadStarted = true;
  });

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'export-cancellation.pdf',
    mimeType: 'application/pdf',
    buffer: createMinimalPdf(),
  });

  await page.getByRole('button', { name: 'Exportar PDF combinado' }).click();
  await page.getByRole('button', { name: 'Cancelar exportación' }).click();
  await expect(page.locator('.export-status')).toContainText(
    'Exportación cancelada; no se descargó ningún PDF.',
  );
  expect(downloadStarted).toBe(false);
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

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar PDF combinado' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('The exported PDF was not written to a download file.');
  }
  const exportedPdf = await PDFDocument.load(await readFile(downloadPath));
  expect(exportedPdf.getPageCount()).toBe(2);
  expect(exportedPdf.getPage(0).getRotation().angle).toBe(90);
  expect(exportedPdf.getPage(1).getRotation().angle).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('analyzes blank-page candidates and requires explicit review', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'blank-and-text.pdf',
    mimeType: 'application/pdf',
    buffer: createBlankAndTextPdf(),
  });
  await page.getByRole('button', { name: 'Analizar páginas en blanco' }).click();
  await expect(page.locator('.blank-scan-status')).toContainText(
    'Análisis terminado; revisa las etiquetas de las miniaturas.',
  );
  await expect(page.locator('.statusbar')).toContainText('3 páginas');

  const review = page.getByRole('region', {
    name: 'Detección de páginas en blanco',
  });
  await expect(review).toContainText('Posible página en blanco');
  await expect(review).toContainText(
    'No calibrada; falta un corpus etiquetado.',
  );
  await page.getByRole('button', { name: 'Confirmar como vacía' }).click();
  await expect(review).toContainText('Confirmada como página en blanco');
  await expect(page.locator('.statusbar')).toContainText('3 páginas');

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar como vacía' })).toBeVisible();
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(review).toContainText('Confirmada como página en blanco');

  await page.getByRole('button', { name: 'Seleccionar página 2' }).click();
  await expect(review).toContainText('Se detectó contenido');
  await expect(review).toContainText('Se detectaron píxeles visibles.');
  await page.getByRole('button', { name: 'Seleccionar página 3' }).click();
  await expect(review).toContainText('Posible página en blanco');
  await expect(review).toContainText('No se detectó contraste visual en la página.');
  expect(pageErrors).toEqual([]);
});

test('suggests digital-text orientation and applies manual and batch corrections', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Seleccionar PDF').setInputFiles({
    name: 'orientation.pdf',
    mimeType: 'application/pdf',
    buffer: createOrientationPdf(),
  });
  await page.getByRole('button', { name: 'Analizar orientación' }).click();
  await expect(page.locator('.orientation-scan-status')).toContainText(
    'Análisis terminado; revisa las sugerencias.',
  );
  await expect(page.locator('.statusbar')).toContainText('6 páginas');

  const orientationReview = page.getByRole('region', {
    name: 'Análisis de orientación',
  });
  await expect(orientationReview).toContainText(
    'La orientación del texto está alineada.',
  );
  await page.getByRole('button', { name: 'Seleccionar página 2' }).click();
  await expect(orientationReview).toContainText(
    'Giro sugerido: 90° a la derecha.',
  );
  await page.getByRole('button', { name: 'Aplicar sugerencia de giro' }).click();
  await expect(orientationReview).toContainText(
    'La orientación sugerida ya está aplicada.',
  );
  await expect(page.locator('.page-properties')).toContainText('90°');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.page-properties')).toContainText('0°');

  await page
    .getByRole('checkbox', {
      name: 'Seleccionar página para corrección masiva 2',
    })
    .check();
  await page
    .getByRole('checkbox', {
      name: 'Seleccionar página para corrección masiva 3',
    })
    .check();
  await page.getByRole('button', { name: 'Girar selección 90° a la derecha' }).click();
  await expect(page.locator('.page-properties')).toContainText('90°');
  await page.getByRole('button', { name: 'Seleccionar página 3' }).click();
  await expect(orientationReview).toContainText(
    'Giro sugerido: 90° a la derecha.',
  );
  await expect(page.locator('.page-properties')).toContainText('90°');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.page-properties')).toContainText('0°');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.locator('.page-properties')).toContainText('90°');

  await page.getByRole('button', { name: 'Seleccionar página 5' }).click();
  await expect(orientationReview).toContainText(
    'Giro sugerido: 90° a la izquierda.',
  );
  await expect(page.locator('.page-properties')).toContainText('90°');
  await page.getByRole('button', { name: 'Aplicar sugerencias pendientes (3)' }).click();
  await page.getByRole('button', { name: 'Seleccionar página 3' }).click();
  await expect(orientationReview).toContainText(
    'La orientación sugerida ya está aplicada.',
  );
  await expect(page.locator('.page-properties')).toContainText('180°');
  await page.getByRole('button', { name: 'Seleccionar página 4' }).click();
  await expect(page.locator('.page-properties')).toContainText('270°');
  await page.getByRole('button', { name: 'Seleccionar página 5' }).click();
  await expect(orientationReview).toContainText(
    'La orientación sugerida ya está aplicada.',
  );
  await expect(page.locator('.page-properties')).toContainText('0°');
  await page.getByRole('button', { name: 'Seleccionar página 6' }).click();
  await expect(orientationReview).toContainText('No hay texto digital;');
  await page
    .getByRole('button', { name: 'Girar página 90° a la izquierda' })
    .click();
  await expect(page.locator('.page-properties')).toContainText('270°');
  await page.getByRole('button', { name: 'Girar página 180°' }).click();
  await expect(page.locator('.page-properties')).toContainText('90°');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
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
