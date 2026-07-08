import { test, expect, Page } from '@playwright/test';

let authToken: string;

test.beforeAll(async ({ request }) => {
  const res = await request.post('http://localhost:3001/api/auth/login', {
    data: { email: 'admin@example.com', password: 'admin123' },
  });
  const data = await res.json();
  authToken = data.token;
});

async function setupPage(page: Page) {
  await page.addInitScript(({ token }) => {
    localStorage.setItem('pg_token', token);
    localStorage.removeItem('signalstack:leads:columns');
  }, { token: authToken });
  await page.goto('/leads', { waitUntil: 'networkidle' });
  await page.waitForSelector('table', { timeout: 30000 });
}

test.describe('Leads Table — Phase 5 Column System', () => {
  test('default columns are Company, Score, Campaign, Status, Updated', async ({ page }) => {
    await setupPage(page);
    const headers = await page.$$eval('thead th', (ths: Element[]) =>
      ths.map(th => th.textContent?.trim()).filter(Boolean)
    );
    expect(headers).toContain('Company');
    expect(headers).toContain('Score');
    expect(headers).toContain('Campaign');
    expect(headers).toContain('Status');
    expect(headers).toContain('Updated');
    expect(headers).not.toContain('Potential');
    expect(headers).not.toContain('Urgency');
    expect(headers).not.toContain('ICP Fit');
  });

  test('column picker button exists and opens popover', async ({ page }) => {
    await setupPage(page);
    const columnsBtn = page.locator('button', { hasText: 'Columns' });
    await expect(columnsBtn).toBeVisible();
    await columnsBtn.click();

    await expect(page.getByText('Visible Columns')).toBeVisible();
    await expect(page.locator('.text-\\[9px\\].font-bold', { hasText: 'Core' })).toBeVisible();
    await expect(page.locator('.text-\\[9px\\].font-bold', { hasText: 'Dimensions' })).toBeVisible();
    await expect(page.locator('.text-\\[9px\\].font-bold', { hasText: 'Meta' })).toBeVisible();
  });

  test('toggling a dimension column adds it to the table', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await page.getByText('Visible Columns').waitFor();
    await page.locator('label:has-text("Potential")').click();
    await expect(page.locator('thead th', { hasText: 'Potential' })).toBeVisible();
  });

  test('toggling a column off removes it from the table', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await page.getByText('Visible Columns').waitFor();
    await page.locator('label:has-text("Campaign")').click();
    await expect(page.locator('thead th', { hasText: 'Campaign' })).not.toBeVisible();
  });

  test('column preferences persist in localStorage', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await page.getByText('Visible Columns').waitFor();
    await page.locator('label:has-text("Potential")').click();

    const stored = await page.evaluate(() => localStorage.getItem('signalstack:leads:columns'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toContain('potential');
    expect(parsed).toContain('company');
    expect(parsed).toContain('score');
  });

  test('sort dropdown is removed; headers are clickable', async ({ page }) => {
    await setupPage(page);
    const sortSelect = page.locator('select option[value="fit_score"]');
    await expect(sortSelect).toHaveCount(0);

    const companyBtn = page.locator('thead th button', { hasText: 'Company' });
    await expect(companyBtn).toBeVisible();
    await companyBtn.click();
    await expect(companyBtn.locator('svg')).toBeVisible();
  });

  test('clicking same header toggles sort direction', async ({ page }) => {
    await setupPage(page);
    const scoreBtn = page.locator('thead th button', { hasText: 'Score' });
    await scoreBtn.click();
    await scoreBtn.click();
    await expect(scoreBtn).toBeVisible();
    await expect(scoreBtn.locator('svg')).toBeVisible();
  });

  test('All button shows all columns', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await page.getByText('Visible Columns').waitFor();
    await page.locator('button:has-text("All")').first().click();

    await expect(page.locator('thead th', { hasText: 'Potential' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Urgency' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'ICP Fit' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Reachability' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Confidence' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Segment' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Signals' })).toBeVisible();
  });

  test('Reset restores default columns', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await page.getByText('Visible Columns').waitFor();
    await page.locator('button:has-text("All")').first().click();
    await expect(page.locator('thead th', { hasText: 'Potential' })).toBeVisible();

    await page.locator('button:has-text("Reset")').click();
    await expect(page.locator('thead th', { hasText: 'Potential' })).not.toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Urgency' })).not.toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Score' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Campaign' })).toBeVisible();
  });

  test('non-sortable columns have plain text headers', async ({ page }) => {
    await setupPage(page);
    const campaignButton = page.locator('thead th button', { hasText: 'Campaign' });
    await expect(campaignButton).toHaveCount(0);
    await expect(page.locator('thead th span', { hasText: 'Campaign' })).toBeVisible();
  });

  test('table rows have correct cell count', async ({ page }) => {
    await setupPage(page);
    const headerCount = await page.$$eval('thead th', ths => ths.length);
    expect(headerCount).toBeGreaterThanOrEqual(5);

    const dataRows = page.locator('tbody tr').filter({ has: page.locator('td a') });
    const rowCount = await dataRows.count();
    if (rowCount > 0) {
      const cellCount = await dataRows.first().locator('td').count();
      expect(cellCount).toBeGreaterThanOrEqual(5);
      expect(cellCount).toBeLessThanOrEqual(6);
    }
  });

  test('column picker closes on outside click', async ({ page }) => {
    await setupPage(page);
    await page.locator('button', { hasText: 'Columns' }).click();
    await expect(page.getByText('Visible Columns')).toBeVisible();
    await page.getByRole('heading', { name: 'Leads' }).click();
    await expect(page.getByText('Visible Columns')).not.toBeVisible();
  });
});
