export function sse(events) {
 return { contentType: 'text/event-stream', body: events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('') };
}
export async function mockOpenRouter(page, { truncated = false, delay = 0 } = {}) {
 const seen=[];
 await page.route('https://openrouter.ai/api/v1/key',route=>route.fulfill({json:{data:{}}}));
 await page.route('https://openrouter.ai/api/v1/models',route=>route.fulfill({json:{data:[{id:'test/writer',name:'Test Writer'}]}}));
 await page.route('https://openrouter.ai/api/v1/chat/completions',async route=>{
  const body=route.request().postDataJSON(); seen.push({body,headers:route.request().headers()});
  const input=JSON.parse(body.messages[1].content);
  const text=JSON.stringify({blocks:input.document.blocks.filter(b=>b.editable).map(b=>({id:b.id,text:b.text.replace('Teh','The')}))});
  if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
  await route.fulfill(sse([{choices:[{delta:{content:text},finish_reason:truncated?null:'stop'}]}])).catch(()=>{});
 });
 return seen;
}
export async function connectOpenRouter(page) {
 await page.goto('/');
 await page.locator('.statusbar__ai').click();
 await page.getByLabel('OpenRouter API key').fill('test-user-key');
 await page.getByLabel('OpenRouter API key').press('Enter');
}
