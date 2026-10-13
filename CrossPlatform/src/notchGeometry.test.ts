import {expect,test} from 'vitest';
import {notchLayout,notchAnimatedLayout} from './notchGeometry';

test('moving an expanded recorder between hardware and flat screens recalculates its layout',()=>{
  const hardware={top:32,cutoutWidth:184,maximumWidth:560};
  const flat={top:0,cutoutWidth:0,maximumWidth:560};
  expect(notchLayout(hardware,true,false,null)).toMatchObject({hardware:true,dockWidth:184,width:264,height:32});
  expect(notchLayout(flat,true,false,null)).toMatchObject({hardware:false,dockWidth:112,width:192,height:32});
  expect(notchLayout(flat,false,false,null).height).toBe(32);
  expect(notchLayout(flat,true,true,null)).toMatchObject({width:320,height:136});
  expect(notchLayout(hardware,true,false,40)).toMatchObject({width:360,height:102});
});

test('menu-bar height alone never creates a physical camera exclusion',()=>{
  expect(notchLayout({top:24,cutoutWidth:0,maximumWidth:560},false,false,null)).toMatchObject({hardware:false,dockWidth:112,dockHeight:32});
  expect(notchLayout({top:0,cutoutWidth:184,maximumWidth:560},false,false,null).hardware).toBe(false);
});

test('settings and language labels fit the destination display',()=>{
  expect(notchLayout({top:0,cutoutWidth:0,maximumWidth:240},true,true,null)).toMatchObject({width:240,shortLanguages:true});
  expect(notchLayout({top:38,cutoutWidth:210,maximumWidth:560},true,true,null)).toMatchObject({dockHeight:38,height:142});
});

test('expanded controls reach the panel corners on flat and hardware displays',()=>{
  for(const dockWidth of [112,184]){
    expect(notchAnimatedLayout(dockWidth,32,320,136,136,1)).toMatchObject({menu:1,materialWidth:320,controlSide:140});
    expect(notchAnimatedLayout(dockWidth,32,360,82,82,1)).toMatchObject({menu:1,controlSide:160});
  }
});

test('the material and buttons stay together throughout transcript collapse',()=>{
  for(const dockWidth of [112,184]){
    for(let step=0;step<=60;step++){
      const progress=step/60,controlWidth=dockWidth+80;
      const width=360+(controlWidth-360)*progress,height=82-50*progress;
      const layout=notchAnimatedLayout(dockWidth,32,width,height,82,1);
      expect(layout.materialHeight).toBe(height);
      expect(layout.controlSide+16).toBeLessThanOrEqual(width/2+.001);
      // Every control paints into the very circle used by the material.
      expect(layout.controlSide).toBeGreaterThanOrEqual(dockWidth/2+24);
      expect(layout.materialWidth).toBeGreaterThanOrEqual(dockWidth);
    }
    expect(notchAnimatedLayout(dockWidth,32,dockWidth+80,32,82,1)).toMatchObject({menu:0,materialWidth:dockWidth,controlSide:dockWidth/2+24});
  }
});
