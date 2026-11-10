import fs from 'node:fs'
for (const f of fs.readdirSync('.').filter(f=>f.endsWith('.dc.html'))) {
  const s = fs.readFileSync(f,'utf8')
  const helmet = (s.match(/<helmet>([\s\S]*?)<\/helmet>/)||['',''])[1]
  let body = (s.match(/<x-dc>([\s\S]*)<\/x-dc>/)||['',''])[1].replace(/<helmet>[\s\S]*?<\/helmet>/,'')
  body = body.replace(/src="([^"]+\.(?:jpg|png))"/g, 'src="../$1"')
  fs.writeFileSync('preview/'+f.replace('.dc.html','.html'), '<!doctype html><html><head><meta charset="utf-8">'+helmet+'</head><body>'+body+'</body></html>')
}
