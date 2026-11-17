import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',globalSetup:'./e2e/global-setup.ts',fullyParallel:false,workers:1,timeout:60000,reporter:[['list'],['html',{open:'never'}]],use:{baseURL:'http://localhost:3000',channel:'chrome',viewport:{width:1600,height:1000},trace:'off',video:'off',screenshot:'only-on-failure'}});
