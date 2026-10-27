import { test, expect } from '@playwright/test';
import { mockOpenRouter, connectOpenRouter } from './direct-provider.js';
async function setup(page, options) {
 const seen=await mockOpenRouter(page,options);
 await connectOpenRouter(page);
 await expect(page.locator('.conn',{hasText:'OpenRouter'}).getByText('In use')).toBeVisible();
 await page.getByRole('button',{name:'Done'}).click();
 await page.getByRole('tab',{name:/AI/u}).click();
 return seen;
}
test('direct AI rewrite is reviewed, applied and undone without backend requests',async({page})=>{
 const backend=[]; page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/') && new URL(r.url()).hostname==='127.0.0.1') backend.push(r.url())});
 const seen=await setup(page);
 await page.getByRole('button',{name:'Fix grammar'}).click();
 const result=page.getByRole('region',{name:'Proposed changes'});
 await expect(result).toBeVisible();
 await expect(page.locator('.ProseMirror')).toContainText('Teh report');
 expect(seen[0].headers.authorization).toBe('Bearer test-user-key');
 expect(JSON.stringify(seen[0].body)).not.toContain('test-user-key');
 await result.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(page.locator('.ProseMirror')).toContainText('The report');
 await page.locator('.assist').getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.locator('.ProseMirror')).toContainText('Teh report');
 expect(backend).toEqual([]);
});
test('a truncated provider response cannot be applied',async({page})=>{
 await setup(page,{truncated:true});
 await page.getByRole('button',{name:'Fix grammar'}).click();
 await expect(page.getByText('The response ended before it was complete. Try again.')).toBeVisible();
 await expect(page.getByRole('region',{name:'Proposed changes'})).toHaveCount(0);
 await expect(page.locator('.ProseMirror')).toContainText('Teh report');
});
test('user can remove a locally saved key',async({page})=>{
 await setup(page);
 await page.reload();
 await expect(page.locator('.statusbar__ai')).toContainText('Test Writer');
 await page.locator('.statusbar__ai').click();
 await page.locator('.conn',{hasText:'OpenRouter'}).getByRole('button',{name:'Remove key'}).click();
 await page.getByRole('button',{name:'Done'}).click();
 await page.reload();
 await expect(page.locator('.statusbar__ai')).toHaveText('AI: not connected');
});
