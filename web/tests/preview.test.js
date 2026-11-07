import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview } from '../preview.js';

test('preview returns lossless worker bytes and dimensions without filesystem or download access', async () => {
  const png = new Uint8Array(40_000);
  png.set([137,80,78,71,13,10,26,10]);
  const header = new DataView(png.buffer); header.setUint32(16,390); header.setUint32(20,844);
  let calls = 0;
  const result = await renderPreview({ args:{node_id:42}, fonts:[], snapshot:async ()=>'document', compute:{async run(operation,payload){
    calls++; assert.equal(operation,'export'); assert.equal(payload.document,'document');
    assert.deepEqual(payload.args,{node_id:42,format:'png',path:'/preview.png',scale:1}); return png;
  }}});
  assert.equal(calls,1); assert.equal(result.width,390); assert.equal(result.height,844);
  assert.deepEqual(new Uint8Array(Buffer.from(result.data_url.split(',')[1],'base64')),png);
});

test('cancelled or non-image preview cannot become a successful result', async () => {
  const ac=new AbortController();ac.abort();
  await assert.rejects(renderPreview({args:{node_id:1},fonts:[],signal:ac.signal,snapshot:async()=>'',compute:{run:async()=>new Uint8Array(24)}}),{name:'AbortError'});
  await assert.rejects(renderPreview({args:{node_id:1},fonts:[],snapshot:async()=>'',compute:{run:async()=>new Uint8Array(24)}}),/did not return PNG/);
});
