import type { Manifest } from 'vite';

/**
 * @vitejs/plugin-legacy 지원. 플러그인은 index.html 에만 nomodule 스크립트를 넣고
 * React 는 nomodule 스크립트를 낼 수 없어서, 같은 태그를 문서 끝(tailHtml)에 붙인다.
 *
 * 아래 인라인 코드는 @vitejs/plugin-legacy 8.2.4 dist/index.js 를 그대로 옮겼다
 * (플러그인은 코드가 아닌 sha256 cspHashes 만 export 한다).
 * test/legacy.test.ts 가 설치된 버전의 cspHashes 와 대조해 어긋나면 실패한다.
 */
export const LEGACY_PLUGIN_NAME = 'vite:legacy-post-process';

const LEGACY_POLYFILL_ID = 'vite-legacy-polyfill';
const LEGACY_ENTRY_ID = 'vite-legacy-entry';
const MODERN_FLAG = '__vite_is_modern_browser';
const LEGACY_POLYFILLS_KEY = 'vite/legacy-polyfills-legacy';
const MODERN_POLYFILLS_KEY = 'vite/legacy-polyfills';
const LEGACY_SUFFIX = '-legacy';

const safari10NoModuleFix = `!function(){var e=document,t=e.createElement("script");if(!("noModule"in t)&&"onbeforeload"in t){var n=!1;e.addEventListener("beforeload",(function(e){if(e.target===t)n=!0;else if(!e.target.hasAttribute("nomodule")||!n)return;e.preventDefault()}),!0),t.type="module",t.src=".",e.head.appendChild(t),t.remove()}}();`;
const systemJSInlineCode = `System.import(document.getElementById('${LEGACY_ENTRY_ID}').getAttribute('data-src'))`;
const detectModernBrowserCode = `import'data:text/javascript,if(!import.meta.resolve)throw Error("import.meta.resolve not supported")';import.meta.url;import("_").catch(()=>1);(async function*(){})().next();window.${MODERN_FLAG}=true`;
const dynamicFallbackInlineCode = `!function(){if(window.${MODERN_FLAG})return;console.warn("vite: loading legacy chunks, syntax error above and the same error below should be ignored");var e=document.getElementById("${LEGACY_POLYFILL_ID}"),n=document.createElement("script");n.src=e.src,n.onload=function(){${systemJSInlineCode}},document.body.appendChild(n)}();`;

/** plugin-legacy cspHashes 와 같은 순서 */
export const LEGACY_INLINE_SCRIPTS = [
  safari10NoModuleFix,
  systemJSInlineCode,
  detectModernBrowserCode,
  dynamicFallbackInlineCode,
];

export interface LegacyAssets {
  /** SystemJS 형식 레거시 엔트리 */
  entry: string;
  /** 레거시 폴리필 + SystemJS 런타임 (externalSystemJS 이고 폴리필이 없으면 생략) */
  polyfills?: string;
  /** modernPolyfills 옵션의 모던 폴리필 */
  modernPolyfills?: string;
}

/**
 * 가상 모듈(\0 id)의 매니페스트 키는 root 가 cwd 와 다르면 cwd 기준 상대 경로가 앞에 붙는다
 * (예: ../../virtual:ssr-kit/client-entry). 끝부분으로 찾는다
 */
export const findManifestKey = (manifest: Manifest, id: string) =>
  id in manifest ? id : Object.keys(manifest).find((key) => key.endsWith(`/${id}`));

const fileOf = (manifest: Manifest, id: string) => {
  const key = findManifestKey(manifest, id);
  return key ? manifest[key]!.file : undefined;
};

/** 클라 매니페스트에서 레거시 산출물을 찾는다. entryKey 는 모던 엔트리의 매니페스트 키 */
export const findLegacyAssets = (
  manifest: Manifest,
  entryKey: string | undefined,
): LegacyAssets => {
  if (!entryKey || !manifest[entryKey]) {
    throw new Error('@vitejs/plugin-legacy 의 renderModernChunks: false 는 지원하지 않는다');
  }
  const entry = manifest[`${entryKey}${LEGACY_SUFFIX}`];
  if (!entry) {
    throw new Error(
      'client 매니페스트에 레거시 엔트리가 없다. renderLegacyChunks: false 이거나, ' +
        'plugin-legacy 를 설정 파일 없이 인라인 설정으로 넘겨 환경별 설정에 공유된 경우다 (설정 파일로 옮길 것)',
    );
  }
  return {
    entry: entry.file,
    polyfills: fileOf(manifest, LEGACY_POLYFILLS_KEY),
    modernPolyfills: fileOf(manifest, MODERN_POLYFILLS_KEY),
  };
};

/** nonce 속성이 들어갈 자리. 요청마다 nonce 가 달라 템플릿을 이 자리로 나눠 둔다 */
const NONCE_SLOT = '\0';

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const script = (attributes: string, children = '') =>
  `<script${NONCE_SLOT}${attributes}>${children}</script>`;

/**
 * plugin-legacy 가 index.html 에 넣는 태그와 같은 것 (modernPolyfills 는 bootstrapModules 로 간다).
 * head 에 들어가던 감지 스크립트 둘은 인라인 모듈(defer)이라 위치와 무관하게 문서 파싱 뒤 순서대로 돈다.
 * nonce 자리로 나눈 조각을 돌려준다 (createTailHtml 이 이어 붙인다).
 */
export const legacyTailParts = (assets: LegacyAssets, base: string): string[] => {
  const url = (file: string) => escapeAttribute(`${base}${file}`);
  const tags = [
    script(' nomodule', safari10NoModuleFix),
    assets.polyfills
      ? script(` nomodule crossorigin id="${LEGACY_POLYFILL_ID}" src="${url(assets.polyfills)}"`)
      : '',
    script(
      ` nomodule crossorigin id="${LEGACY_ENTRY_ID}" data-src="${url(assets.entry)}"`,
      systemJSInlineCode,
    ),
  ];
  // plugin-legacy 와 같이 폴리필 청크가 있을 때만 (dynamicFallback 이 그 src 를 쓴다)
  if (assets.polyfills) {
    tags.push(
      script(' type="module"', detectModernBrowserCode),
      script(' type="module"', dynamicFallbackInlineCode),
    );
  }
  return tags.join('').split(NONCE_SLOT);
};
