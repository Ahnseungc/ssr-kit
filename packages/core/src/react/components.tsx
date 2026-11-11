import {
  type AnchorHTMLAttributes,
  Component,
  type ComponentType,
  type FormHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type SubmitEvent,
  useContext,
  useEffect,
  useRef,
} from 'react';

import { toRouteError } from '../core/errors';
import { mergeHead } from '../core/head';
import type { Href } from '../core/href';
import type { DocumentProps, HeadTags, RouteError } from '../core/types';
import {
  boundaryIndexOf,
  type FormMethod,
  RouteIndexContext,
  RouterActionsContext,
  type RouterState,
  useRouterState,
} from './context';

const INTENT_DELAY_MS = 100;

interface CatcherProps {
  fallback: ComponentType<{ error: RouteError }>;
  resetKey: string;
  dev: boolean;
  children: ReactNode;
}

interface CatcherState {
  error: RouteError | null;
  resetKey: string;
}

/** 렌더 중 throw 를 라우트 ErrorBoundary 로 넘긴다. 이동(resetKey 변경) 시 초기화 */
class RenderErrorCatcher extends Component<CatcherProps, CatcherState> {
  state: CatcherState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: CatcherProps, state: CatcherState) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<CatcherState> {
    return { error: toRouteError(error, true) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const Fallback = this.props.fallback;
    const visible = this.props.dev ? error : toRouteError(new Error(), false);
    return <Fallback error={visible} />;
  }
}

const RouteView = ({ index }: { index: number }) => {
  const state = useRouterState();
  const module = state.modules[index];
  if (!module) return null;

  const boundary = boundaryIndexOf(state);
  if (boundary === index) {
    const Boundary = module.ErrorBoundary!;
    return (
      <RouteIndexContext value={index}>
        <Boundary error={state.payload.error!.error} />
      </RouteIndexContext>
    );
  }

  const Page = module.default;
  const content = (
    <RouteIndexContext value={index}>
      <Page />
    </RouteIndexContext>
  );
  if (!module.ErrorBoundary) return content;
  return (
    <RenderErrorCatcher
      fallback={module.ErrorBoundary}
      resetKey={state.location.key}
      dev={state.dev}
    >
      {content}
    </RenderErrorCatcher>
  );
};

/** 자식 라우트 렌더 위치 */
export const Outlet = () => {
  const index = useContext(RouteIndexContext);
  return <RouteView index={index + 1} />;
};

export const DefaultErrorPage = ({ error }: { error: RouteError }) => (
  <main>
    <h1>{error.status}</h1>
    <p>{error.message}</p>
    {error.stack ? <pre>{error.stack}</pre> : null}
  </main>
);

const headLimit = (state: RouterState) => {
  const boundary = boundaryIndexOf(state);
  if (boundary === null) return 0;
  return boundary === -1 ? state.matches.length : boundary;
};

export const collectHead = (state: RouterState): HeadTags => {
  if (state.payload.shell) return {};
  const list: HeadTags[] = [];
  for (let i = 0; i < headLimit(state); i += 1) {
    const head = state.modules[i]?.head;
    const match = state.matches[i]!;
    if (head) list.push(head({ data: state.payload.data[match.id], params: match.params }));
  }
  const tags = mergeHead(list);
  const error = state.payload.error;
  if (error && tags.title === undefined)
    tags.title = `${error.error.status} ${error.error.message}`;
  return tags;
};

/** 병합된 head 태그. Document 의 <head> 안에서 렌더 */
export const Head = () => {
  const tags = collectHead(useRouterState());
  return (
    <>
      {tags.title !== undefined ? <title>{tags.title}</title> : null}
      {tags.meta?.map((meta, i) => (
        <meta key={`m${i}`} {...meta} />
      ))}
      {tags.link?.map((link) => (
        <link key={`${link.rel} ${link.href}`} {...link} />
      ))}
    </>
  );
};

export const DefaultDocument = ({ children }: DocumentProps) => (
  <html lang="ko">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <Head />
    </head>
    <body>{children}</body>
  </html>
);

/** Document + 라우트 트리. 서버·클라가 같은 트리를 렌더해야 hydrate 가 일치한다 */
export const Root = ({ Document }: { Document: ComponentType<DocumentProps> }) => {
  const state = useRouterState();
  const error = state.payload.error;
  let body: ReactNode = <RouteView index={0} />;
  if (state.payload.shell) body = null;
  else if (error && error.routeId === null) body = <DefaultErrorPage error={error.error} />;
  return <Document>{body}</Document>;
};

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Register 로 라우트를 등록하면 등록된 패턴에 맞는 주소만 받는다 */
  to: Href;
  prefetch?: 'intent' | 'viewport' | 'none';
  replace?: boolean;
  state?: unknown;
  /** true 면 클라 이동 대신 문서 이동 */
  reloadDocument?: boolean;
}

const isModifiedClick = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const isSameOrigin = (href: string) =>
  new URL(href, window.location.href).origin === window.location.origin;

export const Link = ({
  to,
  prefetch = 'intent',
  replace,
  state,
  reloadDocument,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onTouchStart,
  ...rest
}: LinkProps) => {
  const actions = useContext(RouterActionsContext);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const intent = prefetch === 'intent';

  useEffect(() => {
    const anchor = anchorRef.current;
    if (prefetch !== 'viewport' || !anchor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        actions.prefetch(to, false);
        observer.disconnect();
      }
    });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [prefetch, to, actions]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    clearTimeout(timer.current);
    if (event.defaultPrevented || reloadDocument || isModifiedClick(event)) return;
    const target = event.currentTarget.getAttribute('target');
    if ((target && target !== '_self') || event.currentTarget.hasAttribute('download')) return;
    if (!isSameOrigin(to)) return;
    event.preventDefault();
    actions.navigate(to, { replace, state });
  };

  return (
    <a
      {...rest}
      ref={anchorRef}
      href={to}
      onClick={handleClick}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (intent) timer.current = setTimeout(() => actions.prefetch(to, true), INTENT_DELAY_MS);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        clearTimeout(timer.current);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (intent) actions.prefetch(to, true);
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        if (intent) actions.prefetch(to, true);
      }}
    />
  );
};

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'method' | 'action'> {
  /** 기본 'get'. put·patch·delete 는 JS 없이 제출되면 post 로 간다 */
  method?: FormMethod;
  /** 기본: 현재 경로+쿼리 */
  action?: string;
  replace?: boolean;
  /** true 면 가로채지 않고 브라우저가 제출 */
  reloadDocument?: boolean;
}

type Submitter = HTMLButtonElement | HTMLInputElement;

/** new FormData(form, submitter) 는 구형 WebView 에 없어 누른 버튼 값을 직접 붙인다 */
const collectFormData = (form: HTMLFormElement, submitter: Submitter | null) => {
  const formData = new FormData(form);
  if (submitter?.name) formData.append(submitter.name, submitter.value);
  return formData;
};

/**
 * 실제 <form> 을 렌더해 hydrate 전(JS 없음)에도 제출된다.
 * hydrate 후에는 submit 을 가로채 데이터 엔드포인트로 보낸다.
 */
export const Form = ({
  method = 'get',
  action,
  replace,
  reloadDocument,
  onSubmit,
  ...rest
}: FormProps) => {
  const actions = useContext(RouterActionsContext);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    onSubmit?.(event);
    if (event.defaultPrevented || reloadDocument) return;
    const submitter = event.submitter as Submitter | null;
    const target = submitter?.getAttribute('formtarget') ?? event.currentTarget.target;
    if (target && target !== '_self') return;
    const to = submitter?.getAttribute('formaction') ?? action;
    if (to && !isSameOrigin(to)) return;
    const submitMethod = (submitter?.getAttribute('formmethod') as FormMethod | null) ?? method;
    event.preventDefault();
    actions
      .submit(collectFormData(event.currentTarget, submitter), {
        method: submitMethod.toLowerCase() as FormMethod,
        action: to,
        replace,
      })
      .catch((error: unknown) => console.error('[ssr-kit] 폼 제출 실패', error));
  };

  return (
    <form
      {...rest}
      method={method === 'get' ? 'get' : 'post'}
      action={action}
      onSubmit={handleSubmit}
    />
  );
};
