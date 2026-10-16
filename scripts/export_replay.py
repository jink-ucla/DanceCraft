#!/usr/bin/env python3
"""Export a replay without changing recordings, poses, or scoring.

New recordings must store both ``time`` (reference/music seconds) and
``videoTime`` (recorded-video PTS seconds) on each user pose. Historical files
have only a recorder wall clock; exporting those requires explicit offsets.
The legacy music offset is an editorial estimate, not recovered sync metadata.

Requires ffmpeg/ffprobe on PATH and Python opencv-python + numpy.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

NAMES = (
    'DanceCraft_01_Camera.mp4', 'DanceCraft_02_Camera_Skeleton.mp4',
    'DanceCraft_03_Reference.mp4', 'DanceCraft_04_Synced_With_Audio.mp4',
    'DanceCraft_05_Reference_Skeleton.mp4', 'export-report.json',
    'DanceCraft_04_Poster.png',
)
CONNECTIONS = [(11,12),(11,23),(12,24),(23,24),(11,13),(13,15),
               (12,14),(14,16),(15,17),(15,19),(15,21),(16,18),(16,20),
               (16,22),(23,25),(25,27),(24,26),(26,28),(27,29),(27,31),
               (29,31),(28,30),(28,32),(30,32)]


def finite(value, label):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f'{label} must be finite')
    return result


class ReplayClock:
    """Map reference seconds to source-video PTS; never match dance movements."""
    def __init__(self, frames, pose_offset=None, music_offset=None):
        if not frames:
            raise ValueError('User poses are empty')
        anchored = ['videoTime' in frame for frame in frames]
        if any(anchored) and not all(anchored):
            raise ValueError('Mixed anchored and legacy poses are ambiguous')
        self.anchored = all(anchored)
        self.reference_times = [finite(f['time'], 'Pose time') for f in frames]
        if self.anchored:
            if pose_offset is not None or music_offset is not None:
                raise ValueError('Legacy offsets cannot override recorded anchors')
            self.video_times = [finite(f['videoTime'], 'Video time') for f in frames]
            if any(t < 0 for t in self.video_times + self.reference_times):
                raise ValueError('Anchor timestamps cannot be negative')
            if any(b <= a for a,b in zip(self.video_times, self.video_times[1:])):
                raise ValueError('Anchor videoTime must strictly increase')
            if any(b < a for a,b in zip(self.reference_times, self.reference_times[1:])):
                raise ValueError('Reference time cannot run backwards')
            if self.reference_times[-1] <= self.reference_times[0]:
                raise ValueError('Anchors must include advancing reference time')
            self.pose_times = self.video_times
            self.provenance = 'recorded reference/video clock anchors'
        else:
            if pose_offset is None or music_offset is None:
                raise ValueError('Legacy exports require BOTH --legacy-pose-offset '
                                 'and --legacy-music-offset; music sync is unknown')
            self.pose_offset = finite(pose_offset, 'Legacy pose offset')
            self.music_offset = finite(music_offset, 'Legacy music offset')
            if any(b <= a for a,b in zip(self.reference_times, self.reference_times[1:])):
                raise ValueError('Legacy pose timestamps must strictly increase')
            self.pose_times = self.reference_times
            self.provenance = 'editorial estimate; original music clock was not recorded'

    def video_at_reference(self, reference_time):
        if not self.anchored:
            return reference_time + self.music_offset - self.pose_offset
        ts = self.reference_times
        if reference_time < ts[0] or reference_time > ts[-1]:
            return None
        # During a music stall many video timestamps share one music time.
        # Select its last anchor, so the export skips the stalled interval.
        j = bisect.bisect_right(ts, reference_time)
        if j == len(ts):
            return self.video_times[-1]
        a,b = j-1,j
        alpha = (reference_time-ts[a])/(ts[b]-ts[a])
        return self.video_times[a] + alpha*(self.video_times[b]-self.video_times[a])

    def pose_at_video(self, video_time):
        return video_time if self.anchored else video_time + self.pose_offset

    def bounds(self, video_duration, reference_duration):
        if self.anchored:
            if self.video_times[-1] > video_duration + .1:
                raise ValueError('Anchor videoTime exceeds the source recording duration')
            if self.reference_times[-1] > reference_duration + .1:
                raise ValueError('Anchor reference time exceeds the reference duration')
            start = max(0., self.reference_times[0])
            end = min(reference_duration, self.reference_times[-1])
        else:
            start = max(0., self.pose_offset-self.music_offset)
            end = min(reference_duration, video_duration+self.pose_offset-self.music_offset)
        if end <= start:
            raise ValueError('No overlapping video/reference interval')
        return start,end


def validate_output_dir(output, inputs):
    output = Path(output).resolve()
    sources = [Path(p).resolve() for p in inputs]
    for source in sources:
        if output == source or source in output.parents:
            raise ValueError('Output cannot overwrite an input')
        # Keep all exports outside source folders and any source data tree.
        if output == source.parent or source.parent in output.parents:
            raise ValueError('Output must be outside input folders')
        for ancestor in source.parents:
            if ancestor.name.lower() == 'data' and (output == ancestor or ancestor in output.parents):
                raise ValueError('Output must be outside the source data tree')
        for name in NAMES:
            if (output/name).resolve() == source:
                raise ValueError('An export destination resolves to an input')
    if output.exists() and any(output.iterdir()):
        raise FileExistsError('Choose a new, empty output directory; existing exports are preserved')
    return output


def frames_from_json(path):
    value = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if isinstance(value, dict):
        value = value.get('keyframes', value.get('poses'))
    if not isinstance(value, list) or not value:
        raise ValueError(f'No pose frames in {path}')
    return value


def interpolate_pose(frames, times, t, max_gap=.18):
    if not times or t < times[0]-.001 or t > times[-1]+.001:
        return None
    j = bisect.bisect_left(times, t)
    if j == 0:
        a = b = frames[0]
        alpha = 0.
    elif j == len(times):
        a = b = frames[-1]
        alpha = 0.
    else:
        a,b = frames[j-1],frames[j]
        if min(abs(t-times[j-1]), abs(t-times[j])) > max_gap:
            return None
        alpha = (t-times[j-1])/max(1e-9,times[j]-times[j-1])
    ka = a.get('pose', a).get('keypoints', [])
    kb = b.get('pose', b).get('keypoints', [])
    return [(p['x']+(q['x']-p['x'])*alpha,
             p['y']+(q['y']-p['y'])*alpha,
             min(p.get('score',0),q.get('score',0))) for p,q in zip(ka,kb)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('user-video','user-poses','reference-video','reference-poses','output-dir'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--legacy-pose-offset', type=float)
    parser.add_argument('--legacy-music-offset', type=float,
                        help='Explicit editorial advance: stored pose time = music time + offset')
    args = parser.parse_args(argv)
    if not 1 <= args.fps <= 120:
        parser.error('--fps must be between 1 and 120')
    paths = [args.user_video,args.user_poses,args.reference_video,args.reference_poses]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(path)
    output = validate_output_dir(args.output_dir, paths)
    user = frames_from_json(args.user_poses)
    reference = frames_from_json(args.reference_poses)
    clock = ReplayClock(user, args.legacy_pose_offset, args.legacy_music_offset)
    reference_times = [finite(f['time'], 'Reference pose time') for f in reference]
    if any(b <= a for a,b in zip(reference_times, reference_times[1:])):
        raise ValueError('Reference pose times must strictly increase')
    ffmpeg,ffprobe = shutil.which('ffmpeg'),shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise RuntimeError('ffmpeg and ffprobe must be on PATH')
    import cv2
    import numpy as np
    output.mkdir(parents=True, exist_ok=True)
    temp = output/'.work'
    temp.mkdir()
    hashes = {str(p.resolve()): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}

    def ff(arguments, destination):
        destination = Path(destination).resolve()
        if destination.parent not in (output, temp) or str(destination) in hashes:
            raise ValueError('Unsafe FFmpeg destination')
        if destination.exists():
            raise FileExistsError(destination)
        subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-n',
                        *map(str,arguments),str(destination)],check=True)

    def probe(path):
        return json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams',
                                                  '-show_format','-of','json',str(path)]))

    def info(path):
        data = probe(path)
        video = next(s for s in data['streams'] if s['codec_type']=='video')
        return data,video

    encode = ['-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
              '-movflags','+faststart']
    fps = args.fps
    camera,cam_skel,ref_copy,combined,ref_skel = [output/n for n in NAMES[:5]]
    try:
        source_user,user_meta = info(args.user_video)
        source_ref,ref_meta = info(args.reference_video)
        user_w,user_h = user_meta['width'],user_meta['height']
        ref_w,ref_h = ref_meta['width'],ref_meta['height']
        has_audio = any(s['codec_type']=='audio' for s in source_ref['streams'])
        # FPS conversion uses original presentation timestamps, not the WebM
        # nominal frame rate (which browsers may incorrectly report as 1000).
        ff(['-i',args.user_video,'-map','0:v:0','-vf',f'fps={fps}',
            '-an',*encode],camera)
        ff(['-i',args.reference_video,'-map','0:v:0','-map','0:a:0?',
            '-vf',f'fps={fps}',*encode,'-c:a','aac','-b:a','192k'],ref_copy)
        _,cam_meta = info(camera)
        _,ref_out_meta = info(ref_copy)
        camera_duration = float(cam_meta['duration'])
        reference_duration = float(ref_out_meta['duration'])
        overlap_start,overlap_end = clock.bounds(camera_duration, reference_duration)
        # Stay on the reference frame grid, and only render complete frames.
        start_frame = math.ceil(overlap_start*fps-1e-8)
        end_frame = math.floor(overlap_end*fps+1e-8)
        if end_frame <= start_frame:
            raise ValueError('Overlap is shorter than one export frame')

        def draw(frame, points, normalized, color, source_w=1, source_h=1):
            if not points:
                return frame
            h,w = frame.shape[:2]
            coords = [(round(x*w if normalized else x*w/source_w),
                       round(y*h if normalized else y*h/source_h),s)
                      if all(math.isfinite(v) for v in (x,y,s)) else (0,0,0)
                      for x,y,s in points]
            thick = max(2,round(min(w,h)/240))
            for a,b in CONNECTIONS:
                if max(a,b)>=len(coords) or min(coords[a][2],coords[b][2])<.3:
                    continue
                cv2.line(frame,coords[a][:2],coords[b][:2],(10,10,10),thick+2,cv2.LINE_AA)
                cv2.line(frame,coords[a][:2],coords[b][:2],color,thick,cv2.LINE_AA)
            for i in [0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32]:
                if i<len(coords) and coords[i][2]>=.3:
                    cv2.circle(frame,coords[i][:2],thick+2,(245,245,245),-1,cv2.LINE_AA)
                    cv2.circle(frame,coords[i][:2],thick,color,-1,cv2.LINE_AA)
            return frame

        def writer(path,w,h):
            if path.exists():
                raise FileExistsError(path)
            result = cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
            if not result.isOpened():
                raise RuntimeError('Cannot open intermediate video writer')
            return result

        def skeleton_track(source, destination, frames, times, user_track=False):
            cap = cv2.VideoCapture(str(source))
            width,height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            stream = writer(destination,width,height)
            try:
                count = 0
                while True:
                    ok,frame = cap.read()
                    if not ok:
                        break
                    t = count/fps
                    pose_t = clock.pose_at_video(t) if user_track else t
                    draw(frame,interpolate_pose(frames,times,pose_t),not user_track,
                         (80,240,80) if user_track else (255,235,60),user_w,user_h)
                    stream.write(frame)
                    count += 1
                return count
            finally:
                cap.release()
                stream.release()

        user_silent,ref_silent = temp/'camera-skeleton.mp4',temp/'reference-skeleton.mp4'
        skeleton_track(camera,user_silent,user,clock.pose_times,True)
        ff(['-i',user_silent,'-an',*encode],cam_skel)
        reference_count = skeleton_track(ref_copy,ref_silent,reference,reference_times)

        def mux(silent, destination, audio_start, duration):
            arguments = ['-i',silent]
            if has_audio:
                arguments += ['-ss',f'{audio_start:.9f}','-i',args.reference_video,
                              '-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','192k','-shortest']
            else:
                arguments += ['-an']
            ff([*arguments,'-t',f'{duration:.9f}',*encode],destination)

        mux(ref_silent,ref_skel,0,reference_count/fps)

        class Reader:
            def __init__(self,path):
                self.cap = cv2.VideoCapture(str(path))
                self.count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
                self.index = -1
                self.frame = None
            def at(self,t):
                target = math.floor(t*fps+1e-8)
                if t<0 or target>=self.count or target<self.index:
                    return None
                while self.index<target:
                    ok,frame = self.cap.read()
                    if not ok:
                        return None
                    self.frame = frame
                    self.index += 1
                return None if self.frame is None else self.frame.copy()

        combined_silent = temp/'combined.mp4'
        stream = writer(combined_silent,1280,720)
        cam_reader,ref_reader = Reader(camera),Reader(ref_copy)
        rendered = 0
        poster_frame = min(start_frame+10*fps,end_frame-1)
        try:
            for i in range(start_frame,end_frame):
                t = i/fps
                video_t = clock.video_at_reference(t)
                if video_t is None:
                    break
                uf,rf = cam_reader.at(video_t),ref_reader.at(t)
                if uf is None or rf is None:
                    break  # No invented/frozen tail after either source ends.
                draw(rf,interpolate_pose(reference,reference_times,t),True,(255,235,60))
                # The CFR reader selected a concrete frame on its own grid;
                # overlay its pose, rather than a fractional future frame.
                selected_video_t = cam_reader.index/fps
                draw(uf,interpolate_pose(user,clock.pose_times,clock.pose_at_video(selected_video_t)),
                     False,(80,240,80),user_w,user_h)
                canvas = np.full((720,1280,3),(24,16,10),dtype=np.uint8)
                for frame,x in [(rf,0),(uf,640)]:
                    height,width = frame.shape[:2]
                    ratio = min(640/width,480/height)
                    w,h = round(width*ratio),round(height*ratio)
                    left,top = x+(640-w)//2,120+(480-h)//2
                    canvas[top:top+h,left:left+w] = cv2.resize(frame,(w,h),interpolation=cv2.INTER_AREA)
                for text,xy,size,color in [('DanceCraft',(24,45),1.15,(255,255,255)),
                         ('REFERENCE',(24,100),.8,(255,235,60)),('YOU',(660,100),.8,(80,240,80)),
                         (f'{t:05.2f}s / {reference_duration:.2f}s',(24,665),.7,(210,210,210))]:
                    cv2.putText(canvas,text,xy,cv2.FONT_HERSHEY_SIMPLEX,size,color,2,cv2.LINE_AA)
                stream.write(canvas)
                rendered += 1
                if i==poster_frame:
                    if not cv2.imwrite(str(output/NAMES[6]),canvas):
                        raise RuntimeError('Cannot save contact poster')
        finally:
            stream.release()
            cam_reader.cap.release()
            ref_reader.cap.release()
        if rendered==0:
            raise ValueError('No overlapping frames could be rendered')
        mux(combined_silent,combined,start_frame/fps,rendered/fps)
        report = {'timingProvenance':clock.provenance,
                  'legacyPoseOffsetSeconds':args.legacy_pose_offset,
                  'legacyMusicOffsetSeconds':args.legacy_music_offset,
                  'mapping': ('Piecewise reference time -> recorded videoTime; repeated music anchors skip stalls'
                              if clock.anchored else 'videoPTS = referenceTime + musicOffset - poseOffset'),
                  'performerTiming':'No dance-motion matching or score changes performed by this exporter',
                  'sourceCameraGeometry':[user_w,user_h], 'sourceReferenceGeometry':[ref_w,ref_h],
                  'referenceClockStartSeconds':start_frame/fps,
                  'referenceClockEndSeconds':(start_frame+rendered)/fps,
                  'fps':fps,'combinedFrames':rendered,'inputSha256':hashes,'outputs':[]}
        for path in (camera,cam_skel,ref_copy,combined,ref_skel):
            data = probe(path)
            streams = data['streams']
            end_difference = None
            video = next(s for s in streams if s['codec_type']=='video')
            audio = next((s for s in streams if s['codec_type']=='audio'),None)
            if audio is not None:
                video_end = float(video.get('start_time',0))+float(video['duration'])
                audio_end = float(audio.get('start_time',0))+float(audio['duration'])
                end_difference = abs(video_end-audio_end)
                tolerance = 1/fps+1024/int(audio.get('sample_rate',48000))+.002
                if end_difference>tolerance:
                    raise ValueError(f'Audio/video duration mismatch in {path.name}: {end_difference}s')
            report['outputs'].append({'file':path.name,'bytes':path.stat().st_size,
                'durationSeconds':float(video['duration']),'audioVideoEndDifferenceSeconds':end_difference,
                'streams':[{'type':s['codec_type'],'codec':s['codec_name']} for s in streams]})
        (output/NAMES[5]).write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report,indent=2))
    finally:
        for path,expected in hashes.items():
            if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=expected:
                raise RuntimeError(f'Input changed during export: {path}')


if __name__ == '__main__':
    main()
