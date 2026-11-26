import {expect,it} from 'vitest';
import {createBothouseResidentModel} from '../src/client/bothouse-resident-model.ts';

it('shows the town ledger for work and keeps the reduced-motion pose still',()=>{
  const resident=createBothouseResidentModel('dragon');
  try{
    const ledger=resident.root.getObjectByName('work-ledger')!;
    const rig=resident.root.getObjectByName('rig')!;
    const hand=resident.root.getObjectByName('elbow1');
    const footBaseline=rig.position.y;
    expect(ledger.parent).toBe(hand);
    expect(ledger.visible).toBe(false);

    resident.animate('working',2,true);
    expect(ledger.visible).toBe(true);
    const still=ledger.getWorldQuaternion(ledger.quaternion.clone()).toArray();
    resident.animate('working',8,true);
    expect(ledger.getWorldQuaternion(ledger.quaternion.clone()).toArray()).toEqual(still);
    expect(rig.position.y).toBe(footBaseline);

    for(const activity of ['idle','thinking','talking','waiting','offline','unknown'] as const){
      resident.animate('working',1,false);
      resident.animate(activity,2,false);
      expect(ledger.visible).toBe(false);
    }
  }finally{resident.dispose();}
});

it('drops the flower lean and greeting arm as soon as a work update arrives',()=>{
  const resident=createBothouseResidentModel('dragon');
  try{
    const torso=resident.root.getObjectByName('body')!;
    const arm=resident.root.getObjectByName('upper1')!;
    const ledger=resident.root.getObjectByName('work-ledger')!;
    for(const [wave,lean] of [[.4,0],[0,1]]){
      resident.animate('idle',1,false,0,wave,lean);
      expect(arm.rotation.z>1.5).toBe(wave>0);
      expect(torso.rotation.x>.25).toBe(lean>0);
      expect(ledger.visible).toBe(false);
      resident.animate('working',1,false,0,wave,lean);
      expect(arm.rotation.z).toBeLessThan(.5);
      expect(torso.rotation.x).toBeLessThan(.25);
      expect(ledger.visible).toBe(true);
    }
    resident.animate('idle',1,true,0,0,1);
    expect(torso.rotation.x).toBeLessThan(.25);
    expect(ledger.visible).toBe(false);
  }finally{resident.dispose();}
});

it('raises one empty hand for an idle greeting and yields to activity or reduced motion',()=>{
  const resident=createBothouseResidentModel('dragon');
  try{
    const arm=resident.root.getObjectByName('upper1')!;
    const ledger=resident.root.getObjectByName('work-ledger')!;
    resident.animate('idle',1,false,0,.4);
    expect(arm.rotation.z).toBeGreaterThan(1.5);
    expect(ledger.visible).toBe(false);
    for(const activity of ['working','unknown','offline'] as const){
      resident.animate(activity,1,false,0,.4);
      expect(arm.rotation.z).toBeLessThan(.5);
      expect(ledger.visible).toBe(activity==='working');
    }
    resident.animate('idle',1,true,0,.4);
    expect(arm.rotation.z).toBeLessThan(.5);
    resident.animate('idle',1,false,0,1);
    expect(arm.rotation.z).toBeLessThan(.5);
  }finally{resident.dispose();}
});
it('sits with bent knees and gives work, greetings and reduced motion priority',()=>{
  const resident=createBothouseResidentModel('lanxi');
  const knee=resident.root.getObjectByName('knee1')!;
  const ledger=resident.root.getObjectByName('work-ledger')!;
  try{
    resident.animate('idle',1,false,0,0,0,1);
    expect(knee.rotation.x).toBeCloseTo(Math.PI/2);
    expect(ledger.visible).toBe(false);
    resident.animate('working',1,false,0,0,0,1);
    expect(knee.rotation.x).toBeCloseTo(0);
    expect(ledger.visible).toBe(true);
    resident.animate('idle',1,true,0,0,0,1);
    expect(knee.rotation.x).toBeCloseTo(0);
    resident.animate('idle',1,false,0,.4,0,1);
    expect(knee.rotation.x).toBeCloseTo(0);
  }finally{resident.dispose();}
});
