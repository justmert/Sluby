---
layout: home

hero:
  name: Sluby
  text: Self-hosted video on Sia
  tagline: Upload a video, get adaptive HLS stored on the Sia network, and play it back from your own server or straight from Sia in the browser.
  actions:
    - theme: brand
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: Production deployment
      link: /guide/production

features:
  - title: Resumable uploads
    details: Uploads go over tus, so a dropped connection resumes where it stopped instead of starting again.
  - title: Adaptive HLS
    details: FFmpeg transcodes each upload into a 1080p to 360p ladder of fMP4 renditions with byte-range playlists.
  - title: Stored on Sia
    details: Every rendition, playlist and thumbnail is an encrypted, erasure-coded object on Sia, pinned through an indexer.
  - title: Two delivery paths
    details: Play through the built-in caching gateway, or let the browser download from Sia hosts directly with shared objects.
  - title: API, SDK and player
    details: A REST API described by OpenAPI 3.1, a TypeScript SDK (@sluby/sdk) and a React player (@sluby/player).
  - title: Studio
    details: A web app for uploading, watching processing, browsing the library, inspecting storage on Sia and managing keys and webhooks.
---
