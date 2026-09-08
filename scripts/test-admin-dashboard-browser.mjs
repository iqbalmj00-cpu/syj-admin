// Isolated browser regression harness. Bundles client components only; never starts
// Next, reads .env files, imports server routes, or forwards an API request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'admin-browser-'));
const runtime = process.env.CODEX_TEST_NODE_MODULES;
if (!runtime) throw new Error('Set CODEX_TEST_NODE_MODULES to the bundled workspace Node packages directory');
const { chromium } = require(path.join(runtime, 'playwright'));
const webpack = require('next/dist/compiled/webpack/webpack-lib');
await writeFile(path.join(temp, 'ts-loader.cjs'), `const ts = require(${JSON.stringify(require.resolve('typescript'))}); module.exports = function(source) { return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; };`);
await writeFile(path.join(temp, 'css-loader.cjs'), `module.exports = function(source) { const names = Object.fromEntries([...source.matchAll(/\\.([A-Za-z_][\\w-]*)/g)].map(m => [m[1], m[1]])); return 'const style = document.createElement("style"); style.textContent = '+JSON.stringify(source)+'; document.head.appendChild(style); export default '+JSON.stringify(names); };`);
await writeFile(path.join(temp, 'navigation.js'), `export const usePathname = () => location.pathname; export const useParams = () => ({id:'campaign-1'}); export const useRouter = () => ({push: value => { window.__navigation = value; }});`);
await writeFile(path.join(temp, 'link.jsx'), `import React from 'react'; export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`);
await writeFile(path.join(temp, 'entry.jsx'), `import React from 'react'; import {createRoot} from 'react-dom/client';
import Leads from ${JSON.stringify(path.join(root, 'src/app/(dashboard)/leads/scraped/page.tsx'))};
import Layout from ${JSON.stringify(path.join(root, 'src/app/(dashboard)/layout.tsx'))};
import Agents from ${JSON.stringify(path.join(root, 'src/app/(dashboard)/agents/page.tsx'))};
import Monitoring from ${JSON.stringify(path.join(root, 'src/app/(dashboard)/monitoring/page.tsx'))};
import {ColdEmailCampaignWizardPage, ColdEmailCampaignDetailPage} from ${JSON.stringify(path.join(root, 'src/components/cold-email/ColdEmailCampaignPages.tsx'))};
const view = new URLSearchParams(location.search).get('view');
const Page = view === 'wizard' ? ColdEmailCampaignWizardPage : view === 'campaign' ? ColdEmailCampaignDetailPage : view === 'agents' ? Agents : view === 'monitoring' ? Monitoring : Leads;
createRoot(document.getElementById('root')).render(<Layout><Page /></Layout>);`);
await new Promise((resolve, reject) => webpack.webpack({
    mode: 'development', devtool: false, context: root, target: 'web',
    entry: path.join(temp, 'entry.jsx'), output: { path: temp, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src'), 'next/navigation': path.join(temp, 'navigation.js'), 'next/link': path.join(temp, 'link.jsx') } },
    module: { rules: [{ test: /\.[tj]sx?$/, exclude: /node_modules/, use: path.join(temp, 'ts-loader.cjs') }, { test: /\.css$/, use: path.join(temp, 'css-loader.cjs') }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:@prisma\/client|\/lib\/prisma|\/lib\/auth)$/, () => { throw new Error('Server import blocked in client harness'); })],
}, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({all:false,errors:true}))) : resolve()));
const css = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');
const bundle = await readFile(path.join(temp, 'bundle.js'));
const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.writeHead(500); res.end('API requests must be mocked'); return; }
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const calls = [];
let refreshAttempt = 0;
let cleanerScope = {totalSelected:1,found:1,willVerify:0,missingEmail:0,invalidEmail:0,duplicateEmail:0,skippedPersonalEmail:1};
let alertError = false;
let inventoryUnavailable = false;
let campaignState = 'draft';
const leads = ['Alpha Hauling','Beta Removal'].map((name,i) => ({id:`lead-${i+1}`,name,phone:i ? '+1 (312) 555-0123 ext. 4567' : '(512) 555-1234',email:'owner@gmail.com',website:'https://example.com',market:'Austin, TX',grade:'B',leadScore:62,websiteScore:50,qualification:'FIT',outreachStatus:'new',painPoints:[],reasons:[],notesFlags:[],createdAt:'2026-09-08T12:00:00Z'}));
const groups = [{id:'static',name:'Static group',filterDefinition:null,_count:{members:2}}, {id:'dynamic',name:'Dynamic group',filterDefinition:{},_count:{members:2}}];
await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = req.postDataJSON(); calls.push({path:url.pathname,method:req.method(),body});
    const send = (data,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if (url.pathname === '/api/alerts') return alertError ? send({error:'Unavailable'},503) : send({counts:{critical:0,warning:0}});
    if (url.pathname === '/api/agents/leads') return send(url.searchParams.has('idsOnly') ? {ids:['lead-1','lead-2','lead-3'],total:3} : {leads,total:3,funnel:{total:3,new:3,emailed:0,sms_sent:0,replied:0,converted:0,skipped:0},markets:['Austin, TX'],states:['TX']});
    if (url.pathname === '/api/agents/lead-groups') return send(req.method() === 'POST' ? {id:'created-segment',name:body.name} : {groups:groups.map(g => ({...g,memberCount:2}))});
    if (url.pathname === '/api/agents/lead-groups/refresh') return refreshAttempt++ === 0 ? send({error:'Simulated membership failure'},500) : send({ok:true,total:2});
    if (url.pathname === '/api/agents/lead-groups/members') return send({ok:true,added:body.leadIds.length});
    if (url.pathname === '/api/agents/email-cleaner') return body.dryRun ? send({ok:true,dryRun:true,...cleanerScope}) : send({ok:true,mode:'sync',scope:cleanerScope,summary:{deliverable:0,archived:0,risky:1,unknown:0,failed:0}});
    if (url.pathname === '/api/cold-email/platform/catalog') return send({leadGroups:groups,sequences:[],templates:[]});
    if (url.pathname === '/api/cold-email/platform/infrastructure') return send({accounts:[],domains:[],pools:[],capabilities:[]});
    if (url.pathname.endsWith('/audience')) return send({audience:{items:[],reasonCounts:[]},diagnosis:{issues:campaignState === 'approved' ? [{code:'audience_evaluation_pending',detail:'Evaluation pending'}] : [],facts:{}}});
    if (url.pathname === '/api/cold-email/platform/campaigns/campaign-1') return send({campaign:{id:'campaign-1',name:'Test campaign',status:'draft',versions:[{id:'version-1',version:1,status:campaignState,operationalRules:{wizard:{audience:{leadGroupId:'dynamic',refreshBeforeSnapshot:true}}},providerOperations:[]}]}});
    if (url.pathname === '/api/agents') return inventoryUnavailable ? send({error:'unavailable'},503) : send([{id:'a',slug:'lead_enrichment',name:'Lead Enrichment',status:'running',enabled:true,description:'Runs inside the dashboard',config:{},totalRuns:1,lastRun:{id:'run',status:'running',trigger:'manual',startedAt:'2026-09-04T12:00:00Z',results:null}}]);
    if (url.pathname === '/api/monitoring/cron') return send({jobs:[{jobName:'weekly-report',lastRun:null,totalRuns:0,errorCount:0}],sourceSchedule:JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8')).crons});
    if (/\/saved-views$|\/capabilities$/.test(url.pathname)) return send({items:[]});
    return send({error:`Unmocked route ${url.pathname}`},500);
});
try {
    await page.goto(origin);
    const alpha = page.getByRole('checkbox',{name:'Select Alpha Hauling'});
    await alpha.click(); assert.equal(await alpha.isChecked(),true);
    await alpha.click(); assert.equal(await alpha.isChecked(),false);
    await alpha.focus(); await page.keyboard.press('Space'); assert.equal(await alpha.isChecked(),true);
    await page.getByRole('button',{name:'Add to Group',exact:false}).click();
    await page.getByRole('button',{name:'Static group',exact:false}).click();
    assert.deepEqual(calls.find(c => c.path.endsWith('/members')).body.leadIds,['lead-1']);
    await page.locator('thead input[type=checkbox]').check();
    assert.equal(await page.locator('tbody input:checked').count(),2);
    await page.getByRole('button',{name:/Select all 3/}).click();
    await page.getByRole('button',{name:'Add to Group',exact:false}).click();
    await page.getByRole('button',{name:'Static group',exact:false}).click();
    assert.deepEqual(calls.filter(c => c.path.endsWith('/members')).at(-1).body.leadIds,['lead-1','lead-2','lead-3']);
    await alpha.check();
    await page.getByRole('button',{name:'Add to Group',exact:false}).click();
    await page.getByPlaceholder('Group name...').fill('Recoverable segment');
    await page.getByRole('button',{name:'+ Email segment',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'membership needs retry'}).waitFor();
    await page.getByRole('button',{name:'Retry membership'}).click();
    await page.getByRole('alert').filter({hasText:'membership needs retry'}).waitFor({state:'detached'});
    assert.equal(calls.filter(c => c.path === '/api/agents/lead-groups' && c.method === 'POST').length,1);
    assert.deepEqual(calls.filter(c => c.path.endsWith('/refresh')).map(c=>c.body.groupId),['created-segment','created-segment']);
    await page.getByRole('button',{name:'Clean List',exact:false}).click();
    await page.getByText('No supported verification targets.',{exact:false}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/email-cleaner') && !c.body.dryRun).length,0);
    cleanerScope = {...cleanerScope,willVerify:1};
    page.once('dialog',dialog=>{assert.match(dialog.message(),/1 unique personal-domain emails skipped/);dialog.accept();});
    await page.getByRole('button',{name:'Clean List',exact:false}).click();
    await page.getByRole('status').filter({hasText:'1 risky'}).waitFor();
    await page.getByText('Email cleaning finished. Review the result summary.',{exact:true}).waitFor({state:'detached'});
    for (const width of [375,414,768,1024,1440]) {
        await page.setViewportSize({width,height:1000});
        const layout = await page.getByRole('region',{name:'Scraped leads table'}).evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,wrap:getComputedStyle(el.querySelector('tbody tr td:nth-child(9)')).whiteSpace}));
        assert.equal(layout.wrap,'nowrap');
        assert.ok(layout.width <= width, `Table scroll container exceeds ${width}px viewport`);
        await page.screenshot({path:path.join(temp,`leads-${width}.png`),fullPage:true});
        const table = page.getByRole('region',{name:'Scraped leads table'});
        await table.evaluate(el => { el.scrollLeft = el.querySelector('tbody tr td:nth-child(9)').offsetLeft - el.offsetLeft; });
        await table.screenshot({path:path.join(temp,`phone-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await page.locator('tbody tr td:nth-child(9)').first().evaluate(el => getComputedStyle(el).whiteSpace),'nowrap');
    await page.goto(origin+'/?view=wizard');
    await page.getByRole('button',{name:'2 Audience'}).click();
    await page.locator('select').first().selectOption('static');
    const refresh = page.getByRole('checkbox',{name:/Require a dynamic/});
    assert.equal(await refresh.isChecked(),false); assert.equal(await refresh.isDisabled(),true);
    await page.locator('select').first().selectOption('dynamic');
    assert.equal(await refresh.isChecked(),true); assert.equal(await refresh.isDisabled(),false);
    await page.locator('select').first().selectOption('static'); assert.equal(await refresh.isChecked(),false);
    await page.screenshot({path:path.join(temp,'static-audience.png'),fullPage:true});
    await page.goto(origin+'/?view=campaign');
    await page.getByRole('button',{name:'approve',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'approve',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'prepare',exact:true}).isDisabled(),true);
    campaignState='approved'; await page.reload();
    await page.getByRole('button',{name:'prepare',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'prepare',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Queue controlled test'}).isDisabled(),true);
    await page.goto(origin+'/?view=agents');
    await page.getByText(/Queued; waiting for an external worker/).waitFor();
    assert.equal(await page.getByText('Runs inside the dashboard',{exact:true}).count(),0);
    await page.getByRole('alert').filter({hasText:'Lead Cleaner setup incomplete'}).waitFor();
    await page.screenshot({path:path.join(temp,'agent-observations.png'),fullPage:true});
    inventoryUnavailable=true; await page.reload();
    await page.getByRole('alert').filter({hasText:'Agent inventory unavailable'}).waitFor();
    assert.equal(await page.getByRole('alert').filter({hasText:'Lead Cleaner setup incomplete'}).count(),0);
    await page.goto(origin+'/?view=monitoring');
    await page.getByText('No logged evidence',{exact:true}).waitFor();
    await page.screenshot({path:path.join(temp,'cron-evidence.png'),fullPage:true});
    alertError=true; await page.reload(); await page.getByRole('button',{name:'Alerts unknown'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['native click and Space','exact bulk scope','page versus all-matching','segment failure and same-group retry','personal-only zero-run preview','mixed verification confirmation/results','phone layout at five widths','static/dynamic wizard','approval/preparation/test gates','queued worker/missing cleaner copy','cron source scope','alerts unavailable'],artifacts:temp},null,2));
} finally { await context.close(); await browser.close(); await new Promise(resolve=>server.close(resolve)); }
