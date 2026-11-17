import {test as base} from '@playwright/test';
export {expect} from '@playwright/test';
export type {Page,BrowserContext,APIRequestContext} from '@playwright/test';
// Browser regressions reuse cached history and never spend the owner's provider allowance.
// Intraday UI tests override this context route with explicit, labeled fixtures.
export const test=base.extend<{noProviderPolling:void}>({noProviderPolling:[async({context},use)=>{
 await context.route('**/api/quotes/intraday?**',route=>route.fulfill({json:{configured:false,feeds:{},session:{status:'closed'},refresh_interval_seconds:60,budget:{paused:false}}}));
 await use();
},{auto:true}]});
