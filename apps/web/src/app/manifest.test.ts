import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

/**
 * A browser only offers to install the app when the manifest says enough: a name, a start URL, a
 * standalone display and icons of the right sizes. These are easy to break by accident and
 * invisible until someone tries to install.
 */
describe('web app manifest', () => {
  const m = manifest();
  const sizes = (purpose: string) =>
    m.icons?.filter((i) => i.purpose === purpose).map((i) => i.sizes);

  it('says what the installed app is called', () => {
    expect(m.name).toBe('ZABY TRACKER');
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it('opens in its own window at the top of the app', () => {
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
  });

  it('ships the icon sizes a home screen asks for, maskable included', () => {
    expect(sizes('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(sizes('maskable')).toContain('512x512');
  });

  it('points at icons that are actually there', () => {
    const publicDir = join(__dirname, '..', '..', 'public');
    for (const icon of m.icons ?? []) {
      expect(existsSync(join(publicDir, icon.src)), `${icon.src} is missing`).toBe(true);
    }
  });

  it('only links shortcuts inside the app', () => {
    for (const shortcut of m.shortcuts ?? []) expect(shortcut.url.startsWith('/')).toBe(true);
  });
});
