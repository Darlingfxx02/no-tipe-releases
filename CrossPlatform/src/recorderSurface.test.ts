import {expect,test} from 'vitest';
import {pixelSurfaceLayout,surfaceScissor,recorderRenderScale} from './recorder/surface.js';

test('expanding settings keeps the robot buffer fixed and its center on the toolbar',()=>{
  for(const scale of [.6,.8,1])for(let step=0;step<=30;step++){
    const progress=step/30,bounds={width:90*scale+(430-90*scale)*progress,height:63*scale+(206-63*scale)*progress};
    const surface=pixelSurfaceLayout(bounds);
    expect([surface.width,surface.height]).toEqual([282,255]);
    expect(surface.left+surface.center[0]).toBeCloseTo(bounds.width/2);
    expect(surface.top+surface.center[1]).toBeCloseTo(bounds.height-Math.min(63,bounds.height)/2);
    expect(surface.scale).toBeGreaterThanOrEqual(scale);
    expect(surface.scale).toBeLessThanOrEqual(1);
  }
});

test('the onboarding illustration keeps its larger canvas and centered robot',()=>{
  const surface=pixelSurfaceLayout({width:180,height:126},true);
  expect([surface.width,surface.height,surface.scale]).toEqual([372,318,2]);
  expect(surface.left+surface.center[0]).toBe(90);
  expect(surface.top+surface.center[1]).toBe(63);
});

test('scissor includes detached controls and upper translation lobes at fractional DPI',()=>{
  const bounds=surfaceScissor(750,500,[
    {x:318.75,y:396.25,width:112.5,height:78.75},
    {x:241.875,y:406.25,width:55,height:55},
    {x:453.125,y:406.25,width:55,height:55},
    {x:292.375,y:296.875,width:165,height:45},
  ],20);
  expect(bounds).toEqual([221,5,308,219]);
});

test('offscreen scissor bounds remain nonnegative and clamp to the canvas',()=>{
  expect(surfaceScissor(600,400,[{x:-10,y:-10,width:650,height:450}],16)).toEqual([0,0,600,400]);
  for(const [x,y] of [[-100,-100],[700,500]]){
    const [left,bottom,width,height]=surfaceScissor(600,400,[{x,y,width:10,height:10}],1);
    expect(left).toBeGreaterThanOrEqual(0);expect(left).toBeLessThanOrEqual(600);
    expect(bottom).toBeGreaterThanOrEqual(0);expect(bottom).toBeLessThanOrEqual(400);
    expect(width).toBe(0);expect(height).toBe(0);
  }
});

test('Windows scene density follows display DPI up to 2x and adapts when moving screens',()=>{
  for(const dpr of [1,1.25,1.5,2,3,4]){
    expect(dpr*recorderRenderScale('Win32 Windows NT 10.0',dpr)).toBeCloseTo(Math.min(2,dpr));
    expect(recorderRenderScale('MacIntel Macintosh',dpr)).toBe(1.5);
    expect(recorderRenderScale('Linux x86_64',dpr)).toBe(1.5);
  }
});
