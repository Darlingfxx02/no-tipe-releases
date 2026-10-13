import {describe,it,expect} from 'vitest';
import {EmpowermentEffect,empowermentColor,empowermentStars,empowermentLayout} from './recorder/empowerment.js';
describe('recorder empowerment effects',()=>{
  it('keeps the effect clock across snapshots, restarts for a new selection, and fades after use',()=>{
    const effect=new EmpowermentEffect(),selection={id:'one',color:'#ED7BA3'};
    effect.update(selection,.05);
    for(let i=0;i<20;i++)effect.update({...selection},.05);
    expect(effect.age).toBeCloseTo(1);expect(effect.amount).toBeGreaterThan(.99);
    expect(effect.update({id:'two',color:'#62C5CF'},.05).age).toBe(0);
    const before=effect.amount;effect.update(null,.05);expect(effect.amount).toBeLessThan(before);
    for(let i=0;i<50;i++)effect.update(null,.05);
    expect(effect.amount).toBeLessThan(.001);
  });
  it('uses the selected color independently of the app palette and freezes motion when requested',()=>{
    const effect=new EmpowermentEffect(),selection={id:'one',color:'#62C5CF'};
    const first=effect.update(selection,.05,true),next=effect.update(selection,.05,true);
    expect(first).toEqual(next);expect(first.color).toEqual([98/255,197/255,207/255]);
    expect(empowermentColor('red;display:none')).toEqual(empowermentColor('#F5C84C'));
    expect(effect.update(null,.05,true).amount).toBe(0);
  });
  it('keeps falling stars inside the central input and reduces the static shower',()=>{
    for(let time=0;time<8;time+=.1)for(const star of empowermentStars(time)){
      expect(Math.abs(star.x)).toBeLessThanOrEqual(10.8);expect(Math.abs(star.y)).toBeLessThanOrEqual(9);
      expect(star.opacity).toBeGreaterThanOrEqual(0);expect(star.opacity).toBeLessThanOrEqual(1);
    }
    expect(empowermentStars(.85,true)).toHaveLength(3);
  });
  it('spreads across expanded input widths without growing into the controls above',()=>{
    const compact=empowermentLayout(90,63),expanded=empowermentLayout(430,63);
    expect(expanded.size[0]).toBeGreaterThan(compact.size[0]*4);
    expect(expanded.size[1]).toBe(compact.size[1]);
    const stars=empowermentStars(.85,false,expanded.size,expanded.count);
    expect(stars.some(star=>star.x<-expanded.size[0]*.7)).toBe(true);
    expect(stars.some(star=>star.x>expanded.size[0]*.7)).toBe(true);
    expect(stars.every(star=>Math.abs(star.y)<=expanded.size[1])).toBe(true);
    expect(expanded.count).toBeGreaterThan(compact.count);
    expect(empowermentLayout(430,63,true).count).toBeLessThan(expanded.count);
    expect(empowermentLayout(10000,63).count).toBeLessThanOrEqual(32);
  });
});
