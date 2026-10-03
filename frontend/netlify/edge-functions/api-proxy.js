const WITHOUT_BODY = new Set(['GET', 'HEAD'])

/**
 * Keep the browser on the Netlify origin while the persistent ForgeFit API runs
 * on Railway. This is important for host-only session cookies and WebAuthn.
 *
 * Configure FORGEFIT_API_ORIGIN in Netlify with Functions scope, for example:
 * https://forgefit-api-production.up.railway.app
 */
export default async function apiProxy(request) {
  const configuredOrigin = Netlify.env.get('FORGEFIT_API_ORIGIN')?.trim()
  if (!configuredOrigin) {
    return Response.json(
      { error: 'ForgeFit API is not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  let upstreamOrigin
  try {
    upstreamOrigin = new URL(configuredOrigin)
  } catch {
    return Response.json(
      { error: 'ForgeFit API configuration is invalid' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (!['https:', 'http:'].includes(upstreamOrigin.protocol)) {
    return Response.json(
      { error: 'ForgeFit API configuration is invalid' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const incoming = new URL(request.url)
  const target = new URL(incoming.pathname + incoming.search, upstreamOrigin)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1))

  return fetch(target, {
    method: request.method,
    headers,
    body: WITHOUT_BODY.has(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'manual'
  })
}

export const config = { path: '/api/*' }
