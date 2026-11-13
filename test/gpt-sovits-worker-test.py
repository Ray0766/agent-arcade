"""Synthetic worker checks; no audio device/model/network is used."""
import unittest, pathlib, sys, socket, contextlib, types
from unittest.mock import patch
import numpy as np

source=pathlib.Path(__file__).resolve().parents[1]/'src/voice/gpt-sovits-worker.py'
namespace={'__name__':'worker_fixture'}
saved_stdout=sys.stdout;saved_connect=socket.socket.connect;saved_create=socket.create_connection
try:
    with patch.object(sys,'argv',['fixture','fixture-repo','fixture-reference.wav']):exec(compile(source.read_text(encoding='utf-8'),str(source),'exec'),namespace)
finally:
    sys.stdout=saved_stdout;socket.socket.connect=saved_connect;socket.create_connection=saved_create

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.events=[];self.writes=[];self.order=[]
        namespace['emit']=lambda event,**data:self.events.append((event,data))
    def play(self,arrays,fail=False,text='一句合成测试。'):
        outer=self
        class Stream:
            def __init__(self,**kw):outer.assertEqual(kw['channels'],1);outer.assertEqual(kw['dtype'],'int16')
            def __enter__(self):return self
            def __exit__(self,*args):outer.order.append('stream-closed')
            def write(self,data):
                if fail:raise RuntimeError('device error')
                outer.writes.append(len(data))
        model=types.SimpleNamespace(run=lambda options:iter(arrays))
        namespace['get_model']=lambda:model
        with patch.dict(sys.modules,{'torch':types.SimpleNamespace(inference_mode=contextlib.nullcontext),'sounddevice':types.SimpleNamespace(RawOutputStream=Stream)}):
            namespace['speak']('test-id',text)
    def test_bounded_punctuation_segments_preserve_text(self):
        text='今天过得怎么样？'*220
        result=namespace['segments'](text)
        self.assertEqual(''.join(result),text);self.assertTrue(all(len(item)<=120 for item in result));self.assertLessEqual(len(result),40)
    def test_real_playback_events_require_device_writes_and_closed_stream(self):
        original=namespace['emit']
        def emit(event,**data):
            if event=='pcm-ready':self.assertFalse(self.writes)
            if event=='playback-start':self.assertTrue(self.writes)
            if event=='playback-end':self.assertEqual(self.order,['stream-closed'])
            original(event,**data)
        namespace['emit']=emit
        self.play([(32000,np.ones(701,dtype=np.int16))])
        self.assertEqual([row[0] for row in self.events],['synthesis-start','pcm-ready','playback-start','playback-end'])
        self.assertEqual(self.events[1][1],{'id':'test-id','segment':1,'sampleRate':32000,'samples':701})
        self.assertEqual(self.writes,[640,640,122])
    def test_no_start_if_output_fails_and_stream_is_closed(self):
        with self.assertRaises(RuntimeError):self.play([(32000,np.ones(500,dtype=np.int16))],fail=True)
        self.assertEqual([row[0] for row in self.events],['synthesis-start','pcm-ready']);self.assertEqual(self.order,['stream-closed'])
    def test_invalid_or_oversized_pcm_never_reaches_device(self):
        for pcm,rate in [(np.ones(32,dtype=np.float32),32000),(np.ones(32,dtype=np.int16),44100),(np.ones(32000*41,dtype=np.int16),32000)]:
            self.events=[]
            with self.assertRaises(ValueError):self.play([(rate,pcm)])
            self.assertEqual(self.writes,[]);self.assertEqual([row[0] for row in self.events],['synthesis-start'])
    def test_phases_are_bounded_per_segment_not_per_audio_block(self):
        text='一句合成测试。'*30
        self.play([(32000,np.ones(100,dtype=np.int16)),(32000,np.ones(200,dtype=np.int16))],text=text)
        starts=[row[1] for row in self.events if row[0]=='synthesis-start']
        pcm=[row[1] for row in self.events if row[0]=='pcm-ready']
        self.assertGreater(len(starts),1);self.assertEqual(len(starts),len(pcm));self.assertEqual(len(self.writes),len(starts)*2)
        self.assertEqual([row['segment'] for row in starts],list(range(1,len(starts)+1)))
        self.assertTrue(all(row['segments']==len(starts) and 1<=row['characters']<=120 for row in starts))
        self.assertTrue(all(row['samples']==100 for row in pcm));self.assertNotIn(text,str(self.events))
    def test_empty_synthesis_is_not_reported_as_played(self):
        with self.assertRaises(ValueError):self.play([])
        self.assertEqual(self.writes,[]);self.assertEqual([row[0] for row in self.events],['synthesis-start'])

if __name__=='__main__':unittest.main()
