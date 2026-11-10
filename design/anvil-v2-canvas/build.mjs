import fs from 'node:fs'
const shared = fs.readFileSync('src/shared.css','utf8')
const head = fs.readFileSync('src/head.html','utf8')
const rail = fs.readFileSync('src/rail.html','utf8')
const railFor = k => rail.replace(/\{(\w+)\}/g, (_, n) => n === k ? 'on' : '')
const PRE = '<!doctype html>\n<html>\n<head><meta charset="utf-8"><script src="./support.js"></script></head>\n<body>\n<x-dc>\n'
const POST = '\n</x-dc>\n</body>\n</html>\n'
for (const f of fs.readdirSync('src').filter(f=>f.endsWith('.body.html'))) {
  const name = f.replace('.body.html','')
  let body = fs.readFileSync('src/'+f,'utf8')
  const m = body.match(/<!--CSS-->([\s\S]*?)<!--\/CSS-->/)
  const local = m ? m[1] : ''
  body = body.replace(/<!--CSS-->[\s\S]*?<!--\/CSS-->\s*/,'').replace(/<!--RAIL (\w+)-->/g, (_, k) => railFor(k))
  const out = PRE + head.replace('/*SHARED*/', shared).replace('/*LOCAL*/', local) + body + POST
  fs.writeFileSync(name+'.dc.html', out)
  console.log(name+'.dc.html', out.length)
}
