import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = read('android-cloud/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '')
const gradle = read('android-cloud/app/build.gradle')
const strings = read('android-cloud/app/src/main/res/values/strings.xml')
const appId = gradle.match(/applicationId '([^']+)'/)[1]
const origin = 'https://forgefit-rutvik.netlify.app'

test('the cloud APK has a distinct ForgeFit identity and an increasing release version', () => {
  assert.equal(appId, 'com.forgefit.app')
  assert.match(gradle, /namespace 'com\.forgefit\.app'/)
  assert.match(strings, /<string name="app_name">ForgeFit<\/string>/)
  assert.ok(Number(gradle.match(/versionCode (\d+)/)[1]) > 4)
  assert.match(gradle, /versionName '\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?'/)
})

test('the launcher opens only the hosted HTTPS app with browser-supplied authentication', () => {
  assert.match(manifest, /com\.google\.androidbrowserhelper\.trusted\.LauncherActivity/)
  assert.match(manifest, /DEFAULT_URL"\s+android:value="https:\/\/forgefit-rutvik\.netlify\.app\/"/)
  assert.match(manifest, /android:scheme="https" android:host="forgefit-rutvik\.netlify\.app"/)
  assert.match(manifest, /android:usesCleartextTraffic="false"/)
  assert.doesNotMatch(manifest, /BridgeActivity|WebView|VITE_MOBILE=1|localhost|127\.0\.0\.1/)
})

test('the APK declares no native sensitive permissions or app-data backup', () => {
  const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match => match[1])
  assert.deepEqual(permissions, ['android.permission.INTERNET'])
  assert.match(manifest, /android:allowBackup="false"/)
  const rules = read('android-cloud/app/src/main/res/xml/data_extraction_rules.xml')
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = rules.match(new RegExp(`<${section}[^>]*>([\\s\\S]*?)<\\/${section}>`))[1]
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
      assert.ok(body.includes(`<exclude domain="${domain}" path="." />`))
    }
  }
})

test('both sides of the Android-to-website association agree', () => {
  const encoded = strings.match(/<string name="asset_statements"[^>]*>([\s\S]*?)<\/string>/)[1]
  const statements = JSON.parse(encoded.replace(/\\"/g, '"'))
  assert.deepEqual(statements, [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'web', site: origin },
  }])
  const associations = JSON.parse(read('frontend/public/.well-known/assetlinks.json'))
  assert.equal(associations.length, 1)
  assert.deepEqual(associations[0].relation, ['delegate_permission/common.handle_all_urls'])
  const target = associations[0].target
  assert.deepEqual(Object.keys(target).sort(), ['namespace', 'package_name', 'sha256_cert_fingerprints'])
  assert.equal(target.namespace, 'android_app')
  assert.equal(target.package_name, appId)
  assert.equal(target.sha256_cert_fingerprints.length, 1)
  assert.match(target.sha256_cert_fingerprints[0], /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  assert.match(read('netlify.toml'), /for = "\/\.well-known\/assetlinks\.json"/)
})

test('release signing material is excluded and never provided to CI', () => {
  const ignore = read('.gitignore')
  for (const pattern of ['*.jks', '*.keystore', 'keystore.properties', 'signing-secrets*.xml']) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern))
  }
  const workflow = read('.github/workflows/android.yml')
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /secrets\.|contents: write|apksigner sign/)
  assert.match(workflow, /app-release-unsigned\.apk/)
  const signer = read('scripts/build-android-release.ps1')
  assert.match(signer, /--ks-pass env:FORGEFIT_SIGNING_PASSWORD/)
  assert.match(signer, /-storepass:env FORGEFIT_SIGNING_PASSWORD/)
  assert.match(signer, /Export-Clixml/)
  assert.match(signer, /apksignerExe verify --verbose --print-certs/)
})

test('Gradle distribution integrity and Android dependencies are pinned', () => {
  const wrapper = read('android-cloud/gradle/wrapper/gradle-wrapper.properties')
  assert.match(wrapper, /distributionSha256Sum=[0-9a-f]{64}/)
  assert.match(wrapper, /validateDistributionUrl=true/)
  assert.match(gradle, /androidbrowserhelper:\d+\.\d+\.\d+'/)
  assert.match(gradle, /minifyEnabled true/)
  assert.match(gradle, /shrinkResources true/)
})
