"""Timing and destination safeguards; no media model or test video required."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('export_replay',Path(__file__).resolve().parents[1]/'export_replay.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ReplayClock = MODULE.ReplayClock


class TimingTests(unittest.TestCase):
    def test_legacy_requires_explicit_pose_and_music_offsets(self):
        frames = [{'time':.47},{'time':1.47}]
        for kwargs in ({},{'pose_offset':.47},{'music_offset':1.3}):
            with self.assertRaisesRegex(ValueError,'BOTH'):
                ReplayClock(frames,**kwargs)

    def test_legacy_advance_and_pose_clock_are_distinct(self):
        clock = ReplayClock([{'time':.47},{'time':31.14}],.4706,1.3)
        self.assertAlmostEqual(clock.video_at_reference(10),10.8294)
        self.assertAlmostEqual(clock.pose_at_video(10.8294),11.3)
        start,end = clock.bounds(30.6667,30)
        self.assertEqual(start,0)
        self.assertAlmostEqual(end,29.8373)
        self.assertIn('editorial estimate',clock.provenance)

    def test_new_anchors_piecewise_clock_and_no_extrapolation(self):
        clock = ReplayClock([{'time':0,'videoTime':.1},{'time':1,'videoTime':1.2},
                             {'time':2,'videoTime':2.4}])
        self.assertAlmostEqual(clock.video_at_reference(.5),.65)
        self.assertAlmostEqual(clock.video_at_reference(1.5),1.8)
        self.assertIsNone(clock.video_at_reference(-.01))
        self.assertIsNone(clock.video_at_reference(2.01))
        self.assertEqual(clock.pose_at_video(1.5),1.5)

    def test_frozen_music_repeats_skip_stall_without_clock_reversal(self):
        clock = ReplayClock([{'time':0,'videoTime':0},{'time':1,'videoTime':1},
                             {'time':1,'videoTime':2},{'time':2,'videoTime':3}])
        self.assertEqual(clock.video_at_reference(1),2)
        self.assertAlmostEqual(clock.video_at_reference(1.5),2.5)
        self.assertAlmostEqual(clock.video_at_reference(.5),.5)

    def test_invalid_or_mixed_anchors_fail(self):
        bad = [[],[{'time':0},{'time':1,'videoTime':1}],
               [{'time':0,'videoTime':0},{'time':1,'videoTime':0}],
               [{'time':1,'videoTime':0},{'time':0,'videoTime':1}],
               [{'time':0,'videoTime':0},{'time':float('nan'),'videoTime':1}],
               [{'time':0,'videoTime':0},{'time':0,'videoTime':1}]]
        for frames in bad:
            with self.subTest(frames=frames),self.assertRaises(ValueError):
                ReplayClock(frames)

    def test_anchor_cannot_be_silently_overridden_by_estimate(self):
        with self.assertRaisesRegex(ValueError,'override'):
            ReplayClock([{'time':0,'videoTime':0},{'time':1,'videoTime':1}],.4,1.3)

    def test_timestamp_bounds_must_match_real_sources(self):
        clock = ReplayClock([{'time':0,'videoTime':0},{'time':3,'videoTime':4}])
        with self.assertRaisesRegex(ValueError,'recording duration'):
            clock.bounds(2,5)
        with self.assertRaisesRegex(ValueError,'reference duration'):
            clock.bounds(5,2)
        with self.assertRaisesRegex(ValueError,'overlapping'):
            ReplayClock([{'time':0},{'time':1}],0,10).bounds(1,1)


class DestinationTests(unittest.TestCase):
    def test_outputs_cannot_be_written_into_recording_data_or_over_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/'repo'/'data'/'sessions'/'one'/'recording.webm'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'original')
            for output in [source,source.parent,source.parent/'exports',root/'repo'/'data'/'new-export']:
                with self.subTest(output=output),self.assertRaises(ValueError):
                    MODULE.validate_output_dir(output,[source])
            self.assertEqual(MODULE.validate_output_dir(root/'exports',[source]),(root/'exports').resolve())

    def test_existing_export_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'inputs'/'source.mp4'
            source.parent.mkdir();source.write_bytes(b'original')
            output=root/'export';output.mkdir()
            previous=output/'DanceCraft_04_Synced_With_Audio.mp4';previous.write_bytes(b'keep')
            with self.assertRaises(FileExistsError):
                MODULE.validate_output_dir(output,[source])
            self.assertEqual(previous.read_bytes(),b'keep')
            self.assertEqual(source.read_bytes(),b'original')


if __name__=='__main__':
    unittest.main()
