import type { HeadTags, LinkTag, MetaTag } from './types';

const metaKey = (meta: MetaTag) =>
  meta.name
    ? `name:${meta.name}`
    : meta.property
      ? `property:${meta.property}`
      : meta.charSet
        ? 'charset'
        : null;

/** 루트 → 리프 순서. title 은 마지막 값, meta 는 키 중복 시 깊은 쪽, link 는 rel+href 중복 제거 */
export const mergeHead = (list: HeadTags[]): HeadTags => {
  let title: string | undefined;
  const meta = new Map<string, MetaTag>();
  const anonymousMeta: MetaTag[] = [];
  const link = new Map<string, LinkTag>();

  for (const tags of list) {
    if (tags.title !== undefined) title = tags.title;
    for (const item of tags.meta ?? []) {
      const key = metaKey(item);
      if (key === null) anonymousMeta.push(item);
      else {
        meta.delete(key);
        meta.set(key, item);
      }
    }
    for (const item of tags.link ?? []) link.set(`${item.rel} ${item.href}`, item);
  }

  return {
    ...(title !== undefined ? { title } : {}),
    meta: [...meta.values(), ...anonymousMeta],
    link: [...link.values()],
  };
};
