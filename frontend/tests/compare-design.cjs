// Usage: node tests/compare-design.cjs <sharp-module-path> <reference> <capture> <output>
// This only composes QA evidence. It never changes the reference or an app screenshot.
const sharp = require(process.argv[2])
const [reference, capture, output] = process.argv.slice(3)
async function main() {
  const ref = await sharp(reference).metadata(), impl = await sharp(capture).metadata()
  const width = 390, height = 844, gutter = 12
  const left = await sharp(reference).resize(width, height, { fit: 'fill' }).png().toBuffer()
  const right = await sharp(capture).resize(width, height, { fit: 'fill' }).png().toBuffer()
  await sharp({ create: { width: width * 2 + gutter, height, channels: 4, background: '#707070' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: width + gutter, top: 0 }]).png().toFile(output)
  for (const [name, region] of [
    ['session', { left: 16, top: 270, width: 358, height: 290 }],
    ['header', { left: 16, top: 14, width: 358, height: 120 }],
    ['chart-nav', { left: 16, top: 590, width: 358, height: 250 }]
  ]) {
    const a = await sharp(left).extract(region).resize(region.width * 2, region.height * 2).png().toBuffer()
    const b = await sharp(right).extract(region).resize(region.width * 2, region.height * 2).png().toBuffer()
    await sharp({ create: { width: region.width * 4 + gutter, height: region.height * 2, channels: 4, background: '#707070' } })
      .composite([{ input: a, left: 0, top: 0 }, { input: b, left: region.width * 2 + gutter, top: 0 }])
      .png().toFile(output.replace(/\.png$/, '-' + name + '.png'))
  }
  console.log(JSON.stringify({ reference: [ref.width, ref.height], capture: [impl.width, impl.height], normalized: [width, height], referenceOnLeft: true, output }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
