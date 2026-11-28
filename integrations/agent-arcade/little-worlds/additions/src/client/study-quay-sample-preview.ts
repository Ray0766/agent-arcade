import { Color, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { quayRepairMechanism } from './town-quay-repair-prop.ts';
import './study-quay-sample-preview.css';

/** A front-facing readout of the small support. The caller owns the draft and saves. */
export function createStudyQuaySamplePreview() {
  const element=document.createElement('figure');
  const canvas=document.createElement('canvas');
  const reading=document.createElement('figcaption');
  element.className='study-quay-sample-preview';
  canvas.setAttribute('aria-hidden','true');
  element.append(canvas,reading);

  const scene=new Scene();
  scene.background=new Color('#e6eada');
  const light=new DirectionalLight('#fff0d6',2);
  light.position.set(-1,2,1.4);
  scene.add(new HemisphereLight('#fffaed','#647b70',1.7),light);
  const mechanism=quayRepairMechanism();
  scene.add(mechanism.root);
  const camera=new OrthographicCamera(-.52,.52,.32,-.32,.1,5);
  camera.position.set(0,2.1,1.4);
  camera.lookAt(0,.067,.073);
  let renderer:WebGLRenderer|undefined;
  let turn=0;
  let disposed=false;
  try {
    renderer=new WebGLRenderer({canvas,antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  } catch {
    canvas.hidden=true;
  }
  const draw=()=>{
    if(!renderer||disposed)return;
    const {width,height}=canvas.getBoundingClientRect();
    if(width<1||height<1)return;
    const horizontal=Math.max(.39,.285*width/height);
    const vertical=horizontal*height/width;
    camera.left=-horizontal;camera.right=horizontal;
    camera.top=vertical;camera.bottom=-vertical;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    renderer.render(scene,camera);
  };
  const observer=new ResizeObserver(draw);
  if(renderer)observer.observe(canvas);
  const setTurn=(value:number)=>{
    if(disposed)return;
    turn=Number.isInteger(value)?Math.max(-3,Math.min(3,value)):0;
    mechanism.setTurn(turn);
    const zh=document.documentElement.lang.startsWith('zh');
    const count=Math.abs(turn);
    const direction=turn<0?(zh?'左':'left'):(zh?'右':'right');
    reading.textContent=turn===0?(zh?'两条刻线已对齐':'Witness lines aligned'):
      zh?'活动刻线向'+direction+'偏 '+count+' 格':
        'Moving line: '+count+' '+(count===1?'notch':'notches')+' '+direction+' of centre';
    draw();
  };
  setTurn(0);
  return {
    element,
    setTurn,
    dispose(){
      if(disposed)return;
      disposed=true;
      observer.disconnect();
      mechanism.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      element.remove();
    },
  };
}
