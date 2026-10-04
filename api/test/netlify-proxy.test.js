import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { once } from 'node:events'

import apiProxy from '../legacy/netlify-api-proxy.js'

test('Netlify proxy fails closed until configured, then forwards the API request', async t => {
  const previousNetlify = globalThis.Netlify
  let configuredOrigin
  globalThis.Netlify = { env: { get: () => configuredOrigin } }
  t.after(() => {
    if (previousNetlify === undefined) delete globalThis.Netlify
    else globalThis.Netlify = previousNetlify
  })

  const unavailable = await apiProxy(new Request('https://forgefit.netlify.app/api/health'))
  assert.equal(unavailable.status, 503)

  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(201, {
      'content-type': 'application/json',
      'set-cookie': 'forgefit_session=test; HttpOnly; Secure; SameSite=Lax'
    })
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      body,
      cookie: req.headers.cookie,
      forwardedHost: req.headers['x-forwarded-host'],
      forwardedProto: req.headers['x-forwarded-proto']
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  configuredOrigin = `http://127.0.0.1:${server.address().port}`
  const response = await apiProxy(new Request(
    'https://forgefit.netlify.app/api/echo?source=netlify',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'forgefit_session=test' },
      body: '{"ready":true}'
    }
  ))

  assert.equal(response.status, 201)
  assert.match(response.headers.get('set-cookie'), /forgefit_session=test/)
  assert.deepEqual(await response.json(), {
    method: 'POST',
    url: '/api/echo?source=netlify',
    body: '{"ready":true}',
    cookie: 'forgefit_session=test',
    forwardedHost: 'forgefit.netlify.app',
    forwardedProto: 'https'
  })
})
