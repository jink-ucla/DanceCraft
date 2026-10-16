import { loadReference, loadRealSession, mirrorPose } from '../../data'
import { score } from '../dynamics-correlation'
import type { TimestampedPose } from '../../data'
const { poses, geometry } = loadReference()
const geo = { referenceGeometry: geometry }
const px = (seq: TimestampedPose[]) => seq.map((f) => ({ time: f.time, pose: { keypoints: f.pose.keypoints.map((k) => ({ ...k, x: k.x * geometry.width, y: k.y * geometry.height })) } }))
const show = (label: string, r: ReturnType<typeof score>) => console.log(label.padEnd(36), (r.overallScore * 100).toFixed(1).padStart(6), r.rank, 'cov', r.coverage.toFixed(2), 'lag', r.timingOffsetMs, 'mirror', r.mirrored, '|', r.notes.join(' / '))
show('self (normalized, with geometry)', score(poses, poses, 10))
show('self in ref pixels + geometry', score(poses, px(poses), 10, geo))
show('self mirrored', score(poses, px(poses).map((f) => ({ time: f.time, pose: mirrorPose(f.pose) })), 10, geo))
show('empty user', score(poses, [], 10, geo))
show('all-empty frames', score(poses, poses.map((f) => ({ time: f.time, pose: { keypoints: [] } })), 10, geo))
show('user clock offset +100 s', score(poses, px(poses).map((f) => ({ time: f.time + 100, pose: f.pose })), 10, geo))
const still = Array.from({ length: 30 }, (_, i) => ({ time: i / 30, pose: poses[0].pose }))
show('static 1 s ref vs same static', score(still, still, 10))
show('static 1 s ref vs other pose', score(still, Array.from({ length: 30 }, (_, i) => ({ time: i / 30, pose: poses[200].pose })), 10))
show('2 s ref slice vs itself', score(poses.slice(0, 60), poses.slice(0, 60), 10))
show('real session1 vs ref', score(poses, loadRealSession('session1'), 10, geo))
const t0 = performance.now()
for (let i = 0; i < 5; i++) score(poses, px(poses), 10, geo)
console.log('15 s self x5 ms/each', ((performance.now() - t0) / 5).toFixed(1))
const withVideoTime = px(poses).map((f) => ({ time: f.time + 1.2, pose: { ...f.pose, videoTime: f.time } }))
show('recTime +1.2 s but pose.videoTime ok', score(poses, withVideoTime, 10, geo))
