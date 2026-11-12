# Changelog

All notable changes to `ssr-kit` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A render error that no route `ErrorBoundary` catches no longer unmounts the whole document after hydration. It falls back to the default error page inside your `Document` (message hidden in production) and resets on the next navigation.

### Documentation

- Express: mount the handler once more without `next` to render the 404 page for unmatched URLs.
- `action` receives POST, PUT, PATCH, and DELETE; check `request.method` to limit it.

## [0.1.0] - 2026-11-11

First public release.

### Added

- **Streaming SSR** with React 19 `renderToPipeableStream` (Node) and `renderToReadableStream` (edge). The shell is sent first; Promises returned from loaders stream into the same response and are read with `use()` inside `<Suspense>`.
- **Routes as code**: `defineRoutes` with nested layouts, `:param`, `:optional?`, and `*` segments, segment-by-segment priority, and typed params.
- **Route modules**: `loader`, `action`, `middleware` (server-only, removed from the client bundle with their helpers and imports), `head`, `ErrorBoundary`.
- **Mutations**: `action` export, `<Form>`, `useSubmit`, `useActionData`, and `useNavigation().state === "submitting"`. Works without JavaScript. Redirects become `303`. Requests from another origin get `403` (`allowedOrigins` to extend).
- **Route middleware**: onion-style, runs root to leaf before loaders and actions on every document, data, and action request.
- **Client router**: `<Link>` with intent and viewport prefetch, `useNavigate`, `useRevalidate`, `useNavigation`, scroll restoration (including reloads), hash links, and a redirect loop guard.
- **Type-safe links**: `Register`/`Href` types, `href(pattern, params)`, and generated route types (`ssrKit({ routesDts: true })`).
- **Vite 8 plugin** (`ssr-kit/vite`): client and SSR environment builds, asset manifest preloading, dev server with HMR and React Fast Refresh for route modules, Vite error overlay for server errors, and a build error when a `*.server.*` module reaches the client.
- **Adapters**: `ssr-kit/node` (Express, Connect, `node:http`), `ssr-kit/fastify`, `ssr-kit/hono`, `ssr-kit/web` (`Request → Response`), and `ssr-kit/edge` for Cloudflare Workers with no `node:*` imports.
- **File-based routes** (`fsRoutes`), **prerender** (`ssr-kit/prerender`, CLI `ssr-kit-prerender`, HTML plus data JSON), and a low-level **`render()`** for external routers.
- **`@vitejs/plugin-legacy` support**: nomodule polyfills and legacy entry scripts are added to SSR documents for old WebViews.
- **Operations**: `Server-Timing` header (dev default) and `onTiming`, CSP nonce on every inline and module script, `Cache-Control: private, no-store` by default and `no-store` on error responses, production error messages hidden.
- Serialization of `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, special numbers, and shared or circular references, escaped for inline scripts.

[0.1.0]: https://github.com/Ahnseungc/ssr-kit/releases/tag/v0.1.0
