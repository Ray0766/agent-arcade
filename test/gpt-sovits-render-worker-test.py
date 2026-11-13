"""Synthetic arrays only. No model load, device, file audio, network or QQ."""
import unittest, pathlib, sys, socket, contextlib, types, builtins, io, json, base64, hashlib
from unittest.mock import patch
import numpy as np

source=pathlib.Path(__file__).resolve().parents[1]/'src/voice/gpt-sovits-worker.py'
namespace={'__name__':'render_fixture'}
saved_stdout=sys.stdout;saved_connect=socket.socket.connect;saved_create=socket.create_connection
try:
    with patch.object(sys,'argv',['fixture','fake-repo','fake-reference.wav']):exec(compile(source.read_text(encoding='utf8'),str(source),'exec'),namespace)
finally:
    sys.stdout=saved_stdout;socket.socket.connect=saved_connect;socket.create_connection=saved_create

class RenderTests(unittest.TestCase):
    def setUp(self):
        self.events=[];self.options=[]
        namespace['emit']=lambda event,**values:self.events.append({'event':event,**values})
    def run_render(self,arrays,text='纯合成测试。',error=None):
        def run(options):
            self.options.append(options)
            yield from arrays
            if error:raise error
        namespace['get_model']=lambda:types.SimpleNamespace(run=run)
        original=builtins.__import__
        def no_device(name,*args,**kwargs):
            if name=='sounddevice':raise AssertionError('render must not import playback')
            return original(name,*args,**kwargs)
        with patch.dict(sys.modules,{'torch':types.SimpleNamespace(inference_mode=contextlib.nullcontext)}),patch('builtins.__import__',no_device):
            namespace['render']('fixture-id',text)
    def test_exact_pcm_frame_hash_and_normal_final_without_output_device(self):
        pcm=np.arange(16000,dtype=np.int16)
        self.run_render([(32000,pcm)])
        frames=[row for row in self.events if row['event']=='render-pcm']
        raw=b''.join(base64.b64decode(row['data']) for row in frames)
        self.assertEqual(raw,pcm.astype('<i2').tobytes());self.assertTrue(all(len(base64.b64decode(row['data']))<=8192 for row in frames))
        self.assertEqual([row['seq'] for row in frames],list(range(1,len(frames)+1)))
        self.assertEqual(self.events[-1],{'event':'render-end','id':'fixture-id','frames':len(frames),'samples':16000,'sha256':hashlib.sha256(raw).hexdigest()})
        self.assertFalse(any(row['event'].startswith('playback') for row in self.events))
        self.assertEqual(self.options[0]['seed'],20261105);self.assertFalse(self.options[0]['streaming_mode']);self.assertFalse(self.options[0]['parallel_infer']);self.assertFalse(self.options[0]['use_cuda_graph'])
    def test_model_exception_after_partial_yield_is_never_complete(self):
        with self.assertRaises(RuntimeError):self.run_render([(32000,np.ones(6400,dtype=np.int16))],error=RuntimeError('synthetic'))
        self.assertTrue(any(row['event']=='render-pcm' for row in self.events));self.assertFalse(any(row['event']=='render-end' for row in self.events))
    def test_limits_and_empty_fallback_fail_without_final(self):
        cases=[[],[(32000,np.zeros(6400,dtype=np.int16))],[(32000,np.ones(6399,dtype=np.int16))],[(16000,np.ones(6400,dtype=np.int16))],[(32000,np.ones(6400,dtype=np.float32))],[(32000,np.ones((6400,1),dtype=np.int16))],[(32000,np.ones(960001,dtype=np.int16))],[(32000,np.ones(600000,dtype=np.int16)),(32000,np.ones(400000,dtype=np.int16))]]
        for arrays in cases:
            self.events=[]
            with self.assertRaises(ValueError):self.run_render(arrays)
            self.assertFalse(any(row['event']=='render-end' for row in self.events))
    def test_exact_boundaries_and_unicode_text(self):
        self.run_render([(32000,np.ones(960000,dtype=np.int16))],text='😀'*120)
        self.assertEqual(self.events[-1]['samples'],960000)
        for text in ['', ' ', '字'*121, '😀'*121, 'x\0y', '\ud800']:
            self.events=[]
            with self.assertRaises(ValueError):self.run_render([],text=text)
            self.assertEqual(self.events,[])
    def test_fragment_count_is_bounded_independently_of_pcm_samples(self):
        with self.assertRaises(ValueError):self.run_render([(32000,np.ones(1,dtype=np.int16))]*513)
        self.assertEqual(sum(row['event']=='render-pcm' for row in self.events),512)
        self.assertFalse(any(row['event']=='render-end' for row in self.events))
    def test_worker_startup_and_render_request_never_import_or_query_sounddevice(self):
        namespace['get_model']=lambda:types.SimpleNamespace(run=lambda options:iter([(32000,np.ones(6400,dtype=np.int16))]))
        input_data=(json.dumps({'id':'request','op':'render','text':'测试'})+'\n').encode()
        original=builtins.__import__
        def no_device(name,*args,**kwargs):
            if name=='sounddevice':raise AssertionError('no output dependency')
            return original(name,*args,**kwargs)
        with patch.dict(sys.modules,{'torch':types.SimpleNamespace(inference_mode=contextlib.nullcontext)}),patch('builtins.__import__',no_device),patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(input_data))):namespace['main']()
        self.assertEqual(self.events[0]['event'],'ready');self.assertFalse(self.events[0]['outputChecked']);self.assertEqual(self.events[-1]['event'],'render-end')

class CleanRenderTests(unittest.TestCase):
    def test_clean_terminal_follows_request_release_and_zeroed_pcm(self):
        pcm=np.arange(8000,dtype=np.int16);expected=pcm.astype('<i2').tobytes();events=[]
        namespace['get_model']=lambda:types.SimpleNamespace(run=lambda options:iter([(32000,pcm)]))
        def emit(event,**values):
            if event=='render-end':
                import inspect
                local=inspect.currentframe().f_back.f_locals
                self.assertIsNone(local['row']);self.assertIsNone(local['raw']);self.assertIsNone(local['text']);self.assertTrue(np.all(pcm==0));self.assertTrue(values['cleaned'])
            events.append({'event':event,**values})
        namespace['emit']=emit
        request=(json.dumps({'id':'synthetic','op':'render','text':'新合成短句','clean':True})+'\n').encode()
        with patch.dict(sys.modules,{'torch':types.SimpleNamespace(inference_mode=contextlib.nullcontext)}),patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(request))):namespace['main']()
        actual=b''.join(base64.b64decode(e['data']) for e in events if e['event']=='render-pcm')
        self.assertEqual(actual,expected);self.assertEqual(events[-1]['event'],'render-end');self.assertTrue(events[-1]['cleaned'])

if __name__=='__main__':unittest.main()




