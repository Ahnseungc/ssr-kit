import type { ComponentType } from 'react';

import type { DocumentProps, RouteDef } from '../core/types';
import { nonceAttribute } from './payload';

export interface AssetManifest {
  entry: { file: string; css: string[] };
  /** 매니페스트 키(root 기준 경로) → 청크와 재귀 평탄화된 import·css */
  modules: Record<string, { file: string; imports: string[]; css: string[] }>;
}

export interface ResolvedAssets {
  /** modulepreload 할 JS URL */
  modules: string[];
  /** 스타일시트 URL */
  styles: string[];
}

export interface ServerBuild {
  routes: RouteDef[];
  Document?: ComponentType<DocumentProps>;
  dataPrefix: string;
  dev: boolean;
  /** <script type="module"> 로 부트스트랩할 URL */
  bootstrapModules: string[];
  /** 매치된 라우트 모듈 키 → 프리로드할 에셋 */
  resolveAssets: (files: string[]) => ResolvedAssets | Promise<ResolvedAssets>;
  /**
   * React 출력이 끝난 뒤 문서 끝에 붙일 HTML (예: @vitejs/plugin-legacy 의 nomodule 스크립트).
   * 요청 nonce 를 받아 만든다. HEAD 응답에는 붙지 않는다
   */
  tailHtml?: (nonce?: string) => string;
  /** dev: Vite 소스맵 기준으로 스택 보정 */
  fixStacktrace?: (error: Error) => void;
}

const unique = (list: string[]) => [...new Set(list)];

export const createManifestAssets = (
  manifest: AssetManifest,
  base: string,
): Pick<ServerBuild, 'bootstrapModules' | 'resolveAssets'> => {
  const url = (file: string) => `${base}${file}`;
  const entryStyles = manifest.entry.css.map(url);

  return {
    bootstrapModules: [url(manifest.entry.file)],
    resolveAssets: (files) => {
      const modules: string[] = [];
      const styles = [...entryStyles];
      for (const key of files) {
        const chunk = manifest.modules[key];
        if (!chunk) continue;
        modules.push(url(chunk.file), ...chunk.imports.map(url));
        styles.push(...chunk.css.map(url));
      }
      return { modules: unique(modules), styles: unique(styles) };
    },
  };
};

/** nonce 자리로 나뉜 조각을 요청 nonce 로 이어 붙이는 tailHtml */
export const createTailHtml =
  (parts: string[]): NonNullable<ServerBuild['tailHtml']> =>
  (nonce) =>
    parts.join(nonceAttribute(nonce));
