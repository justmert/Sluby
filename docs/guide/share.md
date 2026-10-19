# Share and embed

Every ready video has a page of its own on your server, `/watch/<id>`, where `<id>` is the video's ID or one of its playback IDs. Send the link, or put the page in an iframe on any site; it plays through your server's gateway with nothing to install.

The Studio hands out both: on a video's **Share** tab, **Iframe** is the embed code and **Link** is the page's address, and **Copy embed code** copies the iframe for a public video.

## Embed with an iframe

```html
<iframe
  src="https://videos.example.com/watch/pb_x7Kq2vNq9cRt0bLm3sYwA"
  title="Video"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  style="width: 100%; aspect-ratio: 16 / 9; border: 0"
></iframe>
```

The page fills the frame and keeps the video's own shape inside it. Any site may frame it: it sends `Content-Security-Policy: frame-ancestors *` and no `X-Frame-Options`.

These query parameters change how it starts:

| Parameter    | What it does                                                                        |
| ------------ | ----------------------------------------------------------------------------------- |
| `autoplay=1` | Starts playing as soon as it can. Browsers only allow that muted, so it also mutes. |
| `muted=1`    | Starts muted.                                                                       |
| `loop=1`     | Plays again from the start when it ends.                                            |

## Private videos and signed playback IDs

A private video, or a playback ID with the `signed` policy, needs a signed link, the same as its stream: the page takes the `expires` and `sig` of a signed URL and passes them on to the stream and the poster. Without them it answers 403 with "This video needs a signed link", and once they expire, "This link has expired".

Your server signs the URL with an API key (see [signed playback](/guide/react#private-videos)), and your page puts its query on the watch page:

```js
// on your server: the api key never reaches a browser
const { signedUrl } = await sluby.playback.getSignedUrl(videoId, { expiresIn: 3600 });

// in the page: the watch page takes the signed url's query as it is
iframe.src = `https://videos.example.com/watch/${videoId}` + new URL(signedUrl).search;
```

A signed page asks search engines not to index it and gives link previews nothing, since it is one viewer's link. A public page carries the video's title and poster for link previews.

## Plays and caching

A play is counted when the page's player loads the stream, as for any other player. A public page is checked again on every load, so making a video private or deleting it takes effect at once; the page's scripts are cached for an hour.
