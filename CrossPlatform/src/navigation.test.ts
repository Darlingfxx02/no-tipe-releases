import {expect, it} from 'vitest';
import {orderedSidebar} from './navigation';
import type {Preferences} from './types';

it('restores old sidebar orders without losing new pages or duplicating entries',()=>{
  expect(orderedSidebar({} as Preferences).map(([name])=>name)).toEqual(['Dashboard','Insights','Modes','Transcribe','Dictionary','Customization']);
  const restored={sidebarOrder:['Customization','removed-page','Customization','Dashboard']} as unknown as Preferences;
  expect(orderedSidebar(restored).map(([name])=>name)).toEqual(['Customization','Dashboard','Insights','Modes','Transcribe','Dictionary']);
});
