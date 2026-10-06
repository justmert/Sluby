#!/usr/bin/env bash
# regenerates the hls fixture the browser tests play. it uses the same muxing
# as the backend transcoder (backend/src/transcode/ffmpeg-runner.ts): fmp4
# segments in one data.m4s per rendition, addressed with EXT-X-BYTERANGE and
# an EXT-X-MAP init range, h.264 + aac. it is shorter, smaller, and cut into
# 1s segments so a three second clip still has several byte ranges.
set -euo pipefail

out="$(cd "$(dirname "$0")" && pwd)/hls"
rm -rf "$out"
mkdir -p "$out/144p" "$out/240p"
cd "$out"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=426x240:rate=24:duration=3" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" \
  -filter_complex "[0:v]split=2[v0][v1];[v0]scale=w=256:h=144[v0out];[v1]scale=w=426:h=240[v1out]" \
  -map "[v0out]" -map 1:a -c:v:0 libx264 -b:v:0 80k -maxrate:v:0 90k -bufsize:v:0 160k \
  -map "[v1out]" -map 1:a -c:v:1 libx264 -b:v:1 160k -maxrate:v:1 180k -bufsize:v:1 320k \
  -b:a:0 32k -b:a:1 32k -c:a aac -ac 2 -ar 48000 \
  -profile:v main -preset ultrafast \
  -force_key_frames "expr:gte(t,n_forced*1)" -sc_threshold 0 \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_flags independent_segments+single_file \
  -master_pl_name master.m3u8 \
  -hls_segment_filename "%v/data.m4s" \
  -var_stream_map "v:0,a:0,name:144p v:1,a:1,name:240p" \
  "%v/playlist.m3u8"
