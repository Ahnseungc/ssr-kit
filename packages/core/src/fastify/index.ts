import type { FastifyPluginAsync, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';

import {
  type AdapterOptions,
  createSink,
  fail,
  toHandleOptions,
  toSsrRequest,
} from '../node/index';
import { handleRequest } from '../server/request';

export type FastifySsrOptions = AdapterOptions<FastifyRequest>;

const SKIP_OVERRIDE = Symbol.for('skip-override');
const DISPLAY_NAME = Symbol.for('fastify.display-name');

const handle = async (options: FastifySsrOptions, request: FastifyRequest, reply: FastifyReply) => {
  // 응답은 reply.raw 에 직접 스트리밍한다
  reply.hijack();
  const res = reply.raw;
  try {
    // trustProxy 를 반영하도록 URL 은 Fastify 의 protocol·host 로 만든다
    const ssrRequest = {
      ...toSsrRequest(request.raw),
      url: new URL(request.url, `${request.protocol}://${request.host}`),
    };
    await handleRequest(
      options.build,
      ssrRequest,
      createSink(res),
      toHandleOptions(options, request, request.headers['user-agent'], 'render'),
    );
  } catch (error) {
    if (error instanceof Error) options.build.fixStacktrace?.(error);
    console.error('[ssr-kit] 요청 처리 실패', error);
    fail(res, error);
  }
};

const ACTION_METHODS: HTTPMethods[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

const plugin: FastifyPluginAsync<FastifySsrOptions> = async (fastify, options) => {
  fastify.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: (request, reply) => handle(options, request, reply),
  });
  // action 본문은 ssr-kit 이 request.raw 에서 직접 읽는다. 캡슐화한 하위 스코프에서만
  // 파서를 비워 사용자 라우트의 JSON 파싱 등은 그대로 둔다
  await fastify.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, _payload, done) => done(null));
    scope.route({
      method: ACTION_METHODS,
      url: '/*',
      handler: (request, reply) => handle(options, request, reply),
    });
  });
};

/**
 * `fastify.register(ssrKit, { build })`. 캡슐화하지 않아 등록한 스코프에 바로 붙는다.
 * 매치 라우트가 없으면 루트 404 를 렌더한다. 정적 파일은 `@fastify/static` 등으로.
 */
export const ssrKit = Object.assign(plugin, {
  [SKIP_OVERRIDE]: true,
  [DISPLAY_NAME]: 'ssr-kit',
});
