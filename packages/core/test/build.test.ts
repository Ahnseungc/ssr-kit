import { describe, expect, it } from 'vitest';

import { createManifestAssets } from '../src/server/build';

describe('createManifestAssets', () => {
  const assets = createManifestAssets(
    {
      entry: { file: 'assets/entry.js', css: ['assets/entry.css'] },
      modules: {
        'src/pages/A.tsx': {
          file: 'assets/A.js',
          imports: ['assets/shared.js'],
          css: ['assets/A.css'],
        },
        'src/pages/B.tsx': { file: 'assets/B.js', imports: ['assets/shared.js'], css: [] },
      },
    },
    '/base/',
  );

  it('엔트리를 base 를 붙여 부트스트랩한다', () => {
    expect(assets.bootstrapModules).toEqual(['/base/assets/entry.js']);
  });

  it('매치된 모듈의 청크·공유 청크·CSS 를 중복 없이 모은다', () => {
    expect(assets.resolveAssets(['src/pages/A.tsx', 'src/pages/B.tsx', 'src/unknown.tsx'])).toEqual(
      {
        modules: ['/base/assets/A.js', '/base/assets/shared.js', '/base/assets/B.js'],
        styles: ['/base/assets/entry.css', '/base/assets/A.css'],
      },
    );
  });

  it('매치가 없어도 엔트리 CSS 는 넣는다', () => {
    expect(assets.resolveAssets([])).toEqual({ modules: [], styles: ['/base/assets/entry.css'] });
  });
});
