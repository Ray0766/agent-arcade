'use strict';

const EXIF_HEADER=Buffer.from('Exif\0\0','ascii');

function readExifOrientation(app1){
  if(app1.length<14||!app1.subarray(0,6).equals(EXIF_HEADER))return;
  const tiff=app1.subarray(6),order=tiff.toString('ascii',0,2);
  if(order!=='II'&&order!=='MM')return;
  const littleEndian=order==='II';
  const view=new DataView(tiff.buffer,tiff.byteOffset,tiff.length);
  if(view.getUint16(2,littleEndian)!==42)return;
  const directory=view.getUint32(4,littleEndian);
  if(directory<8||directory>tiff.length-2)return;
  const count=view.getUint16(directory,littleEndian),start=directory+2;
  if(count>Math.floor((tiff.length-start)/12))return;
  for(let offset=start;offset<start+count*12;offset+=12){
    if(view.getUint16(offset,littleEndian)!==0x0112)continue;
    if(view.getUint16(offset+2,littleEndian)!==3||view.getUint32(offset+4,littleEndian)!==1)return;
    const orientation=view.getUint16(offset+8,littleEndian);
    if(orientation>=1&&orientation<=8)return orientation;
    return;
  }
}

function orientNativeImage(image,orientation,nativeImage){
  if(orientation===1)return image;
  const {width,height}=image.getSize(),transposed=orientation>=5;
  const outputWidth=transposed?height:width,outputHeight=transposed?width:height;
  const flipX=[2,3,6,7].includes(orientation),flipY=[3,4,7,8].includes(orientation);
  const bytes=image.toBitmap({scaleFactor:1});
  if(!Buffer.isBuffer(bytes)||bytes.length!==width*height*4)throw Error('Invalid JPEG bitmap');
  const output=Buffer.alloc(bytes.length);
  // Move whole pixels without interpreting the native channel order.
  const source=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  const result=new DataView(output.buffer,output.byteOffset,output.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const column=transposed?y:x,row=transposed?x:y;
      const targetX=flipX?outputWidth-1-column:column,targetY=flipY?outputHeight-1-row:row;
      result.setUint32((targetY*outputWidth+targetX)*4,source.getUint32((y*width+x)*4));
    }
  }
  const oriented=nativeImage.createFromBitmap(output,{width:outputWidth,height:outputHeight,scaleFactor:1});
  const shape=oriented.getSize();
  if(oriented.isEmpty()||shape.width!==outputWidth||shape.height!==outputHeight)throw Error('Invalid oriented JPEG bitmap');
  return oriented;
}

module.exports={readExifOrientation,orientNativeImage};
