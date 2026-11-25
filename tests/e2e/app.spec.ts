import { expect, test } from '@playwright/test';

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
